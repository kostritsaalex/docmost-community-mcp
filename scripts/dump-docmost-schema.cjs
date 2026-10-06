// Prints the ProseMirror schema of a running Docmost server as JSON, for src/docmost-schema.ts.
// Run inside the Docmost app container, from the server folder, reading this file on stdin:
//   docker compose exec -T -w /app/apps/server <service> node - < dump-docmost-schema.cjs > docmost-schema.json
// Only the parts of the schema that decide validity are kept: content expressions, groups,
// allowed marks, attributes and whether they have defaults. No data, no secrets.
const path = require("node:path");
const { getSchema } = require("@tiptap/core");
const { tiptapExtensions } = require(path.resolve("dist/collaboration/collaboration.util.js"));

function attrsOf(spec) {
  if (!spec.attrs) return undefined;
  const attrs = {};
  for (const [name, attr] of Object.entries(spec.attrs)) {
    const out = {};
    if (attr && "default" in attr) {
      out.hasDefault = true;
      out.default = attr.default === undefined ? null : attr.default;
    }
    if (attr && typeof attr.validate === "string") out.validate = attr.validate;
    attrs[name] = out;
  }
  return attrs;
}

function pick(spec, keys) {
  const out = {};
  for (const key of keys) {
    if (spec[key] !== undefined) out[key] = spec[key];
  }
  const attrs = attrsOf(spec);
  if (attrs) out.attrs = attrs;
  return out;
}

const schema = getSchema(tiptapExtensions);
const nodes = [];
schema.spec.nodes.forEach((name, spec) => {
  nodes.push([name, pick(spec, ["content", "marks", "group", "inline", "atom", "code", "whitespace"])]);
});
const marks = [];
schema.spec.marks.forEach((name, spec) => {
  marks.push([name, pick(spec, ["excludes", "inclusive", "group", "spanning", "code"])]);
});

function prosemirrorModelVersion() {
  try {
    const from = path.dirname(require.resolve("@tiptap/pm/model"));
    return require(require.resolve("prosemirror-model/package.json", { paths: [from] })).version;
  } catch {
    return "unknown";
  }
}

const result = {
  docmostVersion: require("/app/package.json").version,
  prosemirrorModelVersion: prosemirrorModelVersion(),
  topNode: schema.spec.topNode || "doc",
  nodes,
  marks,
};

// Docmost modules may log on load; the schema is the last line of output.
process.stdout.write("\n" + JSON.stringify(result) + "\n");
