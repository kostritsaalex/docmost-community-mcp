import { InputError } from "./errors.js";

export const BODY_OPERATIONS = ["replace", "append", "prepend"] as const;

/** Inputs that carry a page id and may be given as a slugId. */
export const PAGE_ID_KEYS = ["page_id", "parent_page_id", "after_page_id"] as const;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * A body write must name how it applies: a missing operation would silently
 * replace the whole page. Title or icon changes without a body need none.
 * Markdown and a ProseMirror doc cannot be sent together.
 */
export function requireBodyOperation(args: Record<string, unknown>): void {
  const hasMarkdown = Boolean(args.markdown);
  const hasDoc = args.doc !== undefined && args.doc !== null && args.doc !== "";
  if (hasMarkdown && hasDoc) {
    throw new InputError("Send either markdown or doc, not both. Nothing was written.");
  }
  if (!hasMarkdown && !hasDoc) {
    return;
  }
  if (!args.operation) {
    throw new InputError(
      `operation is required when a body (markdown or doc) is given: one of ${BODY_OPERATIONS.join(", ")}. ` +
        "Use append or prepend to add to a page; replace sends the whole body. Nothing was written.",
    );
  }
}

/**
 * A ProseMirror document as get_page with format=json returns it. Accepts the
 * object or the same object serialised as a JSON string. Only the outer shape is
 * checked here; validateDoc (doc-schema.ts) checks it against the Docmost schema.
 */
export function parseDoc(value: unknown): Record<string, unknown> {
  let doc = value;
  if (typeof doc === "string") {
    try {
      doc = JSON.parse(doc);
    } catch {
      throw new InputError("doc is not valid JSON. Nothing was written.");
    }
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc) || (doc as Record<string, unknown>).type !== "doc") {
    throw new InputError(
      'doc must be a ProseMirror document object with type "doc", as get_page with format=json returns it. Nothing was written.',
    );
  }
  return doc as Record<string, unknown>;
}

/**
 * Returns a copy of args in which every page id given as a slugId is replaced by
 * the page UUID. UUIDs, absent keys and null (move to root) are left as they are.
 */
export async function resolvePageIds(
  args: Record<string, unknown>,
  resolve: (slugId: string) => Promise<string>,
): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = { ...args };
  for (const key of PAGE_ID_KEYS) {
    const value = resolved[key];
    if (typeof value === "string" && value.trim() !== "" && !isUuid(value)) {
      resolved[key] = await resolve(value.trim());
    }
  }
  return resolved;
}
