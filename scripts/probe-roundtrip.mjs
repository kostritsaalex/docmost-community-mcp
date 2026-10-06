// Measures whether Docmost stores a page body unchanged when its own json is written back
// with operation replace (DCMCP-US0077). Runs inside the gateway container with the gateway's
// code and credentials; page text never leaves the server, only paths and attribute names.
//
//   docker compose exec -T -e PROBE_PAGE=<uuid> -e DOCMOST_SESSION_PATH=/home/node/.docmost-community-mcp/probe.json \
//     docmost-mcp node --input-type=module - < probe-roundtrip.mjs
//
// Safety: refuses any page outside the Readme space or without "(delete me)" in its title.
// Two rounds: A -> write A -> B, then B -> write B -> C. Reports whether B equals A and C equals B.
import { loadActorConfigs, loadConfig } from "/app/dist/config.js";
import { DocmostClient } from "/app/dist/client.js";

const PAGE = process.env.PROBE_PAGE;
const ACTOR = process.env.PROBE_ACTOR ?? "opus";
const SETTLE_MS = 5000;
const MAX_LINES = 40;

if (!PAGE) throw new Error("Set PROBE_PAGE to the UUID of a throwaway page.");
const base = loadConfig();
const reader = new DocmostClient(base);
const actorConfig = loadActorConfigs(base).get(ACTOR);
if (!actorConfig) throw new Error(`actor ${ACTOR} is not configured`);
const writer = new DocmostClient(actorConfig);

async function read() {
  const page = await reader.request("/pages/info", { pageId: PAGE, format: "json" });
  return page;
}

// Lists where two json values differ: path plus a short reason, never text content.
function diff(a, b, path, out) {
  if (out.length > 10000) return out;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b) || (a === null) !== (b === null)) {
    out.push(`${path}: kind ${describe(a)} -> ${describe(b)}`);
    return out;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push(`${path}: length ${a.length} -> ${b.length}`);
    for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  if (a && typeof a === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(key in b)) out.push(`${path}.${key}: removed`);
      else if (!(key in a)) out.push(`${path}.${key}: added (${describe(b[key])})`);
      else diff(a[key], b[key], `${path}.${key}`, out);
    }
    return out;
  }
  if (a !== b) out.push(`${path}: value changed${path.endsWith(".text") ? "" : ` (${short(a)} -> ${short(b)})`}`);
  return out;
}
const describe = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v === "object" ? `object` : `${typeof v} ${short(v)}`);
const short = (v) => JSON.stringify(v)?.slice(0, 30);

function report(label, before, after) {
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (same) {
    console.log(`${label}: IDENTICAL (${JSON.stringify(after).length} bytes)`);
    return;
  }
  const lines = diff(before, after, "doc", []);
  console.log(`${label}: DIFFERENT, ${lines.length} differences (${JSON.stringify(before).length} -> ${JSON.stringify(after).length} bytes)`);
  const kinds = {};
  for (const line of lines) {
    const key = line.replace(/\[\d+\]/g, "[]").replace(/:.*/, "");
    kinds[key] = (kinds[key] ?? 0) + 1;
  }
  console.log("  by path pattern:");
  for (const [key, n] of Object.entries(kinds).sort((x, y) => y[1] - x[1]).slice(0, 15)) console.log(`    ${n}  ${key}`);
  console.log(`  first ${Math.min(MAX_LINES, lines.length)}:`);
  for (const line of lines.slice(0, MAX_LINES)) console.log(`    ${line}`);
}

const start = await read();
if (start.space?.slug !== "readme" || !String(start.title).includes("(delete me)")) {
  throw new Error("Refusing: the probe only runs on a page in Readme whose title contains \"(delete me)\".");
}
await writer.assertWritable();

const a = start.content;
await writer.request("/pages/update", { pageId: PAGE, content: a, format: "json", operation: "replace" });
await new Promise((r) => setTimeout(r, SETTLE_MS));
const b = (await read()).content;
report("Round 1 (A written back)", a, b);

await writer.request("/pages/update", { pageId: PAGE, content: b, format: "json", operation: "replace" });
await new Promise((r) => setTimeout(r, SETTLE_MS));
const c = (await read()).content;
report("Round 2 (B written back)", b, c);
