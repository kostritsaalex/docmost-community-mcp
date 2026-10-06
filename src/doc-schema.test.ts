import assert from "node:assert/strict";
import test from "node:test";
import { validateDoc } from "./doc-schema.js";

type J = Record<string, unknown>;

const text = (value: string): J => ({ type: "text", text: value });
const paragraph = (value: string): J => ({ type: "paragraph", content: [text(value)] });
const cell = (type: string, value: string): J => ({ type, content: [paragraph(value)] });
const row = (...cells: J[]): J => ({ type: "tableRow", content: cells });

// The table document written in the DCMCP-US0062 check on Docmost 0.96.0.
const tableDoc: J = {
  type: "doc",
  content: [
    paragraph("Lossless write test."),
    {
      type: "table",
      content: [
        row(cell("tableHeader", "Key"), cell("tableHeader", "Value")),
        row(cell("tableCell", "alpha"), cell("tableCell", "1")),
      ],
    },
  ],
};

function rejected(doc: J, pattern: RegExp): void {
  assert.throws(
    () => validateDoc(doc),
    (error: Error) =>
      error.name === "InputError" &&
      /doc does not fit the Docmost 0\.96\.0 schema/.test(error.message) &&
      pattern.test(error.message) &&
      /Nothing was written/.test(error.message),
  );
}

test("a table document is valid and returned unchanged", () => {
  assert.equal(validateDoc(tableDoc), tableDoc);
});

test("a document as Docmost returns it, with default attributes, is valid", () => {
  const stored: J = {
    type: "doc",
    content: [
      { type: "paragraph", attrs: { dir: "auto", indent: 0 }, content: [text("Intro")] },
      {
        type: "table",
        attrs: { dir: "auto" },
        content: [
          {
            type: "tableRow",
            attrs: { dir: "auto" },
            content: [
              {
                type: "tableHeader",
                attrs: { dir: "auto", colspan: 1, rowspan: 1 },
                content: [{ type: "paragraph", attrs: { dir: "auto", indent: 0 }, content: [text("Key")] }],
              },
            ],
          },
        ],
      },
      { type: "heading", attrs: { level: 2 }, content: [text("Appended")] },
    ],
  };
  assert.doesNotThrow(() => validateDoc(stored));
});

test("marks, lists, callouts and code blocks are valid", () => {
  const doc: J = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
          { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "https://example.com" } }] },
        ],
      },
      { type: "bulletList", content: [{ type: "listItem", content: [paragraph("item")] }] },
      { type: "callout", attrs: { type: "info" }, content: [paragraph("note")] },
      { type: "codeBlock", attrs: { language: "bash" }, content: [text("echo ok")] },
    ],
  };
  assert.doesNotThrow(() => validateDoc(doc));
});

test("an unknown node type is rejected (Docmost would unwrap it and store a damaged page)", () => {
  rejected({ type: "doc", content: [{ type: "bogusNode", content: [text("x")] }] }, /bogusNode/);
});

test("text directly inside doc is rejected", () => {
  rejected({ type: "doc", content: [text("loose")] }, /Invalid content for node doc/);
});

test("a cell outside a table row is rejected", () => {
  rejected(
    { type: "doc", content: [{ type: "table", content: [cell("tableCell", "x")] }] },
    /Invalid content for node table/,
  );
});

test("an unknown mark is rejected", () => {
  rejected(
    { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "glow" }] }] }] },
    /glow/,
  );
});

test("an empty text node is rejected", () => {
  rejected({ type: "doc", content: [{ type: "paragraph", content: [text("")] }] }, /Empty text nodes/);
});

test("a missing required attribute is rejected when attrs are given", () => {
  // prosemirror-model 1.25 fills every attribute with null when a node has no attrs at
  // all, without the required check; Docmost uses the same library, so that case passes.
  rejected(
    {
      type: "doc",
      content: [
        paragraph("x"),
        {
          type: "footnotes",
          content: [{ type: "footnote", attrs: { dir: "auto" }, content: [paragraph("n")] }],
        },
      ],
    },
    /No value supplied for attribute/,
  );
});

test("a document without any block is rejected", () => {
  rejected({ type: "doc", content: [] }, /Invalid content for node doc/);
});

test("a very long reason is shortened", () => {
  const long = "x".repeat(1000);
  assert.throws(
    () => validateDoc({ type: "doc", content: [{ type: long }] }),
    (error: Error) => error.message.length < 600 && error.message.includes("..."),
  );
});
