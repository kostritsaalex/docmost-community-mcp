import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { ClientRegistry } from "./actors.js";
import { DocmostClient } from "./client.js";
import { loadActorConfigs, type DocmostConfig } from "./config.js";

const base: DocmostConfig = {
  baseUrl: "https://docs.example.com",
  email: "reader@example.com",
  password: "reader-password",
  sessionPath: "/tmp/dcmcp/session.json",
  readOnly: false,
};

test("no DOCMOST_ACTORS means no actors", () => {
  assert.equal(loadActorConfigs(base, {}).size, 0);
});

test("actors read email and password, keep base URL, get their own session file", () => {
  const actors = loadActorConfigs(base, {
    DOCMOST_ACTORS: " Opus, sonnet ,,claude-code",
    DOCMOST_ACTOR_OPUS_EMAIL: "opus@example.com",
    DOCMOST_ACTOR_OPUS_PASSWORD: "p1",
    DOCMOST_ACTOR_SONNET_EMAIL: "sonnet@example.com",
    DOCMOST_ACTOR_SONNET_PASSWORD: "p2",
    DOCMOST_ACTOR_CLAUDE_CODE_EMAIL: "cc@example.com",
    DOCMOST_ACTOR_CLAUDE_CODE_PASSWORD: "p3",
  });
  assert.deepEqual([...actors.keys()], ["opus", "sonnet", "claude-code"]);
  const opus = actors.get("opus");
  assert.equal(opus?.email, "opus@example.com");
  assert.equal(opus?.baseUrl, base.baseUrl);
  assert.equal(opus?.authToken, undefined);
  assert.equal(opus?.sessionPath, join("/tmp/dcmcp", "session.opus.json"));
});

test("a missing actor password fails and names the variable, not a value", () => {
  assert.throws(
    () =>
      loadActorConfigs(base, {
        DOCMOST_ACTORS: "opus",
        DOCMOST_ACTOR_OPUS_EMAIL: "opus@example.com",
      }),
    (error: Error) =>
      error.message.includes("DOCMOST_ACTOR_OPUS_PASSWORD") &&
      !error.message.includes("opus@example.com"),
  );
});

test("invalid or duplicate actor names fail", () => {
  assert.throws(() => loadActorConfigs(base, { DOCMOST_ACTORS: "9lives" }), /not a valid actor name/);
  assert.throws(() => loadActorConfigs(base, { DOCMOST_ACTORS: "opus,OPUS" }), /twice/);
});

test("registry: reads use the default client, writes the named actor", () => {
  const reader = new DocmostClient(base);
  const actors = loadActorConfigs(base, {
    DOCMOST_ACTORS: "opus,sonnet",
    DOCMOST_ACTOR_OPUS_EMAIL: "opus@example.com",
    DOCMOST_ACTOR_OPUS_PASSWORD: "p1",
    DOCMOST_ACTOR_SONNET_EMAIL: "sonnet@example.com",
    DOCMOST_ACTOR_SONNET_PASSWORD: "p2",
  });
  const registry = new ClientRegistry(reader, actors);
  assert.deepEqual(registry.actorNames, ["opus", "sonnet"]);
  const opus = registry.forWrite("opus");
  assert.notEqual(opus, reader);
  assert.equal(registry.forWrite("Opus"), opus, "one client per actor, reused");
  assert.notEqual(registry.forWrite("sonnet"), opus);
});

test("registry: unknown or missing actor is rejected with the allowed names", () => {
  const registry = new ClientRegistry(
    new DocmostClient(base),
    loadActorConfigs(base, {
      DOCMOST_ACTORS: "opus",
      DOCMOST_ACTOR_OPUS_EMAIL: "opus@example.com",
      DOCMOST_ACTOR_OPUS_PASSWORD: "p1",
    }),
  );
  assert.throws(() => registry.forWrite("gpt"), /Unknown actor "gpt".*one of: opus/);
  assert.throws(() => registry.forWrite(undefined), /Missing actor.*one of: opus/);
});

test("registry without actors writes with the default client", () => {
  const reader = new DocmostClient(base);
  const registry = new ClientRegistry(reader);
  assert.equal(registry.forWrite(undefined), reader);
  assert.equal(registry.forWrite("anything"), reader);
  assert.deepEqual(registry.actorNames, []);
});
