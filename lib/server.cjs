'use strict';
/**
 * dsha-memory —— 长期记忆 MCP 服务（stdio / 按行分隔的 JSON-RPC 2.0）。
 *
 * 设计取舍：纯 JS，只有 node 内置模块，**零原生依赖**。
 * （@achasoft/dsh-memory 在这台 aarch64 手机上加载失败，根因就是它依赖
 *   @duckdb/node-api 的原生二进制；这里用 JSON 文件 + 内存索引替代，
 *   换来的是「一定能装上、一定能加载」。）
 *
 * 存储：/root/.dsh/memory/store.json，原子写入（临时文件 + rename）。
 */
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const STORE_DIR = process.env.DSHA_MEMORY_DIR || '/root/.dsh/memory';
const STORE = path.join(STORE_DIR, 'store.json');
const MAX_ITEMS = 1000;
const MAX_TEXT = 4000;

const definitions = [
  ['memory_save',
    '把一条值得长期记住的信息写进长期记忆（事实 / 偏好 / 规则 / 结论）。内容完全相同的记忆不会重复保存，只刷新时间。',
    { text: { type: 'string', maxLength: MAX_TEXT }, tags: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: ['fact', 'preference', 'rule', 'note'] } },
    ['text']],
  ['memory_search',
    '按关键词检索长期记忆；多个词用空格分开，要求全部命中。返回 id、内容、标签与时间。',
    { query: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
    ['query']],
  ['memory_list',
    '列出最近的长期记忆（新→旧）。',
    { limit: { type: 'integer', minimum: 1, maximum: 50 } },
    []],
  ['memory_forget',
    '按 id 删除一条长期记忆（只在用户明确要求忘记时使用）。',
    { id: { type: 'string', maxLength: 80 } },
    ['id']],
  ['memory_update',
    '按 id 修改一条长期记忆的正文、标签或类型；只传要改的字段。',
    { id: { type: 'string', maxLength: 80 }, text: { type: 'string', maxLength: MAX_TEXT }, tags: { type: 'string', maxLength: 200 }, kind: { type: 'string', enum: ['fact', 'preference', 'rule', 'note'] } },
    ['id']],
  ['memory_stats',
    '查看记忆库统计：条数、文件路径、最后更新时间。',
    {},
    []],
];

const tools = definitions.map(([name, description, properties, required]) => ({
  name,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
}));

function validate(def, args) {
  const fields = def[2];
  const required = def[3];
  const value = args === undefined || args === null ? {} : args;
  if (typeof value !== 'object' || Array.isArray(value)) throw Error('INVALID_ARGUMENTS');
  if (Object.keys(value).some((k) => !Object.hasOwn(fields, k))) throw Error('UNKNOWN_ARGUMENT');
  for (const key of required) {
    if (value[key] === undefined) throw Error('MISSING_' + key);
  }
  for (const [key, raw] of Object.entries(value)) {
    if (raw === undefined) continue;
    const rule = fields[key];
    if (rule.enum && !rule.enum.includes(raw)) throw Error('INVALID_' + key);
    if (rule.type === 'integer' && (!Number.isInteger(raw) || (rule.minimum !== undefined && raw < rule.minimum) || (rule.maximum !== undefined && raw > rule.maximum))) throw Error('INVALID_' + key);
    if (rule.type === 'string') {
      if (typeof raw !== 'string' || raw.length > rule.maxLength) throw Error('INVALID_' + key);
      if (raw.trim() === '' && required.includes(key)) throw Error('EMPTY_' + key);
    }
  }
}

async function load() {
  try {
    const doc = JSON.parse(await fsp.readFile(STORE, 'utf8'));
    const items = Array.isArray(doc.memories) ? doc.memories : [];
    return {
      version: 1,
      memories: items.filter((x) => x && typeof x.text === 'string'),
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : null,
    };
  } catch {
    return { version: 1, memories: [] };
  }
}

async function save(doc) {
  await fsp.mkdir(STORE_DIR, { recursive: true });
  doc.memories = doc.memories.slice(-MAX_ITEMS);
  doc.updatedAt = new Date().toISOString();
  const tmp = STORE + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', { mode: 0o600 });
  await fsp.rename(tmp, STORE);
}

const normalize = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
const terms = (q) => q.split(/[\s,，、；;]+/).map((t) => normalize(t)).filter(Boolean);

function entry(m) {
  return {
    id: m.id,
    text: m.text,
    kind: m.kind || 'note',
    tags: m.tags || [],
    createdAt: m.createdAt,
    updatedAt: m.updatedAt || m.createdAt,
  };
}

function search(items, query, limit) {
  const needles = terms(query);
  const scored = [];
  for (const m of items) {
    const haystack = normalize(m.text + ' ' + (m.tags || []).join(' '));
    let score = 0;
    for (const t of needles) {
      if (!haystack.includes(t)) { score = -1; break; }
      score += haystack === t ? 4 : 1;
    }
    if (score >= 0) scored.push([score, m]);
  }
  scored.sort((a, b) => b[0] - a[0] || String(b[1].createdAt).localeCompare(String(a[1].createdAt)));
  return scored.slice(0, limit).map(([, m]) => entry(m));
}

const ok = (payload) => ({ content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] });

