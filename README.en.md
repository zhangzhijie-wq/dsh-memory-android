**English** | [简体中文](README.md)

# dsh-memory — Long-term memory plugin for DSHA

> **Version `0.2.1`** · MIT License · Zero native dependencies (Node built-ins only, runs on aarch64)
> Tested with: DSHA App `0.2.1-rc.2` · DSH `0.2.1-rc.2` · Node `>= 20`

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
- **System prompt snapshot (token-saving design)**: on startup, memories are injected
  into the system prompt in two tiers — rule/guardrail/preference entries (`kind` is
  `rule` or `preference`, plus entries tagged 「红线/守则/铁律/硬规则」) are loaded **in full,
  never truncated**; other `fact`/`note` entries are injected as **titles only**, with
  full text retrievable via `memory_search` on demand. See "Token-saving design" below.
- **Zero native dependencies**: Node built-ins only — no build step, no binaries,
  works on arm64 phones

## Install

1. Put this repository in the plugin directory inside the container
   (any path, e.g. `~/dsha-memory`).
2. Make dependencies resolvable: symlink the plugin's `node_modules` to the one
   shipped with DSH.
3. In the web profile's `package.json`:
   - add `"dsh-memory": "link:<plugin-dir>"` to `dependencies`
   - add `"dsh-memory"` to the `dsh.profile.bundles` array
4. Create a symlink under the profile's `node_modules` pointing at the plugin directory.
5. Restart DSHA Web (the profile directory is usually `$DSH_HOME/profiles/web`).

## Token-saving design

The system prompt is billed with every request, so "what to inject and how much" drives
cost directly. This version splits memories into tiers:

| Tier | Which memories | Injection | Rationale |
| --- | --- | --- | --- |
| Full | `kind` is `rule` / `preference`, or tags contain 「红线/守则/铁律/硬规则」 | **Full text**, no truncation, no count cap | These are binding constraints; dropping any line risks a violation |
| Title | other `fact` / `note` entries | **Title only** (prefer `【…】` heading, else text before the first colon or first sentence, capped at 60 chars) | Knowing the memory exists is usually enough; details are fetched on demand |

Supporting rules:

- Title tier injects at most the latest 20 entries; the full tier **never drops any rule**;
- The whole section has a 15000-char safety valve, so rule text is not truncated at normal scale;
- When the full text behind a title is needed, the model calls `memory_search` with keywords
  (and `limit` to control the number of hits).

**Building the snapshot once at startup is the core token-saving move.** Re-reading the whole
store and re-rendering the snapshot on every request means paying for all memories again and
again; this plugin instead assembles once at startup and pays zero repeatedly for the session:

- The snapshot is built at host startup, keeping prompt usage minimal for the whole session;
- Memories saved or edited during the session hit the store immediately and are live through
  `memory_search` / `memory_list` — "hot data" fetched on demand, never occupying the
  standing context;
- To promote one into the always-injected prompt, just restart the host once: one restart buys
  zero repeated cost for the entire session — a very good trade.

Compared with the previous version (latest 20 entries, each truncated at 180 chars, whole
section capped at 2400 chars), the old approach often discarded older memories and could
truncate rules mid-sentence; the new one keeps constraint memories **complete** while
slimming factual ones, at the same or lower prompt cost.

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
