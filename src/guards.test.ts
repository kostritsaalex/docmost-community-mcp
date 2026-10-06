import assert from "node:assert/strict";
import test from "node:test";
import { parseDoc, requireBodyOperation, resolvePageIds } from "./guards.js";

const UUID = "01a10de8-20dd-71f0-96ed-1565f979f4e6";

test("a body without operation is rejected and names the allowed values", () => {
  assert.throws(
    () => requireBodyOperation({ page_id: UUID, markdown: "new text" }),
    (error: Error) =>
      /operation is required/.test(error.message) &&
      /replace, append, prepend/.test(error.message) &&
      /Nothing was written/.test(error.message),
  );
});

test("each explicit operation is accepted with a body", () => {
  for (const operation of ["replace", "append", "prepend"]) {
    assert.doesNotThrow(() => requireBodyOperation({ markdown: "x", operation }));
  }
});

test("title or icon changes need no operation", () => {
  assert.doesNotThrow(() => requireBodyOperation({ page_id: UUID, title: "New title" }));
  assert.doesNotThrow(() => requireBodyOperation({ page_id: UUID, icon: "📄", markdown: "" }));
});

test("UUIDs, absent keys and null parents are left as they are", async () => {
  const calls: string[] = [];
  const resolve = async (slugId: string) => {
    calls.push(slugId);
    return "should-not-be-used";
  };
  const args = { page_id: UUID, parent_page_id: null, title: "t" };
  const resolved = await resolvePageIds(args, resolve);
  assert.deepEqual(resolved, args);
  assert.equal("after_page_id" in resolved, false);
  assert.deepEqual(calls, []);
});

test("slugIds are resolved in every page id input, args are not mutated", async () => {
  const map: Record<string, string> = { BTNszzw0rI: UUID, MkSH7gzVgk: "parent-uuid", AGyluajyJt: "after-uuid" };
  const args = { page_id: "BTNszzw0rI", parent_page_id: "MkSH7gzVgk", after_page_id: "AGyluajyJt", space_id: "ISBOX" };
  const resolved = await resolvePageIds(args, async (slugId) => map[slugId]);
  assert.equal(resolved.page_id, UUID);
  assert.equal(resolved.parent_page_id, "parent-uuid");
  assert.equal(resolved.after_page_id, "after-uuid");
  assert.equal(resolved.space_id, "ISBOX", "space ids are not page ids");
  assert.equal(args.page_id, "BTNszzw0rI");
});

test("a failing lookup surfaces its error", async () => {
  await assert.rejects(
    resolvePageIds({ page_id: "nope" }, async () => {
      throw new Error("Page not found for slugId nope");
    }),
    /Page not found for slugId nope/,
  );
});

const DOC = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] };

test("a doc body also needs operation", () => {
  assert.throws(() => requireBodyOperation({ doc: DOC }), /operation is required when a body/);
  assert.doesNotThrow(() => requireBodyOperation({ doc: DOC, operation: "replace" }));
});

test("markdown and doc together are rejected", () => {
  assert.throws(
    () => requireBodyOperation({ markdown: "x", doc: DOC, operation: "append" }),
    /either markdown or doc, not both/,
  );
});

test("parseDoc accepts the object and its JSON string", () => {
  assert.deepEqual(parseDoc(DOC), DOC);
  assert.deepEqual(parseDoc(JSON.stringify(DOC)), DOC);
});

test("parseDoc rejects bad JSON and non-doc objects", () => {
  assert.throws(() => parseDoc("{not json"), /not valid JSON/);
  assert.throws(() => parseDoc({ type: "paragraph" }), /type "doc"/);
  assert.throws(() => parseDoc([DOC]), /type "doc"/);
  assert.throws(() => parseDoc(42), /type "doc"/);
});