async function call(name, rawArgs) {
  const def = definitions.find((d) => d[0] === name);
  if (!def) throw Error('UNKNOWN_TOOL');
  validate(def, rawArgs);
  const args = rawArgs || {};
  const doc = await load();

  if (name === 'memory_save') {
    const text = args.text.trim();
    const tags = typeof args.tags === 'string'
      ? args.tags.split(/[\s,，、]+/).map((t) => t.trim()).filter(Boolean).slice(0, 12)
      : [];
    const kind = args.kind || 'note';
    const now = new Date().toISOString();
    const hit = doc.memories.find((m) => normalize(m.text) === normalize(text));
    if (hit) {
      hit.updatedAt = now;
      if (tags.length) hit.tags = [...new Set([...(hit.tags || []), ...tags])].slice(0, 12);
      await save(doc);
      return ok({ saved: false, updated: true, id: hit.id, note: '内容相同，已刷新时间与标签' });
    }
    const item = { id: 'm-' + crypto.randomBytes(6).toString('hex'), text, kind, tags, createdAt: now, updatedAt: now };
    doc.memories.push(item);
    await save(doc);
    return ok({ saved: true, id: item.id, total: doc.memories.length });
  }

  if (name === 'memory_search') {
    const limit = args.limit || 10;
    const found = search(doc.memories, args.query, limit);
    return ok({ query: args.query, count: found.length, memories: found });
  }

  if (name === 'memory_list') {
    const limit = args.limit || 20;
    const found = doc.memories.slice(-limit).reverse().map(entry);
    return ok({ count: found.length, total: doc.memories.length, memories: found });
  }

  if (name === 'memory_forget') {
    const index = doc.memories.findIndex((m) => m.id === args.id);
    if (index < 0) return ok({ forgotten: false, reason: 'NOT_FOUND', id: args.id });
    const [removed] = doc.memories.splice(index, 1);
    await save(doc);
    return ok({ forgotten: true, id: removed.id, text: removed.text, total: doc.memories.length });
  }

  if (name === 'memory_update') {
    const item = doc.memories.find((m) => m.id === args.id);
    if (!item) return ok({ updated: false, reason: 'NOT_FOUND', id: args.id });
    if (typeof args.text === 'string') {
      const text = args.text.trim();
      if (!text) return ok({ updated: false, reason: 'EMPTY_TEXT', id: args.id });
      item.text = text;
    }
    if (typeof args.tags === 'string') {
      item.tags = args.tags.split(/[\s,，、]+/).map((t) => t.trim()).filter(Boolean).slice(0, 12);
    }
    if (args.kind) item.kind = args.kind;
    item.updatedAt = new Date().toISOString();
    await save(doc);
    return ok({ updated: true, memory: entry(item), total: doc.memories.length });
  }

  const byKind = {};
  for (const m of doc.memories) byKind[m.kind || 'note'] = (byKind[m.kind || 'note'] || 0) + 1;
  return ok({ total: doc.memories.length, store: STORE, updatedAt: doc.updatedAt || null, byKind });
}

function start() {
  const active = new Map();
  const cancelled = new Set();
  let buffer = '';
  let queue = Promise.resolve();
  let ended = false;
  let pending = 0;
  const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');

  async function receive(m) {
    const { id, method, params = {} } = m;
    if (method === 'notifications/cancelled') {
      if (active.has(params.requestId)) active.get(params.requestId).abort();
      else cancelled.add(params.requestId);
      return;
    }
    if (id === undefined || id === null) return; // 通知：initialized 等
    if (ended || cancelled.delete(id)) {
      send({ id, error: { code: -32800, message: 'Request cancelled' } });
      return;
    }
    try {
      let result;
      if (method === 'initialize') {
        result = {
          protocolVersion: params.protocolVersion || '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'DSHA Memory', version: '0.1.0' },
          instructions: '长期记忆库。需要记住用户的事实/偏好/规则时用 memory_save；回答前可用 memory_search 回忆；只在用户明确要求时用 memory_forget 删除。',
        };
      } else if (method === 'ping') result = {};
      else if (method === 'tools/list') result = { tools };
      else if (method === 'tools/call') {
        const ac = new AbortController();
        active.set(id, ac);
        try {
          result = await call(params.name, params.arguments || {});
        } finally {
          active.delete(id);
        }
      } else {
        send({ id, error: { code: -32601, message: 'Method not found' } });
        return;
      }
      send({ id, result });
    } catch (error) {
      send({
        id,
        result: { content: [{ type: 'text', text: '记忆库操作失败：' + (error.message || 'OPERATION_UNAVAILABLE') }], isError: true },
      });
    }
  }

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 1024 * 1024) process.exit(1);
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let value;
      try {
        value = JSON.parse(line);
      } catch {
        send({ id: null, error: { code: -32700, message: 'Parse error' } });
        continue;
      }
      if (pending >= 32) {
        send({ id: value.id ?? null, error: { code: -32000, message: 'Request queue full' } });
        continue;
      }
      pending++;
      queue = queue.then(() => receive(value)).finally(() => pending--);
    }
  });
  process.stdin.on('end', () => {
    ended = true;
    for (const ac of active.values()) ac.abort();
  });
  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0);
  });
}

if (require.main === module) start();
module.exports = { definitions, tools, validate, call, search, terms, STORE };
