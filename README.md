[English](README.en.md) | **简体中文**

# dsh-memory —— DSHA 长期记忆插件

> **版本 `0.2.1`** · MIT License · 零原生依赖（纯 Node 内置模块，aarch64 直接可用）
> 适配环境：DSHA App `0.2.1-rc.2` · DSH `0.2.1-rc.2` · Node `>= 20`

给 DSHA（DeepSeek Harness on Android）用的长期记忆插件：把值得记住的事存成本地 JSON，
模型随时读写，并提供一个手机友好的管理界面。

## 特性

- **记忆库**：单个 JSON 文件，原子写入（临时文件 + rename），权限 600
- **6 个 MCP 工具**：`memory_save` / `memory_search` / `memory_list` /
  `memory_update` / `memory_forget` / `memory_stats`
- **设置页「记忆插件」**：注册到 `settings.section`，整页做列表 / 搜索 / 增删改
- **输入框图标**：注册到 `conversation.input.left`，点开是同款面板（Portal 到 body）
- **网页编辑器**（备用入口）：`GET /memory-editor/editor`
- **系统提示词快照（省 token 设计）**：启动时把记忆分层注入 systemPrompt——
  规则/守则/偏好类（`kind` 为 `rule` 或 `preference`，以及带「红线/守则/铁律/硬规则」
  标签的条目）**全文加载、永不截断**；其余 `fact`/`note` 只注入**标题**，正文按需
  用 `memory_search` 检索。详见下文「省 token 设计」。
- **零原生依赖**：只用 Node 内置模块，无编译、无二进制，arm64 手机可用

## 安装

1. 把本仓库放到容器内的插件目录（任意路径，如 `~/dsha-memory`）。
2. 让依赖可见：把插件的 `node_modules` 软链到 DSH 自带的 `node_modules`。
3. 在 web profile 的 `package.json` 里：
   - `dependencies` 加 `"dsh-memory": "link:<插件目录>"`
   - `dsh.profile.bundles` 数组加 `"dsh-memory"`
4. 在 profile 的 `node_modules` 下建软链指向插件目录。
5. 重启 DSHA Web 生效（profile 目录通常是 `$DSH_HOME/profiles/web`）。

## 省 token 设计

系统提示词每轮都会随请求计费，所以「注入什么、注入多少」直接决定成本。本版做了分层：

| 层级 | 哪些记忆 | 注入方式 | 理由 |
| --- | --- | --- | --- |
| 全文层 | `kind` 为 `rule` / `preference`，或标签含「红线/守则/铁律/硬规则」 | **全文**，不截断、不受条数上限约束 | 这类是必须遵守的约束，省掉任何一句都可能被违反 |
| 标题层 | 其余 `fact` / `note` | 只注入**标题**（优先取 `【…】` 小标题，其次冒号前或第一句，超 60 字截断） | 知道「有这条」通常就够了，细节按需检索 |

配套规则：

- 标题层最多注入最近 20 条，全文层**一条不漏**；
- 整段有 15000 字符保险阀，正常规模下规则全文不会被裁掉；
- 需要某条标题对应的完整内容时，模型用 `memory_search` 按关键词检索（带 `limit` 控制条数）。

**启动时构建一次快照，是省 token 的关键设计。** 每一轮都重读整库、重渲染快照，等于
每轮都为全部记忆重复付费；本插件的做法是「启动时装配一次、会话期间零重复计费」：

- 快照在宿主启动时构建，整个会话周期的 prompt 占用最小；
- 运行中新存/新改的记忆立即落盘，`memory_search` / `memory_list` 实时可查——相当于
  「热数据」，按需检索、不占常驻上下文；
- 想把它升级为「常驻提示词」时，重启一次宿主即可：一次重启，换取整个会话周期的
  零重复开销，很划算。

对比旧版（全量最近 20 条、每条截 180 字、整段 2400 字符封顶）：旧版经常把靠后的
记忆直接砍掉、规则也可能被截断；新版**约束类记忆完整、事实类记忆瘦身**，在同等
甚至更小的 prompt 占用下，让「必须遵守的内容」一条不漏。

## 数据与隐私

- 记忆数据默认写在 `$DSH_HOME/memory/store.json`（可用环境变量 `DSHA_MEMORY_DIR` 覆盖），
  **不在本仓库内**。
- 仓库自带的 `.gitignore` 已排除 `store.json`、`node_modules`、`.env` 与日志。
- 插件只读写本地文件，不向任何网络服务发送数据。
- 网页编辑接口只接受本机回环请求（Host 必须为 `localhost` / `127.x`），
  写操作另需本次启动生成的密钥。

## 文件

| 路径 | 作用 |
| --- | --- |
| `lib/index.js` | 插件入口：MCP 子进程 + 系统提示词 + Web 编辑路由 |
| `lib/server.cjs` | 记忆服务本体（MCP stdio，JSON-RPC 2.0），也是 CLI / Web API 的库 |
| `lib/editor.html` | 网页编辑页（手机优先，纯静态，无构建） |
| `lib/client.js` | 客户端插件：设置页 + 输入框图标（手写 bundle，无构建） |
| `cli.mjs` | 终端 CLI |
| `cordis.patch.yml` | 插件树挂载项 |

## HTTP API

```
GET  /memory-editor/editor    编辑页面（内嵌本次启动生成的密钥）
GET  /memory-editor/api       -> {total, shown, store, memories[]}
POST /memory-editor/api       头 x-memory-key，体 {action: save|update|forget, ...}
```

路由刻意不用 `/plugins/...` 前缀：那是客户端模块系统的保留前缀，会撞车。

## CLI

```sh
node cli.mjs list 20
node cli.mjs search 设备 偏好
node cli.mjs save "内容" --tags 设备,环境 --kind fact
node cli.mjs forget m-xxxxxxxxxxxx
node cli.mjs stats
```

## 卸载

从 profile 的 `dsh.profile.bundles` 里去掉 `dsh-memory`、删掉 `node_modules/dsh-memory`
软链，重启即可。记忆数据在 `$DSH_HOME/memory/store.json`，卸载插件不会删除它。

## License

MIT
