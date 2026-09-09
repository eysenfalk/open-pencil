---
title: MCP Server
description: Connect Claude Code, Cursor, Windsurf, and other MCP clients to OpenPencil for AI-assisted design inspection and editing.
---

# MCP Server

OpenPencil includes an MCP (Model Context Protocol) server that lets AI coding tools — Claude Code, Cursor, Windsurf, etc. — read and modify designs through the running app.

Two transports: **stdio** for MCP clients, and **Streamable HTTP** for browser extensions and scripts. On macOS and Linux, local clients prefer a private Unix domain socket; Windows and unavailable sockets fall back to localhost TCP.

## Install

```sh
npm install -g @open-pencil/mcp
```

## Stdio (Claude Code, Cursor, etc.)

The stdio server discovers the running OpenPencil app automatically. It prefers the app's Unix domain socket on macOS and Linux and falls back to localhost TCP when needed. Make sure the desktop app is open with a document loaded.

### Claude Code

Install the MCP package and register it with Claude Code:

```sh
npm install -g @open-pencil/mcp
claude mcp add --scope user open-pencil -- openpencil-mcp
```

Check the connection:

```sh
claude mcp list
```

Claude Code asks before using each MCP tool unless you allow the server's tools. To auto-approve OpenPencil tools only, add this to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["mcp__open-pencil__*"]
  }
}
```

This is narrower than `--permission-mode bypassPermissions`, which skips prompts for every tool. You can also approve tools interactively from Claude's prompt by choosing “Yes, and don't ask again”.

Example prompt:

```text
Use the open-pencil MCP server to inspect the current page and create a small hero section on the canvas.
```

### Other MCP clients

Add to your MCP config (for example `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "open-pencil": {
      "command": "openpencil-mcp"
    }
  }
}
```

Or run from source without installing:

::: code-group
```json [Bun]
{
  "mcpServers": {
    "open-pencil": {
      "command": "bun",
      "args": ["/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```
```json [Node.js]
{
  "mcpServers": {
    "open-pencil": {
      "command": "npx",
      "args": ["tsx", "/path/to/open-pencil/packages/mcp/src/stdio.ts"]
    }
  }
}
```
:::

## HTTP

For browser extensions, scripts, CI, or any HTTP client:

```sh
openpencil-mcp-http
```

Or from source: `bun packages/mcp/src/index.ts` / `npx tsx packages/mcp/src/index.ts`

Security defaults:

- Unix socket and discovery files are created with owner-only permissions on macOS and Linux.
- TCP binds to `127.0.0.1` and uses port 7600 by default.
- Authentication is enabled by default with a generated token stored in the private discovery file.
- `eval` is disabled.
- File operations are limited to `OPENPENCIL_MCP_ROOT` (defaults to the current working directory) and reject symlink escapes.
- CORS is disabled by default; set `OPENPENCIL_MCP_CORS_ORIGIN` to allow one origin.

Set `PORT=0` to disable TCP on macOS and Linux. Windows requires TCP. Set `OPENPENCIL_MCP_SOCKET` to override the Unix socket path, or `OPENPENCIL_MCP_DISCOVERY_PATH` to override the discovery file location. To provide a stable token, set `OPENPENCIL_MCP_AUTH_TOKEN`; an explicitly empty value disables authentication and should only be used with a trusted local socket.

### Private remote development

A remotely hosted development editor can connect its browser bridge to the same server-side MCP runtime. Set both public endpoints and keep them behind an authenticated private network or reverse proxy:

```sh
OPENPENCIL_DEV_ORIGIN=https://editor.example.test \
OPENPENCIL_DEV_AUTOMATION_URL=wss://automation.example.test \
OPENPENCIL_MCP_ROOT=/srv/designs \
OPENPENCIL_DEV_TOKEN="$(openssl rand -hex 32)" \
  bun run dev -- --host 127.0.0.1
```

`OPENPENCIL_DEV_ORIGIN` must be an HTTP(S) origin and `OPENPENCIL_DEV_AUTOMATION_URL` must use `ws` or `wss`. The development server embeds the token in the served app so its browser bridge can authenticate; do not expose this setup to the public internet. `OPENPENCIL_MCP_ROOT` provides the initial file-operation boundary.

Endpoints are available over both active transports:

- `GET /health` — server and app connection status; never returns the auth token.
- `POST /rpc` — authenticated live-app automation.
- `POST /mcp` — MCP Streamable HTTP. Sessions use the `mcp-session-id` header.

## Pi quickstart: private server from source

This Linux quickstart takes a fresh clone to a Tailscale-only editor with the source-built CLI, MCP bridge, and OpenPencil skill available in [Pi](https://github.com/badlogic/pi-mono). It deliberately uses Tailscale Serve rather than Funnel: do not publish the development server to the public internet.

### 1. Clone and build

Install [Bun](https://bun.com/docs/installation), [Tailscale](https://tailscale.com/download), and Pi first, then:

```sh
git clone https://github.com/eysenfalk/open-pencil.git
cd open-pencil
bun install --frozen-lockfile
bun run build:packages

# Expose the source-built CLI and MCP launcher in your user PATH.
(cd packages/cli && bun link --global)
(cd packages/mcp && bun link --global)

openpencil --version
command -v openpencil-mcp
```

This URL includes the private remote-development support described below. Substitute another fork only if it contains the same changes.

### 2. Configure the private service

Get this machine's MagicDNS name from `tailscale status`; omit its trailing dot. Choose a dedicated file root so agent file operations cannot escape into the rest of your home directory:

```sh
export TAILSCALE_HOST="your-machine.your-tailnet.ts.net"
export REPO_DIR="$PWD"
export BUN_BIN="$(command -v bun)"
export BUN_DIR="$(dirname "$BUN_BIN")"
export DESIGN_ROOT="$HOME/open-pencil-designs"

mkdir -p "$DESIGN_ROOT" "$HOME/.config/openpencil" "$HOME/.config/systemd/user"
umask 077
OPENPENCIL_TOKEN="$(openssl rand -hex 32)"
cat >"$HOME/.config/openpencil/server.env" <<EOF
OPENPENCIL_DEV_ORIGIN=https://$TAILSCALE_HOST:1420
OPENPENCIL_DEV_AUTOMATION_URL=wss://$TAILSCALE_HOST:7600
OPENPENCIL_MCP_ROOT=$DESIGN_ROOT
OPENPENCIL_DEV_TOKEN=$OPENPENCIL_TOKEN
EOF

cat >"$HOME/.config/systemd/user/openpencil.service" <<EOF
[Unit]
Description=OpenPencil private web editor and MCP bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
EnvironmentFile=$HOME/.config/openpencil/server.env
Environment=PATH=$BUN_DIR:/usr/local/bin:/usr/bin:/bin
ExecStart=$BUN_BIN run dev -- --host 127.0.0.1
Restart=on-failure
RestartSec=3
UMask=0077
NoNewPrivileges=true

[Install]
WantedBy=default.target
EOF

chmod 600 "$HOME/.config/openpencil/server.env"
systemctl --user daemon-reload
systemctl --user enable --now openpencil.service
# Optional but recommended for operation without an active login session:
sudo loginctl enable-linger "$USER"
```

The development server starts the matching authenticated MCP runtime on local port `7600`. Keep `server.env` private: its token is embedded into the served editor so the browser bridge can authenticate.

### 3. Publish only inside the tailnet

```sh
tailscale serve --bg --https=1420 http://127.0.0.1:1420
tailscale serve --bg --https=7600 http://127.0.0.1:7600
tailscale serve status
```

Open `https://$TAILSCALE_HOST:1420` from a device in the same tailnet. Then check `https://$TAILSCALE_HOST:7600/health`; its status becomes `ok` once the editor tab has connected. Apply Tailscale ACLs if the tailnet contains users who should not control this editor. Never use `tailscale funnel` for this development deployment.

### 4. Connect Pi

Install the Pi MCP adapter and OpenPencil skill:

```sh
pi install npm:pi-mcp-adapter
pi install git:github.com/eysenfalk/open-pencil-skills@dcbf78a59c1398bb742bed98b113b17484025afe
```

The server isolates this runtime under a deterministic discovery path. Add that path to Pi's MCP config without discarding any existing servers:

```sh
export MCP_RUNTIME_ID="$TAILSCALE_HOST:7600"
export MCP_RUNTIME_HASH="$(printf %s "$MCP_RUNTIME_ID" | sha256sum | cut -c1-16)"
export OPENPENCIL_DISCOVERY_PATH="${TMPDIR:-/tmp}/open-pencil-mcp/$MCP_RUNTIME_HASH/mcp.json"

mkdir -p "$HOME/.config/mcp"
node <<'NODE'
const fs = require('node:fs')
const path = require('node:path')
const configPath = path.join(process.env.HOME, '.config/mcp/mcp.json')
const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {}
config.mcpServers ??= {}
config.mcpServers['open-pencil'] = {
  command: 'openpencil-mcp',
  env: { OPENPENCIL_MCP_DISCOVERY_PATH: process.env.OPENPENCIL_DISCOVERY_PATH },
  // Keep the high-frequency live-design loop immediately available while the
  // remaining 100+ tools stay discoverable through the adapter's MCP proxy.
  directTools: [
    'list_documents',
    'list_pages',
    'get_selection',
    'select_nodes',
    'get_page_tree',
    'get_node',
    'query_nodes',
    'render',
    'update_node',
    'batch_update',
    'set_fill',
    'set_stroke',
    'set_effects',
    'set_layout',
    'set_text',
    'set_font',
    'clone_node',
    'viewport_zoom_to_fit',
    'export_image',
    'save_file'
  ],
  approveTools: ['delete_*', 'open_file', 'new_document', 'save_file']
}
fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
NODE
chmod 600 "$HOME/.config/mcp/mcp.json"
pi list
```

Restart Pi so it discovers the newly installed adapter and skill. Keep the editor URL open, then ask:

```text
Use the OpenPencil skill and MCP server. Call list_documents, inspect the current page, and summarize its structure without modifying it.
```

A successful `list_documents` call confirms the full path: Pi → MCP adapter → stdio launcher → server discovery → authenticated browser bridge → editor. The CLI can also work headlessly by passing a `.fig` or `.pen` path; MCP app-mode calls require a connected editor tab.

The server-level `OPENPENCIL_MCP_ROOT` remains authoritative when a browser has no explicit MCP root preference. Use the smallest directory that contains the designs Pi should open, save, or export. In a multi-project workspace this can be the projects directory; a dedicated design directory is safer when practical.

### 5. Work live with visual verification

Keep the editor URL and target document open while Pi works. Use an image-capable model (`pi --list-models` shows an `images` column), and leave Pi's `images.blockImages` setting disabled. `terminal.showImages` only controls whether you also see inline images in Pi's terminal.

For each task, have Pi follow this loop:

1. Call `list_documents`, then pass the returned `document_id` and `page_id` explicitly on later calls.
2. Inspect the target with `get_selection`, `get_page_tree`, `get_node`, or `query_nodes`.
3. Create coherent UI trees with `render`; use `batch_update` and focused style/layout tools for revisions so the browser receives meaningful change batches.
4. Call `export_image` for the affected frame after each meaningful revision. Prefer one frame at a time with a longest edge around 1,600–2,000 pixels instead of exporting a very wide multi-screen page.
5. Evaluate the returned native image, correct visual problems, and repeat until the design meets the request.
6. Call `save_file` explicitly when the accepted live state should be persisted.

`export_image` returns the rendered design itself rather than the browser chrome, viewport, panels, or cursor. This makes visual review independent of the remote browser's size and zoom. Use a browser automation screenshot only when you specifically need to inspect OpenPencil's own interface.

Do not edit the same `.fig` file headlessly with the CLI while it is also being changed in the live editor. Use the CLI for disconnected/headless inspection, CI, or durable export artifacts after the live state has been saved.

### 6. Update and troubleshoot

```sh
cd /path/to/open-pencil
git pull --ff-only
bun install --frozen-lockfile
bun run build:packages
systemctl --user restart openpencil.service

systemctl --user status openpencil.service
tailscale serve status
curl "https://$TAILSCALE_HOST:7600/health"
```

If Pi lists the MCP server but a tool reports that the app is not connected, open or reload the editor URL. If the UI loads but the WebSocket does not, verify that both Tailscale Serve ports are configured and that the two public origins in `server.env` use the same MagicDNS hostname.

## Workflow

1. **Discover targets** — call `list_documents` first when more than one document or page may be open. It returns stable `document_id` and page IDs.
2. **Open** — `open_file` to load an existing `.fig`, or `new_document` for a blank canvas. These return target metadata for the opened or created document.
3. **Read** — `get_page_tree`, `find_nodes`, `get_node`, `list_pages`
4. **Create** — `create_shape`, `render` (JSX)
5. **Modify** — `set_fill`, `set_stroke`, `set_layout`, `update_node`, `set_effects`
6. **Structure** — `reparent_node`, `group_nodes`, `clone_node`, `delete_node`
7. **Save** — `save_file` to write back to `.fig`

Most tools accept optional `document_id` and `page_id` fields. Pass them explicitly for agent workflows instead of relying on the visible active tab/page. `create_page` only creates a page; call `switch_page` separately when the workflow should change the active page.

## AI Agent Skill

Teach your AI coding agent to use OpenPencil tools:

```sh
npx skills add open-pencil/skills@open-pencil
```

Works with Claude Code, Cursor, Windsurf, Codex, and any agent that supports [skills](https://skills.sh). The skill covers the CLI, MCP tools, JSX rendering, eval, and the running app's automation bridge.

## Tools

OpenPencil currently registers 100+ shared design tools, plus MCP-only document and prompt operations when applicable.

### Document

| Tool | Description |
|------|-------------|
| `open_file` | Open a `.fig` file for editing |
| `save_file` | Save the current document to a `.fig` file |
| `new_document` | Create a new empty document |
| `list_documents` | List open app documents/tabs and their pages |

### Read

| Tool | Description |
|------|-------------|
| `get_selection` | Get currently selected nodes |
| `get_page_tree` | Get the full node tree of the current page |
| `get_current_page` | Get the current page name and ID |
| `get_node` | Get detailed properties of a node by ID |
| `find_nodes` | Find nodes by name pattern and/or type |
| `get_components` | List all components in the document |
| `list_pages` | List all pages |
| `list_variables` | List design variables |
| `list_collections` | List variable collections |
| `list_fonts` | List fonts used in the current page |
| `list_available_fonts` | List font families the current host can render |
| `get_font_status` | Report requested faces, loaded sources, active substitutions, and affected nodes |
| `page_bounds` | Get bounding box of all objects on the current page |
| `node_bounds` | Get bounding box of a node |
| `node_ancestors` | Get ancestor chain of a node |
| `node_children` | Get direct children of a node |
| `node_tree` | Get the subtree rooted at a node |
| `node_bindings` | Get variable bindings on a node |

### Create

| Tool | Description |
|------|-------------|
| `create_shape` | Create a shape (`FRAME`, `RECTANGLE`, `ELLIPSE`, `TEXT`, `LINE`, `STAR`, `POLYGON`, `SECTION`) |
| `create_vector` | Create a vector node from a path string |
| `create_slice` | Create an export slice |
| `create_page` | Create a new page |
| `render` | Render JSX to design nodes — create entire component trees in one call |
| `create_component` | Convert a frame/group into a component |
| `create_instance` | Create an instance of a component |
| `node_to_component` | Convert an existing node into a component in-place |

### Modify

| Tool | Description |
|------|-------------|
| `set_fill` | Set fill color (hex) |
| `set_stroke` | Set stroke color, weight, alignment |
| `set_effects` | Add shadow or blur effects |
| `update_node` | Update position, size, opacity, corner radius, text, font |
| `set_layout` | Set auto-layout (flexbox) — direction, spacing, padding, alignment |
| `set_constraints` | Set resize constraints |
| `set_rotation` | Set rotation angle in degrees |
| `set_opacity` | Set opacity (0–1) |
| `set_radius` | Set corner radius (uniform or per-corner) |
| `set_minmax` | Set min/max width and height constraints |
| `set_text` | Set text content of a `TEXT` node |
| `set_font` | Set font family and weight |
| `set_font_range` | Set font properties on a character range |
| `set_text_resize` | Set text auto-resize mode (fixed/auto-width/auto-height) |
| `set_visible` | Show or hide a node |
| `set_blend` | Set blend mode |
| `set_locked` | Lock or unlock a node |
| `set_stroke_align` | Set stroke alignment (inside/center/outside) |
| `set_text_properties` | Set text layout: alignment, auto-resize, text case, decoration, truncation |
| `set_layout_child` | Configure auto-layout child: sizing, grow, alignment, absolute positioning |
| `node_move` | Move a node to a new position |
| `node_resize` | Resize a node |
| `node_replace_with` | Replace a node with another node |
| `arrange` | Align or distribute selected nodes |

### Structure

| Tool | Description |
|------|-------------|
| `delete_node` | Delete a node |
| `clone_node` | Duplicate a node |
| `rename_node` | Rename a node |
| `reparent_node` | Move a node into a different parent |
| `select_nodes` | Select nodes by ID |
| `group_nodes` | Group nodes |
| `ungroup_node` | Ungroup a group |
| `flatten_nodes` | Flatten nodes into a single vector |
| `boolean_union` | Boolean union of two or more nodes |
| `boolean_subtract` | Boolean subtraction |
| `boolean_intersect` | Boolean intersection |
| `boolean_exclude` | Boolean exclusion |

### Vector Path

| Tool | Description |
|------|-------------|
| `path_get` | Get the path data of a vector node |
| `path_set` | Set the path data of a vector node |
| `path_scale` | Scale a vector path |
| `path_flip` | Flip a vector path horizontally or vertically |
| `path_move` | Translate a vector path |

### Export

| Tool | Description |
|------|-------------|
| `export_image` | Export nodes as PNG, JPG, or WEBP. Returns base64-encoded image data |
| `export_svg` | Export nodes as SVG markup |

### Viewport

| Tool | Description |
|------|-------------|
| `viewport_get` | Get current viewport position and zoom level |
| `viewport_set` | Set viewport position and zoom |
| `viewport_zoom_to_fit` | Zoom viewport to fit specified nodes |

### Variables

| Tool | Description |
|------|-------------|
| `get_variable` | Get a variable by ID or name |
| `find_variables` | Find variables by name pattern or type |
| `create_variable` | Create a new variable in a collection |
| `set_variable` | Set a variable value in a mode |
| `delete_variable` | Delete a variable |
| `bind_variable` | Bind a variable to a node property |
| `get_collection` | Get a variable collection by ID or name |
| `create_collection` | Create a new variable collection |
| `delete_collection` | Delete a variable collection |

### Analyze

| Tool | Description |
|------|-------------|
| `analyze_colors` | Analyze color palette usage across the document |
| `analyze_typography` | Analyze font/size/weight distribution |
| `analyze_spacing` | Analyze gap and padding values |
| `analyze_clusters` | Detect repeated patterns (potential components) |

### Diff

| Tool | Description |
|------|-------------|
| `diff_create` | Create a snapshot of the current document state |
| `diff_show` | Show differences between the current state and a snapshot |

### Navigation

| Tool | Description |
|------|-------------|
| `switch_page` | Switch to a page by name or ID |

### Escape Hatch

| Tool | Description |
|------|-------------|
| `eval` | Execute JavaScript with full Figma Plugin API access |

Note: `eval` is available over stdio, but disabled in HTTP mode for security.
