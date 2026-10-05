import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import {
  createServer as createNodeServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { HttpConfig } from "./config.js";

// Routes, all under the secret path segment:
//   POST|GET|DELETE /<secret>/mcp   Streamable HTTP transport
//   GET  /<secret>/sse              legacy SSE transport, event stream
//   POST /<secret>/messages         legacy SSE transport, client messages
//   GET  /healthz                   liveness only, no secret, no details
// Anything else gets an empty 404, so a wrong secret looks like nothing is there.

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SSE_KEEP_ALIVE_MS = 25_000;
const SWEEP_INTERVAL_MS = 60_000;
const ROUTE_PATTERN = /^\/([^/]+)(\/[^/]+)$/;

type StreamableSession = {
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
  openRequests: number;
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

export function secretMatches(candidate: string, secret: string): boolean {
  // Compare fixed-length digests so neither content nor length leaks through timing.
  return timingSafeEqual(digest(candidate), digest(secret));
}

export function hostnameOf(hostHeader: string | undefined): string | undefined {
  if (!hostHeader) {
    return undefined;
  }
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 0 ? host.slice(0, end + 1) : undefined;
  }
  return host.split(":")[0] || undefined;
}

function sendEmpty(res: ServerResponse, status: number): void {
  if (!res.headersSent) {
    res.writeHead(status);
  }
  res.end();
}

function sendJsonRpcError(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
  );
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body too large");
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Parse error: body is not valid JSON");
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function startHttpServer(
  config: HttpConfig,
  createServer: () => McpServer,
): Promise<void> {
  const streamable = new Map<string, StreamableSession>();
  const sse = new Map<string, SSEServerTransport>();
  const messagesPath = `/${config.pathSecret}/messages`;

  if (!config.allowedHosts) {
    console.error(
      "MCP_ALLOWED_HOSTS is not set: the Host header is not checked. Set it to the public host name.",
    );
  }

  function hostAllowed(req: IncomingMessage): boolean {
    if (!config.allowedHosts) {
      return true;
    }
    const hostname = hostnameOf(req.headers.host);
    return hostname !== undefined && config.allowedHosts.includes(hostname);
  }

  async function handleStreamable(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const sessionId = headerValue(req.headers["mcp-session-id"]);

    if (req.method === "POST") {
      const body = await readJsonBody(req);

      if (sessionId) {
        const session = streamable.get(sessionId);
        if (!session) {
          sendJsonRpcError(res, 404, "Session not found");
          return;
        }
        await runInSession(session, res, () => session.transport.handleRequest(req, res, body));
        return;
      }

      if (!isInitializeRequest(body)) {
        sendJsonRpcError(res, 400, "Bad Request: no valid session ID provided");
        return;
      }

      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          streamable.set(id, { transport, lastSeen: Date.now(), openRequests: 0 });
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) {
          streamable.delete(transport.sessionId);
        }
      };
      await createServer().connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const session = sessionId ? streamable.get(sessionId) : undefined;
      if (!session) {
        sendJsonRpcError(res, sessionId ? 404 : 400, sessionId
          ? "Session not found"
          : "Bad Request: no valid session ID provided");
        return;
      }
      await runInSession(session, res, () => session.transport.handleRequest(req, res));
      return;
    }

    res.setHeader("allow", "GET, POST, DELETE");
    sendEmpty(res, 405);
  }

  async function runInSession(
    session: StreamableSession,
    res: ServerResponse,
    work: () => Promise<void>,
  ): Promise<void> {
    // An open request (for example a GET event stream) keeps the session alive.
    session.lastSeen = Date.now();
    session.openRequests += 1;
    res.once("close", () => {
      session.openRequests -= 1;
      session.lastSeen = Date.now();
    });
    await work();
  }

  async function handleSseStream(res: ServerResponse): Promise<void> {
    const transport = new SSEServerTransport(messagesPath, res);
    sse.set(transport.sessionId, transport);
    transport.onclose = () => {
      sse.delete(transport.sessionId);
    };
    await createServer().connect(transport);

    // The legacy SSE transport sends no keep-alive of its own; comments keep proxies from timing out.
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": keepalive\n\n");
      }
    }, SSE_KEEP_ALIVE_MS);
    keepAlive.unref();
    res.once("close", () => clearInterval(keepAlive));
  }

  async function handleSseMessage(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const sessionId = url.searchParams.get("sessionId");
    const transport = sessionId ? sse.get(sessionId) : undefined;
    if (!transport) {
      sendEmpty(res, 404);
      return;
    }
    await transport.handlePostMessage(req, res);
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }

    const match = ROUTE_PATTERN.exec(url.pathname);
    if (!match || !secretMatches(match[1], config.pathSecret)) {
      sendEmpty(res, 404);
      return;
    }

    if (!hostAllowed(req)) {
      sendEmpty(res, 403);
      return;
    }

    switch (match[2]) {
      case "/mcp":
        await handleStreamable(req, res);
        return;
      case "/sse":
        if (req.method !== "GET") {
          res.setHeader("allow", "GET");
          sendEmpty(res, 405);
          return;
        }
        await handleSseStream(res);
        return;
      case "/messages":
        if (req.method !== "POST") {
          res.setHeader("allow", "POST");
          sendEmpty(res, 405);
          return;
        }
        await handleSseMessage(req, res, url);
        return;
      default:
        sendEmpty(res, 404);
    }
  }

  const httpServer = createNodeServer((req, res) => {
    route(req, res).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendJsonRpcError(res, error.status, error.message);
        return;
      }
      // Log the message only: request URLs carry the secret and are never logged.
      console.error(
        "Request failed:",
        error instanceof Error ? error.message : String(error),
      );
      sendJsonRpcError(res, 500, "Internal server error");
    });
  });

  const sweep = setInterval(() => {
    const cutoff = Date.now() - config.sessionIdleMs;
    for (const session of streamable.values()) {
      if (session.openRequests === 0 && session.lastSeen < cutoff) {
        void session.transport.close();
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  const shutdown = (): void => {
    clearInterval(sweep);
    for (const session of streamable.values()) {
      void session.transport.close();
    }
    for (const transport of sse.values()) {
      void transport.close();
    }
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.off("error", reject);
      resolve();
    });
  });
  console.error(
    `docmost-community-mcp: HTTP mode listening on ${config.host}:${config.port}`,
  );
}
