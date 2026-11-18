/**
 * dsh-memory —— DSHA 长期记忆插件（服务端）。
 *
 * 三条腿：
 *  1) 工具：通过 @deepseek-ai/dsh-mcp-client 拉起同目录的 server.cjs，
 *     给 agent 提供 memory_save / memory_search / memory_list / memory_update /
 *     memory_forget / memory_stats。
 *  2) 系统提示词：启动时把最近的记忆快照注入 systemPrompt，让模型一上来就「记得」。
 *  3) 编辑页面：往 DSH Web 服务挂两条本地路由（/plugins/dsh-memory/editor 与 /api），
 *     手机浏览器点开就能增删改查记忆 —— 不用碰命令行。
 *
 * 无原生依赖、无网络依赖、无凭据需求 —— 目标是「装了就能加载」。
 */
import { readFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as McpClient from '@deepseek-ai/dsh-mcp-client';

export const name = 'dsh-memory';
export const inject = ['tools', 'systemPrompt'];

const STORE = process.env.DSHA_MEMORY_DIR
  ? process.env.DSHA_MEMORY_DIR + '/store.json'
  : '/root/.dsh/memory/store.json';
const SNAPSHOT_LIMIT = 20; // 非规则类的「仅标题」条数上限
const OTHER_TITLE_LIMIT = 60; // 提取标题的最大长度
const MAX_SECTION_CHARS = 15000; // 整段保险阀（规则全文 + 其余标题）
const ROUTE_BASE = '/memory-editor';
const EDITOR_FILE = fileURLToPath(new URL('./editor.html', import.meta.url));
const LIST_LIMIT = 50;

// 「必须全文加载」的判定：不单靠 kind 分类——
//  rule（规则/守则）、preference（用户偏好）天然是约束，必须全文；
//  另外 fact/note 里只要标签带红线/守则类词（用户专门强调过的），也按规则对待，全文加载。
const FULL_KINDS = new Set(['rule', 'preference']);
const RULE_TAG_WORDS = ['红线', '紅線', '守则', '守則', '铁律', '鐵律', '硬规则', '硬規則'];

/** 与 server.cjs 共用同一份实现（校验、去重、写入全走同一条路径）。 */
const memory = createRequire(import.meta.url)('./server.cjs');

function isRule(m) {
  if (FULL_KINDS.has(m.kind)) return true;
  return Array.isArray(m.tags) && m.tags.some((t) => RULE_TAG_WORDS.includes(t));
}

/** 从记忆正文里提取“标题”：优先取【……】式小标题，其次取第一个语义边界（句号 / 分号 / 冒号），超长截断。 */
function titleOf(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const head = t.match(/^【[^】]+】/);
  if (head) return head[0];
  const sentence = (t.split(/[。；;]/)[0] || t).trim();
  const colon = (t.split(/[：:]/)[0] || '').trim();
  // 冒号前有像样的标题（≥6 字）就用它，否则退回第一句。
  const title = colon.length >= 6 && colon.length < sentence.length ? colon : sentence;
  return title.length > OTHER_TITLE_LIMIT ? title.slice(0, OTHER_TITLE_LIMIT) + '…' : title;
}

/**
 * 读记忆快照：
 *  - rules：全部规则/守则类（新→旧），提示词里永远带全文；
 *  - others：其余记忆（新→旧，最多 SNAPSHOT_LIMIT 条），提示词里只带标题。
 * 任何异常都退化成「空记忆」，绝不让插件加载失败。
 */
async function snapshot() {
  try {
    const doc = JSON.parse(await readFile(STORE, 'utf8'));
    const items = Array.isArray(doc.memories) ? doc.memories : [];
    const rules = items.filter(isRule).reverse();
    const others = items.filter((m) => !isRule(m)).slice(-SNAPSHOT_LIMIT).reverse();
    return { total: items.length, rules, others };
  } catch {
    return { total: 0, rules: [], others: [] };
  }
}

const HEAD = [
  '【长期记忆 · dsh-memory】你有一份跨会话的长期记忆库。',
  '  规则/守则类记忆已全文加载（必须遵守）；其余记忆只给标题，全文用 memory_search 检索（回答前先查一次，尤其是用户偏好/项目规则/历史结论）。',
  '  拿到值得长期保留的事实、偏好、规则、结论时用 memory_save 记下（一句话一条）；',
  '  记忆可能过期，与当前证据冲突时以最新证据为准，并更新那条记忆；',
  '  删除记忆只在用户明确要求时用 memory_forget。',
  '  （用户可在浏览器打开 /plugins/dsh-memory/editor 自己增删改。）',
];

function tagsOf(m) {
  return Array.isArray(m.tags) && m.tags.length ? ` #${m.tags.join(' #')}` : '';
}

/**
 * 渲染注入 systemPrompt 的记忆段：
 *  - 规则/守则类：全文，永不截断 → 提示词里始终可见；
 *  - 其他类：只显示标题（全文需 memory_search）。
 */
function sectionText(view) {
  const lines = [...HEAD];
  const rules = view?.rules ?? [];
  const others = view?.others ?? [];
  if (rules.length === 0 && others.length === 0) {
    lines.push('当前记忆库为空。');
    return lines.join('\n');
  }
  lines.push(`已记住 ${view.total ?? rules.length + others.length} 条：规则/守则 ${rules.length} 条（全文如下），其余 ${others.length} 条仅标题（新→旧，id 供 memory_forget 使用）。`);
  if (rules.length > 0) {
    lines.push('  ▼ 规则 / 守则（全文，必须加载）：');
    for (const m of rules) {
      const text = String(m.text || '').replace(/\s+/g, ' ').trim();
      lines.push(`  [${m.id}] (${m.kind || 'rule'}) ${text}${tagsOf(m)}`);
    }
  }
  if (others.length > 0) {
    lines.push('  ▼ 其他记忆（仅标题，需要全文请 memory_search）：');
    for (const m of others) {
      lines.push(`  [${m.id}] (${m.kind || 'note'}) ${titleOf(m.text)}${tagsOf(m)}`);
    }
  }
  let text = lines.join('\n');
  if (text.length > MAX_SECTION_CHARS) text = text.slice(0, MAX_SECTION_CHARS) + '\n  …（记忆较多，用 memory_list 查看全部）';
  return text;
}

// ───────────────────────── 编辑页面（Web 路由） ─────────────────────────

/** 只接受本机回环来源（与 dsh-session-prompt 等插件的路由守卫同款规则）。 */
function trustedRequest(req) {
  const host = req.headers.host ?? '';
  const origin = req.headers.origin;
  if (!/^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(host)) return false;
  return origin === undefined || /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?$/i.test(origin);
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        resolve(undefined);
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(undefined));
  });
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

