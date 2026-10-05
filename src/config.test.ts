import assert from "node:assert/strict";
import test from "node:test";
import { loadHttpConfig, loadTransportMode } from "./config.js";

const SECRET = "a".repeat(32);

test("transport defaults to stdio and accepts http", () => {
  assert.equal(loadTransportMode({}), "stdio");
  assert.equal(loadTransportMode({ MCP_TRANSPORT: "" }), "stdio");
  assert.equal(loadTransportMode({ MCP_TRANSPORT: "HTTP" }), "http");
  assert.throws(() => loadTransportMode({ MCP_TRANSPORT: "sse" }), /stdio or http/);
});

test("http mode requires a path secret", () => {
  assert.throws(() => loadHttpConfig({}), /MCP_PATH_SECRET is required/);
});

test("http mode rejects a short secret without echoing it", () => {
  const short = "short-secret-value";
  assert.throws(
    () => loadHttpConfig({ MCP_PATH_SECRET: short }),
    (error: Error) => /at least 32/.test(error.message) && !error.message.includes(short),
  );
});

test("http mode rejects a secret that is not one URL path segment", () => {
  assert.throws(
    () => loadHttpConfig({ MCP_PATH_SECRET: `${SECRET}/x` }),
    /only letters, digits/,
  );
});

test("http config defaults", () => {
  const config = loadHttpConfig({ MCP_PATH_SECRET: SECRET });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3001);
  assert.equal(config.pathSecret, SECRET);
  assert.equal(config.allowedHosts, undefined);
  assert.equal(config.sessionIdleMs, 30 * 60_000);
});

test("http config reads host, port, allowed hosts and idle time", () => {
  const config = loadHttpConfig({
    MCP_PATH_SECRET: SECRET,
    MCP_HTTP_HOST: "0.0.0.0",
    MCP_HTTP_PORT: "8080",
    MCP_ALLOWED_HOSTS: " Mcp.Example.com , ,localhost",
    MCP_SESSION_IDLE_MINUTES: "5",
  });
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.deepEqual(config.allowedHosts, ["mcp.example.com", "localhost"]);
  assert.equal(config.sessionIdleMs, 5 * 60_000);
});

test("http config rejects a bad port", () => {
  assert.throws(
    () => loadHttpConfig({ MCP_PATH_SECRET: SECRET, MCP_HTTP_PORT: "70000" }),
    /MCP_HTTP_PORT/,
  );
});
