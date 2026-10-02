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
const SNAPSHOT_LIMIT = 20;
const MAX_SECTION_CHARS = 2400;
const ROUTE_BASE = '/memory-editor';
const EDITOR_FILE = fileURLToPath(new URL('./editor.html', import.meta.url));
const LIST_LIMIT = 50;

/** 与 server.cjs 共用同一份实现（校验、去重、写入全走同一条路径）。 */
const memory = createRequire(import.meta.url)('./server.cjs');

/** 读记忆快照；任何异常都退化成「空记忆」，绝不让插件加载失败。 */
async function snapshot(limit = SNAPSHOT_LIMIT) {
  try {
    const doc = JSON.parse(await readFile(STORE, 'utf8'));
    const items = Array.isArray(doc.memories) ? doc.memories : [];
    return items.slice(-limit).reverse();
  } catch {
    return [];
  }
}

const HEAD = [
  '【长期记忆 · dsh-memory】你有一份跨会话的长期记忆库。',
  '  用 memory_search 回忆（回答前先查一次，尤其是用户偏好/项目规则/历史结论）；',
  '  拿到值得长期保留的事实、偏好、规则、结论时用 memory_save 记下（一句话一条）；',
  '  记忆可能过期，与当前证据冲突时以最新证据为准，并更新那条记忆；',
  '  删除记忆只在用户明确要求时用 memory_forget。',
  '  （用户可在浏览器打开 /plugins/dsh-memory/editor 自己增删改。）',
];

function sectionText(items) {
  const lines = [...HEAD];
  if (items.length === 0) {
    lines.push('当前记忆库为空。');
  } else {
    lines.push(`已记住 ${items.length} 条（新→旧，id 供 memory_forget 使用）：`);
    for (const m of items) {
      let text = String(m.text || '').replace(/\s+/g, ' ').trim();
      if (text.length > 180) text = text.slice(0, 180) + '…';
      const tags = Array.isArray(m.tags) && m.tags.length ? ` #${m.tags.join(' #')}` : '';
      lines.push(`  [${m.id}] (${m.kind || 'note'}) ${text}${tags}`);
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

  const items = await snapshot();
  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({ name: 'dsh:memory', order: 160, text: sectionText(items) });
  });
}