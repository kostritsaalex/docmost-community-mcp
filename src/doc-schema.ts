import {
  Node,
  Schema,
  type AttributeSpec,
  type MarkSpec,
  type NodeSpec,
} from "prosemirror-model";
import { DOCMOST_SCHEMA } from "./docmost-schema.js";
import { InputError } from "./errors.js";

// Docmost checks a json body only with Node.fromJSON: it never calls check(), and it
// silently unwraps unknown node types. A malformed doc is then stored and the page is
// damaged without an error. So the gateway checks every doc against Docmost's own schema
// (dumped from a running Docmost, see scripts/) before anything is sent.

export type AttrDump = { hasDefault?: boolean; default?: unknown; validate?: string };
export type SpecDump = Record<string, unknown> & { attrs?: Record<string, AttrDump> };
export type SchemaDump = {
  docmostVersion: string;
  prosemirrorModelVersion?: string;
  topNode: string;
  nodes: [string, SpecDump][];
  marks: [string, SpecDump][];
};

const MAX_REASON_LENGTH = 300;

function attrsFrom(dump: Record<string, AttrDump> | undefined): Record<string, AttributeSpec> | undefined {
  if (!dump) {
    return undefined;
  }
  const attrs: Record<string, AttributeSpec> = {};
  for (const [name, attr] of Object.entries(dump)) {
    const spec: AttributeSpec = {};
    // An attribute without a default is required, exactly as in Docmost.
    if (attr.hasDefault) {
      spec.default = attr.default;
    }
    if (attr.validate) {
      spec.validate = attr.validate;
    }
    attrs[name] = spec;
  }
  return attrs;
}

function specFrom<T extends NodeSpec | MarkSpec>(dump: SpecDump): T {
  const { attrs, ...rest } = dump;
  const spec = { ...rest } as T;
  const built = attrsFrom(attrs);
  if (built) {
    spec.attrs = built;
  }
  return spec;
}

export function buildSchema(dump: SchemaDump): Schema {
  // Insertion order is kept: it decides group order and mark rank, as in Docmost.
  const nodes: Record<string, NodeSpec> = {};
  for (const [name, spec] of dump.nodes) {
    nodes[name] = specFrom<NodeSpec>(spec);
  }
  const marks: Record<string, MarkSpec> = {};
  for (const [name, spec] of dump.marks) {
    marks[name] = specFrom<MarkSpec>(spec);
  }
  return new Schema({ nodes, marks, topNode: dump.topNode });
}

let docmostSchema: Schema | undefined;

function defaultSchema(): Schema {
  docmostSchema ??= buildSchema(DOCMOST_SCHEMA);
  return docmostSchema;
}

function shorten(text: string): string {
  return text.length > MAX_REASON_LENGTH ? `${text.slice(0, MAX_REASON_LENGTH)}...` : text;
}

/**
 * Throws InputError unless the doc is a valid document of the Docmost schema: known node
 * and mark types, required attributes present, and every node's content allowed where it is.
 * Returns the doc unchanged, so what is sent is exactly what the caller gave.
 */
export function validateDoc(
  doc: Record<string, unknown>,
  schema: Schema = defaultSchema(),
  docmostVersion: string = DOCMOST_SCHEMA.docmostVersion,
): Record<string, unknown> {
  try {
    Node.fromJSON(schema, doc).check();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InputError(
      `doc does not fit the Docmost ${docmostVersion} schema: ${shorten(reason)}. ` +
        "Read the page with get_page format=json and keep its node types and structure. Nothing was written.",
    );
  }
  return doc;
}
