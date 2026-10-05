#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DocmostClient } from "./client.js";
import { loadConfig, loadHttpConfig, loadTransportMode } from "./config.js";
import { ConfigError } from "./errors.js";
import { startHttpServer } from "./http.js";
import { registerTools, type ToolOptions } from "./tools.js";

const PACKAGE_VERSION = "1.0.0";

function createServer(client: DocmostClient, options: ToolOptions = {}): McpServer {
  const server = new McpServer({
    name: "docmost-community-mcp",
    version: PACKAGE_VERSION,
  });
  registerTools(server, client, options);
  return server;
}

async function main(): Promise<void> {
  const mode = loadTransportMode();
  const httpConfig = mode === "http" ? loadHttpConfig() : undefined;

  // One Docmost client (one login) is shared by every MCP session.
  const client = new DocmostClient(loadConfig());

  if (httpConfig) {
    // Local file tools would act on the shared server's disk, not the caller's.
    await startHttpServer(httpConfig, () =>
      createServer(client, { localFileTools: false }),
    );
    return;
  }

  const transport = new StdioServerTransport();
  await createServer(client).connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError || error instanceof Error
    ? error.message
    : String(error);
  console.error(message);
  process.exit(1);
});
