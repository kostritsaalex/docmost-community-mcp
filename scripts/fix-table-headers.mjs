// Repairs table header rows on Docmost pages, inside the gateway container, with the
// gateway's own code and credentials. Page bodies never leave the server.
//
//   docker compose exec -T -e FIX_MODE=dry -e DOCMOST_SESSION_PATH=/home/node/.docmost-community-mcp/fix.json \
//     docmost-mcp node --input-type=module - < fix-table-headers.mjs
//
// FIX_MODE: dry (default) prints the plan; backup prints each page's json as one line;
// apply writes as FIX_ACTOR (default opus) with operation replace, then reads back and checks.
// Every step is checked against PLAN first; on any mismatch the page is skipped untouched.
//
// Actions, for a table whose first row is header cells holding no text:
//   promote: drop that empty row and turn the next row into the header row
//   label:   write the given labels into the empty header cells
import { loadActorConfigs, loadConfig } from "/app/dist/config.js";
import { DocmostClient } from "/app/dist/client.js";
import { validateDoc } from "/app/dist/doc-schema.js";

// Found 2026-10-06 by scanning all live pages (AITDF-US0020, IMGMT-US0061).
// table = index among the page's tables in document order; first = expected first cell of the
// row under the empty header, checked before anything is changed.
const PLAN = [
  { page: "01a10394-eaf2-722d-a7e6-646898427316", name: "CloudPanel", fixes: [
    { table: 0, action: "label", labels: ["Item", "Value"], first: "Edition" },
    { table: 1, action: "promote", first: "Criterion" },
    { table: 2, action: "promote", first: "Server" },
  ] },
  { page: "01a10395-96ad-78e9-965e-9fdd2a296e02", name: "Installing CloudPanel on Ubuntu 26.04", fixes: [
    { table: 0, action: "label", labels: ["Item", "Value"], first: "Hostname" },
    { table: 1, action: "promote", first: "Port" },
  ] },
  { page: "01a0e313-ce34-73fc-8a8d-12f6716ea271", name: "Docmost", fixes: [
    { table: 0, action: "label", labels: ["Item", "Value"], first: "URL" },
  ] },
  { page: "01a0e319-4bbe-771b-a6ab-677b6d902093", name: "Docmost on docs.vegvisir.pro", fixes: [
    { table: 0, action: "label", labels: ["Item", "Value"], first: "Server" },
  ] },
  { page: "01a0e314-5411-7e8b-84d1-9d542b996027", name: "Docmost MCP access", fixes: [
    { table: 7, action: "label", labels: ["Item", "Value"], first: "Our instance" },
  ] },
];

const MODE = process.env.FIX_MODE ?? "dry";
const ACTOR = process.env.FIX_ACTOR ?? "opus";
const SETTLE_MS = 4000;

const textOf = (n) => (n.type === "text" ? n.text ?? "" : (n.content ?? []).map(textOf).join(""));
const allTexts = (n, out = []) => {
  if (n.type === "text") out.push(n.text ?? "");
  for (const c of n.content ?? []) allTexts(c, out);
  return out;
};
const countTypes = (n, out = {}) => {
  out[n.type] = (out[n.type] ?? 0) + 1;
  for (const c of n.content ?? []) countTypes(c, out);
  return out;
};
const tablesOf = (n, out = []) => {
  if (n.type === "table") out.push(n);
  for (const c of n.content ?? []) tablesOf(c, out);
  return out;
};
const isEmptyHeaderRow = (row) =>
  (row?.content ?? []).length > 0 &&
  row.content.every((c) => c.type === "tableHeader" && textOf(c).trim() === "");

