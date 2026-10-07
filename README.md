# dsh-memory —— DSHA 长期记忆插件

> **版本 `0.2.0`** · MIT License · 零原生依赖（只用 Node 内置模块，aarch64 手机直接可用）
> 适配环境：DSHA App **0.1.7-rc2**（code 147）· DSH 本体 `0.1.7-rc.2` · node `v24`（此环境实测通过）

自己写的、**这分钟就能用**的记忆插件。装在这台手机上，已经在跑的 DSHA Web 里生效了。

## 它是什么

- **记忆库**：一个 JSON 文件 `/root/.dsh/memory/store.json`（原子写入，600 权限）。
- **6 个工具**（模型可直接调用，MCP 暴露）：
  `memory_save` / `memory_search` / `memory_list` / `memory_update` /
  `memory_forget` / `memory_stats`
- **设置页「记忆插件」（主入口）**：注册进 `settings.section`，在「设置」里多一页
  **记忆插件**，整页就是记忆管理（列表 / 搜索 / 增删改），不需要弹窗、不跳网页。
- **输入框图标**：`conversation.input.left`（`+` 号那一排）一个黑白线条「脑子」图标，
  点开是同款面板的弹窗形态（Portal 到 body，避免被带 transform 的祖先困住）。
- **网页编辑器（备用入口）**：
  <http://127.0.0.1:3080/memory-editor/editor>
- **系统提示词快照**：DSH 启动时把最近 20 条记忆注入 systemPrompt（`order: 160`），
  模型一上来就「记得」，不用先搜。
- **零原生依赖**：只用 node 内置模块。这是关键取舍 —— 上一个记忆插件
  `@achasoft/dsh-memory` 装不上就是因为它的 `@duckdb/node-api` 原生二进制在
  aarch64 手机上加载失败（状态：LOADER_OR_BROWSER_FAILED）。该插件已按用户要求删除。

## 文件

| 路径 | 作用 |
| --- | --- |
| `/root/dsha-memory/lib/index.js` | cordis 插件入口：MCP 子进程 + 系统提示词 + Web 编辑路由 |
| `/root/dsha-memory/lib/server.cjs` | 记忆服务本体（MCP stdio，JSON-RPC 2.0），也是 CLI 和 Web API 的库 |
| `/root/dsha-memory/lib/editor.html` | 编辑页面（手机优先，纯静态，无构建步骤） |
| `/root/dsha-memory/lib/client.js` | 客户端插件：设置页「记忆插件」+ 输入框脑子图标（手写 bundle，无构建） |
| `/root/dsha-memory/cli.mjs` | 终端 CLI（已软链成 `dsh-memory`） |
| `/root/dsha-memory/cordis.patch.yml` | 插件树插入项（id `dsha-memory`） |
| `/root/.dsh/memory/store.json` | 记忆数据 |

## 网页编辑器 / HTTP API

`GET  /memory-editor/editor` → 编辑页面（页面内嵌本次启动生成的密钥）
`GET  /memory-editor/api` → `{total, shown, store, memories[]}`
`POST /memory-editor/api` → 头带 `x-memory-key`，体 `{action: save|update|forget, ...}`

路径故意不用 `/plugins/...`：那是客户端模块系统的前缀路由，会撞车。

两条路由都只接受本机回环请求（Host 必须是 localhost/127.x），POST 另需密钥。

## 安装方式（已完成，无需重做）

1. 源码目录 `/root/dsha-memory`，`node_modules` 软链到
   `../../usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules`
   （与 `dsha-tool-vscreen` 等内置插件同款写法）。
2. `ln -s ../../../../dsha-memory /root/.dsh/profiles/web/node_modules/dsh-memory`
3. web profile 的 `package.json`：`dependencies` 加
   `"dsh-memory": "link:/root/dsha-memory"`，`dsh.profile.bundles` 加 `"dsh-memory"`。
4. 生效：已热加载进正在运行的实例（无需重启）。若哪天没生效，重启一次 DSHA Web 即可。

## CLI

```sh
node /root/dsha-memory/cli.mjs list 20
node /root/dsha-memory/cli.mjs search 设备 偏好
node /root/dsha-memory/cli.mjs save "内容" --tags 设备,环境 --kind fact
node /root/dsha-memory/cli.mjs forget m-xxxxxxxxxxxx
node /root/dsha-memory/cli.mjs stats
```

## 卸载（可逆）

从 profile `package.json` 的 `dsh.profile.bundles` 里删掉 `dsh-memory`，再删
`node_modules/dsh-memory` 软链即可；数据仍在 `/root/.dsh/memory/store.json`，
想彻底清就删掉那个文件。

已删除的不兼容插件：`@achasoft/dsh-memory`（`python3 /root/.dsh/plugin-manager.py delete @achasoft/dsh-memory`，
返回「已删除…重启 Web 后停止加载」）。它的 `plugin-src` 目录与 `node_modules/@achasoft`
空目录是删除操作的残留，可以再手工清掉。