/** 调用记忆服务，并把 MCP 的返回包装拆回普通对象。 */
async function invoke(tool, args) {
  const result = await memory.call(tool, args);
  return JSON.parse(result.content[0].text);
}

async function apiRequest(req, res) {
  try {
    if (req.method === 'GET') {
      const view = await invoke('memory_list', { limit: LIST_LIMIT });
      json(res, 200, { total: view.total, shown: view.count, store: STORE, memories: view.memories });
      return;
    }
    if (req.method !== 'POST') {
      json(res, 405, { error: 'method-not-allowed' });
      return;
    }
    const body = await readBody(req);
    if (body === undefined) {
      json(res, 413, { error: 'body-too-large' });
      return;
    }
    let payload;
    try {
      payload = JSON.parse(body || '{}');
    } catch {
      json(res, 400, { error: 'invalid-json' });
      return;
    }
    if (payload.action === 'save') {
      json(res, 200, await invoke('memory_save', { text: payload.text, tags: payload.tags, kind: payload.kind }));
      return;
    }
    if (payload.action === 'update') {
      json(res, 200, await invoke('memory_update', { id: payload.id, text: payload.text, tags: payload.tags, kind: payload.kind }));
      return;
    }
    if (payload.action === 'forget') {
      json(res, 200, await invoke('memory_forget', { id: payload.id }));
      return;
    }
    json(res, 400, { error: 'unknown-action' });
  } catch (error) {
    json(res, 400, { error: error.message || 'OPERATION_FAILED' });
  }
}

