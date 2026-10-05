import assert from "node:assert/strict";
import test from "node:test";
import { hostnameOf, secretMatches } from "./http.js";

test("secretMatches compares exactly", () => {
  const secret = "b".repeat(40);
  assert.equal(secretMatches(secret, secret), true);
  assert.equal(secretMatches(secret.slice(1), secret), false);
  assert.equal(secretMatches(`${secret}x`, secret), false);
  assert.equal(secretMatches("", secret), false);
});

test("hostnameOf strips the port and lowercases", () => {
  assert.equal(hostnameOf("MCP.Example.com:443"), "mcp.example.com");
  assert.equal(hostnameOf("localhost"), "localhost");
  assert.equal(hostnameOf("[::1]:3001"), "[::1]");
  assert.equal(hostnameOf(undefined), undefined);
  assert.equal(hostnameOf(""), undefined);
});
