**English** | [简体中文](README.md)

# dsh-memory — Long-term memory plugin for DSHA

> **Version `0.2.0`** · MIT License · Zero native dependencies (Node built-ins only, runs on aarch64)
> Tested with: DSHA App `0.1.7-rc2` · DSH `0.1.7-rc.2` · Node `>= 20`

Long-term memory for DSHA (DeepSeek Harness on Android): memories are stored in a local
JSON file the model can read and write at any time, with a phone-friendly management UI.

## Features

- **Store**: a single JSON file, written atomically (temp file + rename), mode 600
- **6 MCP tools**: `memory_save` / `memory_search` / `memory_list` /
  `memory_update` / `memory_forget` / `memory_stats`
- **Settings page "Memory"**: registered into `settings.section`; full-page
  list / search / create / edit / delete
- **Composer icon**: registered into `conversation.input.left`; opens the same
  panel as a dialog (portaled to `body`)
- **Web editor** (fallback): `GET /memory-editor/editor`
- **System prompt snapshot**: the latest 20 memories are injected into the
  system prompt at startup, so the model "remembers" out of the box
- **Zero native dependencies**: Node built-ins only — no build step, no binaries,
  works on arm64 phones

## Install

1. Put this repository in the plugin directory inside the container
   (e.g. `/root/dsha-memory`).
2. Make dependencies resolvable: symlink the plugin's `node_modules` to the one
   shipped with DSH.
3. In the web profile's `package.json`:
   - add `"dsh-memory": "link:<plugin-dir>"` to `dependencies`
   - add `"dsh-memory"` to the `dsh.profile.bundles` array
4. Create a symlink under the profile's `node_modules` pointing at the plugin directory.
5. Restart DSHA Web (the profile directory is usually `$DSH_HOME/profiles/web`).

## Data & privacy

- Memories are stored by default in `$DSH_HOME/memory/store.json`
  (override with the `DSHA_MEMORY_DIR` environment variable) — **outside this repository**.
- The bundled `.gitignore` excludes `store.json`, `node_modules`, `.env` and logs.
- The plugin only reads and writes local files; it sends no data to any network service.
- The web editor API accepts loopback requests only (Host must be `localhost` / `127.x`),
  and write operations additionally require a per-launch key.

## Files

| Path | Purpose |
| --- | --- |
| `lib/index.js` | Plugin entry: MCP child process + system prompt + web editor routes |
| `lib/server.cjs` | Memory service core (MCP stdio, JSON-RPC 2.0); also the CLI / web API library |
| `lib/editor.html` | Web editor page (mobile-first, static, no build) |
| `lib/client.js` | Client plugin: settings page + composer icon (hand-written bundle, no build) |
| `cli.mjs` | Command-line interface |
| `cordis.patch.yml` | Plugin-tree mount entry |

## HTTP API

```
GET  /memory-editor/editor    editor page (embeds the key generated at launch)
GET  /memory-editor/api       -> {total, shown, store, memories[]}
POST /memory-editor/api       header x-memory-key, body {action: save|update|forget, ...}
```

The routes deliberately avoid the `/plugins/...` prefix, which is reserved by the
client module system and would collide.

## CLI

```sh
node cli.mjs list 20
node cli.mjs search device preference
node cli.mjs save "content" --tags device,env --kind fact
node cli.mjs forget m-xxxxxxxxxxxx
node cli.mjs stats
```

## Uninstall

Remove `dsh-memory` from the profile's `dsh.profile.bundles`, delete the
`node_modules/dsh-memory` symlink and restart. Memories live in
`$DSH_HOME/memory/store.json` and are not removed by uninstalling the plugin.

## License

MIT
