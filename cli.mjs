#!/usr/bin/env node
/**
 * dsh-memory 终端 CLI：不用开 GUI 也能读写记忆库。
 *   node /root/dsha-memory/cli.mjs list [n]
 *   node /root/dsha-memory/cli.mjs search <关键词…>
 *   node /root/dsha-memory/cli.mjs save <内容> [--tags a,b] [--kind fact|preference|rule|note]
 *   node /root/dsha-memory/cli.mjs forget <id>
 *   node /root/dsha-memory/cli.mjs stats
 * 建议软链：ln -sf /root/dsha-memory/cli.mjs /root/dsh-bin/dsh-memory
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { call, STORE } = require('/root/dsha-memory/lib/server.cjs');

const [command, ...rest] = process.argv.slice(2);
const flags = new Map();
const words = [];
for (let i = 0; i < rest.length; i++) {
  const token = rest[i];
  if (token.startsWith('--')) {
    flags.set(token.slice(2), rest[++i] ?? '');
  } else {
    words.push(token);
  }
}
const text = words.join(' ');
const parse = (r) => JSON.parse(r.content[0].text);
const print = (v) => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));

try {
  if (command === 'list') print(parse(await call('memory_list', { limit: Number(text) || 20 })));
  else if (command === 'search') print(parse(await call('memory_search', { query: text, limit: Number(flags.get('limit')) || 10 })));
  else if (command === 'save') print(parse(await call('memory_save', { text, tags: flags.get('tags'), kind: flags.get('kind') || 'note' })));
  else if (command === 'forget') print(parse(await call('memory_forget', { id: text })));
  else if (command === 'stats') print(parse(await call('memory_stats', {})));
  else {
    console.log('dsh-memory 记忆库：' + STORE);
    console.log('用法：list [n] | search <关键词…> | save <内容> [--tags a,b] [--kind fact] | forget <id> | stats');
  }
} catch (error) {
  console.error('出错：' + (error.message || error));
  process.exit(1);
}
