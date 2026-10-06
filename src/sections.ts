import { createHash } from "node:crypto";
import { InputError } from "./errors.js";

// A section is a top-level heading plus the top-level nodes after it, up to the next
// top-level heading of the same or a higher level (a smaller number), or the end of the
// document. The footnotes block at the end of a Docmost document is never part of a section.
// Headings inside callouts, details, tables or columns do not start sections.

export type PmNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string }[];
  content?: PmNode[];
  [key: string]: unknown;
};

export type OutlineEntry = {
  /** Position of the heading among the document's top-level nodes. */
  index: number;
  level: number;
  heading: string;
  /** Top-level nodes in the section body, the heading not counted. */
  nodes: number;
};

export type Section = OutlineEntry & {
  /** Top-level index of the first node after the section (exclusive end). */
  end: number;
  /** The heading node followed by the body nodes, as stored. */
  slice: PmNode[];
  hash: string;
};

const MAX_LISTED = 30;

export function nodeText(node: PmNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  return (node.content ?? []).map(nodeText).join("");
}

function headingLevel(node: PmNode): number {
  const level = Number(node.attrs?.level);
  return Number.isInteger(level) && level > 0 ? level : 1;
}

function topLevel(doc: PmNode): PmNode[] {
  return Array.isArray(doc.content) ? doc.content : [];
}

function sectionEnd(content: PmNode[], index: number, level: number): number {
  let end = index + 1;
  while (end < content.length) {
    const node = content[end];
    if (node.type === "footnotes") {
      break;
    }
    if (node.type === "heading" && headingLevel(node) <= level) {
      break;
    }
    end += 1;
  }
  return end;
}

export function outline(doc: PmNode): OutlineEntry[] {
  const content = topLevel(doc);
  const entries: OutlineEntry[] = [];
  content.forEach((node, index) => {
    if (node.type !== "heading") {
      return;
    }
    const level = headingLevel(node);
    entries.push({
      index,
      level,
      heading: nodeText(node).trim(),
      nodes: sectionEnd(content, index, level) - index - 1,
    });
  });
  return entries;
}

/** sha256 of the heading and body nodes exactly as stored. */
export function hashSection(slice: PmNode[]): string {
  return createHash("sha256").update(JSON.stringify(slice)).digest("hex");
}

function describe(entries: OutlineEntry[]): string {
  const listed = entries.slice(0, MAX_LISTED).map((e) => `"${e.heading}" (level ${e.level}, position ${e.index})`);
  const more = entries.length > MAX_LISTED ? `, and ${entries.length - MAX_LISTED} more` : "";
  return listed.join("; ") + more;
}

/**
 * Finds the one section whose heading text equals `heading` (after trimming both).
 * `level` narrows the match; `occurrence` (1-based) picks among identical headings.
 * Throws InputError when there is no match or more than one.
 */
export function findSection(
  doc: PmNode,
  heading: string,
  options: { level?: number; occurrence?: number } = {},
): Section {
  const wanted = heading.trim();
  const all = outline(doc);
  let matches = all.filter((e) => e.heading === wanted);
  if (options.level !== undefined) {
    matches = matches.filter((e) => e.level === options.level);
  }
  if (matches.length === 0) {
    throw new InputError(
      `No top-level heading "${wanted}"${options.level !== undefined ? ` at level ${options.level}` : ""} on this page. ` +
        `Headings: ${all.length ? describe(all) : "none"}. Nothing was written.`,
    );
  }
  let match: OutlineEntry;
  if (options.occurrence !== undefined) {
    match = matches[options.occurrence - 1];
    if (!match) {
      throw new InputError(
        `occurrence ${options.occurrence} is out of range: ${matches.length} matching heading(s): ${describe(matches)}. Nothing was written.`,
      );
    }
  } else if (matches.length > 1) {
    throw new InputError(
      `Heading "${wanted}" is ambiguous: ${describe(matches)}. Pass level or occurrence (1-based). Nothing was written.`,
    );
  } else {
    match = matches[0];
  }
  const content = topLevel(doc);
  const end = match.index + 1 + match.nodes;
  const slice = content.slice(match.index, end);
  return { ...match, end, slice, hash: hashSection(slice) };
}

/** A copy of doc with the section body replaced; the heading node and everything else kept as is. */
export function spliceSection(doc: PmNode, section: Section, body: PmNode[]): PmNode {
  const content = topLevel(doc);
  return {
    ...doc,
    content: [...content.slice(0, section.index + 1), ...body, ...content.slice(section.end)],
  };
}

/**
 * A comparable outline of nodes that ignores attributes, because Docmost adds default
 * attributes on a page's first json write. Keeps node types, text and mark types.
 */
export function skeleton(nodes: PmNode[]): unknown[] {
  return nodes.map((node) =>
    node.type === "text"
      ? ["text", node.text ?? "", (node.marks ?? []).map((m) => m.type).sort()]
      : [node.type, skeleton(node.content ?? [])],
  );
}