/**
 * 本插件自带的客户端 bundle 监听。
 *
 * 这个 profile 没有加载 @deepseek-ai/dsh-client-hmr，所以服务器内存里的图
 * 永远停在启动时读到的版本号：文件改了，浏览器拿到的仍是旧 bundle（且
 * bundle 响应带 immutable 缓存），于是只有"重启 Web"才会生效。
 *
 * 这里用 client-modules 的公开 API（clientPath / graph / rebuilt）自己补上
 * 这一段：client.js 一变就重组该条目，版本号随之改变，浏览器刷新即可拿到新包。
 */
function watchClientBundle(ctx) {
  const clientFile = fileURLToPath(new URL('./client.js', import.meta.url));
  ctx.inject(['clientModules'], (modulesCtx) => {
    const modules = modulesCtx.clientModules;
    if (modules === undefined || typeof modules.rebuilt !== 'function') return;
    // entry id 就是包名；包名对不上时从图里按路径反查，保持自愈。
    let id = name;
    try {
      if (typeof modules.clientPath === 'function' && modules.clientPath(name) !== clientFile) {
        for (const row of modules.graph()?.entries ?? []) {
          if (modules.clientPath(row.id) === clientFile) {
            id = row.id;
            break;
          }
        }
      }
    } catch {}
    const signature = () => {
      try {
        const st = statSync(clientFile);
        return `${st.mtimeMs}:${st.size}`;
      } catch {
        return '';
      }
    };
    let last = signature();
    const timer = setInterval(() => {
      const current = signature();
      if (current === '' || current === last) return;
      last = current;
      try {
        modules.rebuilt(id);
      } catch {}
    }, 1000);
    if (typeof timer.unref === 'function') timer.unref();
    ctx.effect(() => () => clearInterval(timer), 'dsha-memory: bundle watcher');
  });
}

function registerEditor(ctx) {
  const key = randomBytes(24).toString('hex');
  ctx.inject(['webServer'], (webCtx) => {
    const server = webCtx.webServer;
    if (server === undefined) return;
    webCtx.effect(() => {
      const page = async (req, res) => {
        if (!trustedRequest(req)) {
          json(res, 403, { error: 'request-not-trusted' });
          return;
        }
        try {
          const html = (await readFile(EDITOR_FILE, 'utf8'))
            .split('__BASE__').join(ROUTE_BASE)
            .split('__KEY__').join(key)
            .split('__STORE__').join(STORE);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          res.end(html);
        } catch {
          json(res, 500, { error: 'editor-unavailable' });
        }
      };
      const guardedApi = async (req, res) => {
        if (!trustedRequest(req)) {
          json(res, 403, { error: 'request-not-trusted' });
          return;
        }
        if (req.method !== 'GET' && req.headers['x-memory-key'] !== key) {
          json(res, 403, { error: 'invalid-key' });
          return;
        }
        await apiRequest(req, res);
      };
      const disposers = [
        server.register({ kind: 'exact', path: ROUTE_BASE, handler: page }),
        server.register({ kind: 'exact', path: ROUTE_BASE + '/', handler: page }),
        server.register({ kind: 'exact', path: ROUTE_BASE + '/editor', handler: page }),
        server.register({ kind: 'exact', path: ROUTE_BASE + '/api', handler: guardedApi }),
      ];
      return () => {
        for (const dispose of disposers) {
          try {
            dispose?.();
          } catch {}
        }
      };
    }, 'dsha-memory-editor');
  });
}

export async function apply(ctx) {
  const config = McpClient.Config({
    transport: 'stdio',
    serverName: 'dsha-memory',
    command: process.execPath,
    args: [fileURLToPath(new URL('./server.cjs', import.meta.url))],
    failOnStartupError: true,
    toolCallTimeoutMs: 30000,
    reconnect: { enabled: false },
  });
  let child;
  ctx.effect(function* () {
    child = ctx.plugin(McpClient, config);
    yield child.dispose;
  }, 'dsha-memory-tools');
  await child.await();

  registerEditor(ctx);
  watchClientBundle(ctx);

  const view = await snapshot();
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({ name: 'dsh:memory', order: 160, text: sectionText(view) });
  });
}