/** Returns the repaired copy of doc, or throws with the reason. The input is not changed. */
function repair(doc, fixes) {
  const copy = structuredClone(doc);
  const tables = tablesOf(copy);
  for (const fix of fixes) {
    const table = tables[fix.table];
    if (!table) throw new Error(`table ${fix.table} not found (page has ${tables.length})`);
    const rows = table.content ?? [];
    if (!isEmptyHeaderRow(rows[0])) throw new Error(`table ${fix.table}: first row is not an empty header row`);
    const next = rows[1];
    const firstCell = next ? textOf(next.content[0]).trim() : "";
    if (!firstCell.startsWith(fix.first)) {
      throw new Error(`table ${fix.table}: row under the header starts with "${firstCell.slice(0, 30)}", expected "${fix.first}"`);
    }
    if (fix.action === "promote") {
      table.content = rows.slice(1);
      table.content[0].content = table.content[0].content.map((cell) => ({ ...cell, type: "tableHeader" }));
    } else if (fix.action === "label") {
      if (fix.labels.length !== rows[0].content.length) {
        throw new Error(`table ${fix.table}: ${rows[0].content.length} header cells, ${fix.labels.length} labels`);
      }
      rows[0].content = rows[0].content.map((cell, i) => {
        const paragraph = (cell.content ?? []).find((c) => c.type === "paragraph");
        const attrs = paragraph?.attrs ? { attrs: paragraph.attrs } : {};
        return { ...cell, content: [{ type: "paragraph", ...attrs, content: [{ type: "text", text: fix.labels[i] }] }] };
      });
    } else {
      throw new Error(`unknown action ${fix.action}`);
    }
  }
  return copy;
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function readDoc(client, pageId) {
  const page = await client.request("/pages/info", { pageId, format: "json" });
  if (!page?.content || page.content.type !== "doc") throw new Error("page has no json content");
  return page;
}

const base = loadConfig();
const reader = new DocmostClient(base);
const actorConfig = loadActorConfigs(base).get(ACTOR);
if (MODE === "apply" && !actorConfig) throw new Error(`actor ${ACTOR} is not configured`);
const writer = actorConfig ? new DocmostClient(actorConfig) : undefined;

let failed = 0;
for (const item of PLAN) {
  const label = `${item.name} (${item.page})`;
  try {
    const page = await readDoc(reader, item.page);
    const before = page.content;
    if (MODE === "backup") {
      process.stdout.write(JSON.stringify({ id: item.page, title: page.title, updatedAt: page.updatedAt, content: before }) + "\n");
      continue;
    }
    const fixed = repair(before, item.fixes);
    validateDoc(fixed);
    const summary = item.fixes.map((f) => `t${f.table} ${f.action}`).join(", ");
    if (MODE !== "apply") {
      console.log(`PLAN ok   ${label}: ${summary}`);
      continue;
    }

    // Re-read right before writing, so an edit made since the plan check is not overwritten.
    const latest = await readDoc(reader, item.page);
    if (!sameJson(latest.content, before)) throw new Error("page changed during the run; skipped");
    await writer.assertWritable();
    await writer.request("/pages/update", { pageId: item.page, content: fixed, format: "json", operation: "replace" });
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

    const after = (await readDoc(reader, item.page)).content;
    const problems = [];
    // Docmost may split or merge text nodes, so text is compared joined and text nodes are not counted.
    if (allTexts(after).join("") !== allTexts(fixed).join("")) problems.push("text differs from what was sent");
    const counts = (d) => { const c = countTypes(d); delete c.text; return c; };
    if (!sameJson(counts(after), counts(fixed))) problems.push("node counts differ from what was sent");
    for (const f of item.fixes) {
      const row0 = tablesOf(after)[f.table]?.content?.[0];
      if (!row0 || isEmptyHeaderRow(row0) || !row0.content.every((c) => c.type === "tableHeader")) {
        problems.push(`t${f.table} header row not as expected`);
      }
    }
    if (problems.length) throw new Error(`written, but check failed: ${problems.join("; ")}`);
    console.log(`FIXED     ${label}: ${summary}; text and node counts match`);
  } catch (error) {
    failed += 1;
    console.log(`FAILED    ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
if (MODE !== "backup") console.log(`${PLAN.length - failed} of ${PLAN.length} pages ok (mode ${MODE})`);
process.exit(failed ? 1 : 0);
