#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ClientRegistry } from "./actors.js";
import { DocmostClient } from "./client.js";
import {
  loadActorConfigs,
  loadConfig,
  loadHttpConfig,
  loadTransportMode,
} from "./config.js";
import { ConfigError } from "./errors.js";
import { startHttpServer } from "./http.js";
import { registerTools, type ToolOptions } from "./tools.js";

const PACKAGE_VERSION = "1.0.0";

function createServer(registry: ClientRegistry, options: ToolOptions = {}): McpServer {
  const server = new McpServer({
    name: "docmost-community-mcp",
    version: PACKAGE_VERSION,
  });
  registerTools(server, registry, options);
  return server;
}

async function main(): Promise<void> {
  const mode = loadTransportMode();
  const httpConfig = mode === "http" ? loadHttpConfig() : undefined;

  // One default Docmost login, plus one per named actor, shared by every MCP session.
  const config = loadConfig();
  const registry = new ClientRegistry(new DocmostClient(config), loadActorConfigs(config));

  if (httpConfig) {
    // Local file tools would act on the shared server's disk, not the caller's.
    await startHttpServer(httpConfig, () =>
      createServer(registry, { localFileTools: false }),
    );
    return;
  }

  const transport = new StdioServerTransport();
  await createServer(registry).connect(transport);
}

main().catch((error: unknown) => {
  const message = error instanceof ConfigError || error instanceof Error
    ? error.message
    : String(error);
  console.error(message);
  process.exit(1);
});
