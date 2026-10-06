import assert from "node:assert/strict";
import test from "node:test";
import { findSection, hashSection, outline, skeleton, spliceSection, type PmNode } from "./sections.js";

const text = (value: string, marks: string[] = []): PmNode =>
  marks.length ? { type: "text", text: value, marks: marks.map((type) => ({ type })) } : { type: "text", text: value };
const p = (value: string): PmNode => ({ type: "paragraph", content: [text(value)] });
const h = (level: number, value: string): PmNode => ({ type: "heading", attrs: { level }, content: [text(value)] });

// Intro, then: H2 A (p, H3 A.1 (p)), H2 B (p), H2 Why (p), H2 Why (p), footnotes.
const doc = (): PmNode => ({
  type: "doc",
  content: [
    p("intro"),
    h(2, "A"),
    p("a body"),
    h(3, "A.1"),
    p("a.1 body"),
    h(2, "B"),
    p("b body"),
    h(2, "Why"),
    p("why one"),
    h(2, "Why"),
    p("why two"),
    { type: "footnotes", content: [] },
  ],
});

test("outline lists top-level headings with level, position and section size", () => {
  assert.deepEqual(outline(doc()), [
    { index: 1, level: 2, heading: "A", nodes: 3 },
    { index: 3, level: 3, heading: "A.1", nodes: 1 },
    { index: 5, level: 2, heading: "B", nodes: 1 },
    { index: 7, level: 2, heading: "Why", nodes: 1 },
    { index: 9, level: 2, heading: "Why", nodes: 1 },
  ]);
});

test("a section runs to the next heading of the same or higher level, subsections included", () => {
  const a = findSection(doc(), "A");
  assert.equal(a.index, 1);
  assert.equal(a.end, 5);
  assert.deepEqual(a.slice.map((n) => n.type), ["heading", "paragraph", "heading", "paragraph"]);
  const sub = findSection(doc(), "A.1");
  assert.equal(sub.end, 5);
});

test("the footnotes block never belongs to the last section", () => {
  const last = findSection(doc(), "Why", { occurrence: 2 });
  assert.equal(last.end, 11);
  assert.ok(!last.slice.some((n) => n.type === "footnotes"));
});

test("heading text is compared exactly after trimming, marks ignored", () => {
  const d: PmNode = { type: "doc", content: [{ type: "heading", attrs: { level: 2 }, content: [text(" Setup "), text("now", ["bold"])] }, p("x")] };
  assert.equal(findSection(d, "Setup now").index, 0);
  assert.throws(() => findSection(d, "setup now"), /No top-level heading/);
});

test("an unknown heading is rejected and the error lists the page's headings", () => {
  assert.throws(
    () => findSection(doc(), "Missing"),
    (e: Error) => e.name === "InputError" && /"A" \(level 2, position 1\)/.test(e.message) && /Nothing was written/.test(e.message),
  );
});

test("an ambiguous heading is rejected; level or occurrence picks one", () => {
  assert.throws(() => findSection(doc(), "Why"), /ambiguous.*Pass level or occurrence/);
  assert.equal(findSection(doc(), "Why", { occurrence: 1 }).index, 7);
  assert.equal(findSection(doc(), "Why", { occurrence: 2 }).index, 9);
  assert.throws(() => findSection(doc(), "Why", { occurrence: 3 }), /out of range/);
  assert.throws(() => findSection(doc(), "A", { level: 3 }), /No top-level heading "A" at level 3/);
});

test("headings nested in other blocks do not start sections", () => {
  const d: PmNode = { type: "doc", content: [h(2, "Top"), { type: "callout", content: [h(2, "Inner"), p("x")] }, p("y")] };
  assert.deepEqual(outline(d).map((e) => e.heading), ["Top"]);
  assert.equal(findSection(d, "Top").nodes, 2);
});

test("the hash changes when the section changes and not when another section does", () => {
  const before = findSection(doc(), "B").hash;
  const changedElsewhere = doc();
  (changedElsewhere.content as PmNode[])[0] = p("other intro");
  assert.equal(findSection(changedElsewhere, "B").hash, before);
  const changedHere = doc();
  (changedHere.content as PmNode[])[6] = p("b body, edited");
  assert.notEqual(findSection(changedHere, "B").hash, before);
  assert.equal(hashSection([h(2, "B"), p("b body")]), before);
});

test("splice replaces only the body, keeps the heading and the rest, and does not mutate the input", () => {
  const original = doc();
  const snapshot = JSON.stringify(original);
  const section = findSection(original, "A");
  const next = spliceSection(original, section, [p("new a")]);
  assert.equal(JSON.stringify(original), snapshot);
  const content = next.content as PmNode[];
  assert.deepEqual(skeleton(content.slice(0, 2)), skeleton((original.content as PmNode[]).slice(0, 2)));
  assert.deepEqual(skeleton(content.slice(2, 3)), skeleton([p("new a")]));
  assert.deepEqual(skeleton(content.slice(3)), skeleton((original.content as PmNode[]).slice(5)));
  const emptied = spliceSection(original, section, []);
  assert.equal((emptied.content as PmNode[]).length, 12 - 3);
});

test("skeleton ignores attributes but keeps types, text and marks", () => {
  const plain: PmNode = { type: "paragraph", content: [text("x", ["bold"])] };
  const withDefaults: PmNode = { type: "paragraph", attrs: { dir: "auto", indent: 0 }, content: [{ ...text("x", ["bold"]), marks: [{ type: "bold", attrs: {} } as { type: string }] }] };
  assert.deepEqual(skeleton([plain]), skeleton([withDefaults]));
  assert.notDeepEqual(skeleton([plain]), skeleton([p("x")]));
});
