# docmost-community-mcp

Model Context Protocol server for self-hosted [Docmost](https://docmost.com) **Community / Open Source Edition**.

Source: [github.com/dilruwanm/docmost-community-mcp](https://github.com/dilruwanm/docmost-community-mcp)

Official Docmost MCP and API keys are Enterprise-only. This server talks to the same internal HTTP API the Docmost web app uses, so you can search, read, write, and organize a CE wiki from Cursor, Claude, or any MCP client.

Requires **Docmost v0.71+** for Markdown body writes. Latest verified target is **v0.95.0**.

## Install

```bash
npx -y docmost-community-mcp
```

From source:

```bash
git clone https://github.com/dilruwanm/docmost-community-mcp.git
cd docmost-community-mcp
npm install
npm run build
```

## What you get

Official Enterprise MCP tool names, plus Community extras those docs omit.

**Pages:** `search_pages`, `get_page`, `create_page`, `update_page`, `list_pages`, `list_child_pages`, `duplicate_page`, `copy_page_to_space`, `move_page`, `move_page_to_space`, `delete_page`, `restore_page`, `list_trash`, `get_page_history`, `get_history_version`, `get_breadcrumbs`, `get_backlinks`, `export_page`

**Spaces:** `list_spaces`, `get_space`, `create_space`, `update_space`, `delete_space`, `export_space`

**Comments:** `get_comments`, `create_comment`, `update_comment`, `delete_comment`

**Search / people:** `search_attachments`, `search_suggest`, `list_workspace_members`, `get_current_user`

**Files / labels / access:** `upload_attachment`, `get_attachment_info`, `list_page_labels`, `add_page_labels`, `remove_page_label`, `list_space_members`, `add_space_members`, `remove_space_member`, `update_space_member_role`

Page and comment bodies are **Markdown**. Updates go through `POST /api/pages/update` with `format: "markdown"` so Docmost converts and applies the change in place. The server does not open a Yjs socket or invent its own TipTap schema.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `DOCMOST_URL` | yes | Instance URL, e.g. `https://docs.example.com` |
| `DOCMOST_EMAIL` + `DOCMOST_PASSWORD` | one auth method | Community login |
| `DOCMOST_AUTH_TOKEN` | one auth method | `authToken` cookie from the browser |
| `DOCMOST_SESSION_PATH` | no | Session cache file |
| `DOCMOST_READ_ONLY` | no | `true` / `1` / `yes` — search and read only; mutating tools are refused |

Email/password is preferred. The JWT is cached under `~/.docmost-community-mcp/session.json` and refreshed on 401. MFA accounts cannot complete login here — use `DOCMOST_AUTH_TOKEN` instead.

Use a dedicated Docmost user. Do not commit credentials.

## Cursor

Add to `.cursor/mcp.json` or `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "docmost": {
      "command": "npx",
      "args": ["-y", "docmost-community-mcp"],
      "env": {
        "DOCMOST_URL": "https://docs.example.com",
        "DOCMOST_EMAIL": "you@example.com",
        "DOCMOST_PASSWORD": "your-password"
      }
    }
  }
}
```

From a local clone:

```json
{
  "mcpServers": {
    "docmost": {
      "command": "node",
      "args": ["/absolute/path/to/docmost-community-mcp/dist/index.js"],
      "env": {
        "DOCMOST_URL": "https://docs.example.com",
        "DOCMOST_EMAIL": "you@example.com",
        "DOCMOST_PASSWORD": "your-password"
      }
    }
  }
}
```

## Claude Desktop / Claude Code

Same `mcpServers` block as above. Claude Code:

```bash
claude mcp add docmost --env DOCMOST_URL=https://docs.example.com --env DOCMOST_EMAIL=you@example.com --env DOCMOST_PASSWORD=secret -- npx -y docmost-community-mcp
```

## HTTP mode (remote hosting)

By default the server speaks MCP over stdio. Set `MCP_TRANSPORT=http` to run one shared instance that many clients reach over the network. One process keeps one Docmost login and serves every MCP session.

Both MCP transports are served, so clients connect without a bridge such as `mcp-remote`:

| Path | Transport | Typical clients |
|---|---|---|
| `/<secret>/mcp` | Streamable HTTP (POST, GET, DELETE) | Current CLIs and IDEs |
| `/<secret>/sse` and `/<secret>/messages` | Legacy HTTP+SSE | Connectors that only speak SSE |
| `/healthz` | Liveness check, returns `ok` | Docker, monitoring |

| Variable | Default | Purpose |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http` |
| `MCP_PATH_SECRET` | none, required | Secret first path segment, at least 32 characters of `A-Z a-z 0-9 - _`. Generate with `openssl rand -hex 32` |
| `MCP_ALLOWED_HOSTS` | none | Comma-separated host names accepted in the `Host` header. Set it to the public name |
| `MCP_HTTP_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` inside a container) |
| `MCP_HTTP_PORT` | `3001` | Listen port |
| `MCP_SESSION_IDLE_MINUTES` | `30` | Streamable HTTP sessions with no traffic for this long are closed; the client starts a new one |

The client URL is `https://mcp.example.com/<secret>/mcp`, or `https://mcp.example.com/<secret>/sse` for SSE-only clients.

### Security model

- **The URL is the credential.** Anyone who has it acts as the configured Docmost user. Treat it like a password, and rotate the secret if it leaks.
- Any path without the right secret gets an empty `404`, so a scan cannot tell the server is there. The secret is compared in constant time and never logged.
- With `MCP_ALLOWED_HOSTS` set, a request with any other `Host` header gets `403` (DNS rebinding protection).
- Docmost credentials come only from the server environment. Use a dedicated member account, not the workspace owner. `DOCMOST_READ_ONLY=true` gives read-only access.
- `export_page`, `export_space` and `upload_attachment` are **not offered in HTTP mode**. They read or write files on the machine running the server, which for a shared server is not the caller's computer and holds the credentials.
- Terminate TLS in a reverse proxy and publish the port on loopback only. Keep proxy access logs off for this site, or strip the path, because the path carries the secret.

### Actors: one Docmost account per model

A shared server normally writes everything as `DOCMOST_EMAIL`. To see in Docmost page history which model created or changed a page, define named actors, each with its own Docmost account:

```bash
DOCMOST_ACTORS=opus,sonnet,other
DOCMOST_ACTOR_OPUS_EMAIL=opus@example.com
DOCMOST_ACTOR_OPUS_PASSWORD=...
DOCMOST_ACTOR_SONNET_EMAIL=sonnet@example.com
DOCMOST_ACTOR_SONNET_PASSWORD=...
DOCMOST_ACTOR_OTHER_EMAIL=other@example.com
DOCMOST_ACTOR_OTHER_PASSWORD=...
```

Names are lowercase letters, digits and `-`; in variable names they are upper-cased and `-` becomes `_`. The server refuses to start if an actor lacks its email or password, and the message names the variable, never its value.

With actors defined:

- Every write or destructive tool requires an `actor` input. Its allowed values are the actor names, listed in the tool schema, so the agent sees them. A missing or unknown actor is rejected before anything is written.
- The write runs in Docmost as that actor, with its own login and session cache (`session.<actor>.json` next to the default one).
- Read tools have no `actor` input and use the default account (`DOCMOST_EMAIL`), so a read never fails because an actor lacks access to a space.
- Without `DOCMOST_ACTORS`, nothing changes: no `actor` input, every call uses the default account. This also works in stdio mode.

**Trust model: attribution, not authentication.** The server cannot verify which model is calling. Anyone with the URL can name any actor, so giving actors different Docmost rights is not a security boundary. Use the actors to record who wrote what; control access through the URL and the rights of the accounts as a group.

### Docker

`Dockerfile` builds an HTTP-mode image that runs as the `node` user. `deploy/compose.example.yaml` runs it with a read-only root filesystem, the port on `127.0.0.1` only, and settings from a `.env` file:

```bash
cp .env.example deploy/.env    # fill in DOCMOST_*, MCP_PATH_SECRET, MCP_ALLOWED_HOSTS
chmod 600 deploy/.env
docker compose -f deploy/compose.example.yaml up -d --build
```

Caddy in front of it:

```caddy
mcp.example.com {
	reverse_proxy 127.0.0.1:3001
}
```

## Design notes

- **stdio by default**, with an optional HTTP mode (Streamable HTTP and legacy SSE) for shared hosting.
- **No Enterprise license, no Docmost database access, no Docmost fork.**
- Space slugs are accepted anywhere a space id is required.
- `move_page` computes the required fractional `position` key (`first`, `last`, or after a sibling).
- `create_page` / `update_page` fail clearly on servers older than v0.71 instead of silently dropping the body. `get_current_user` reports `docmostVersion` from Docmost's `currentVersion` field.
- `delete_space` requires `confirm: true`. Mutating tools honor `DOCMOST_READ_ONLY`.
- `list_pages` defaults to recently updated pages. Pass `view=tree` for sidebar-root pages.
- `search_attachments` is Enterprise-only; Community hosts get a clear 403 message.
- Export tools write a zip or a single `.md`/`.html` file to `output_path` or a temp file and return the path.

## License

MIT. This package does not include Docmost AGPL or Enterprise source.
