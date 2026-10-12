/**
 * 用 Node + 迷你 DOM 跑识别引擎测试（确定性、无需浏览器）。
 * 运行： node tests/run-tests.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createDom, ShimElement } from './dom-shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const { document, window } = createDom();

const sandbox = {
  window,
  document,
  Element: ShimElement,
  CSS: window.CSS,
  getComputedStyle: window.getComputedStyle,
  console,
  Math,
  JSON,
  String,
  Number,
  Object,
  Array,
  Set,
  RegExp,
  Date,
  parseInt,
  parseFloat,
  isNaN
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(read('src/common/schema.js'), ctx, { filename: 'schema.js' });
vm.runInContext(read('src/common/matcher.js'), ctx, { filename: 'matcher.js' });
vm.runInContext(read('tests/cases.js'), ctx, { filename: 'cases.js' });

if (typeof ctx.NRFA_SCHEMA !== 'object') throw new Error('schema.js 未导出 NRFA_SCHEMA');
if (typeof ctx.NRFA_MATCHER !== 'object') throw new Error('matcher.js 未导出 NRFA_MATCHER');
if (!ctx.NRFA_TEST_CASES) throw new Error('cases.js 未导出 NRFA_TEST_CASES');

const results = ctx.NRFA_TEST_CASES.run(document, ctx.NRFA_MATCHER, ctx.NRFA_SCHEMA);

let pass = 0, fail = 0, currentGroup = '';
const lines = [];
lines.push('='.repeat(78));
lines.push('网申助手 · 识别引擎测试（迷你 DOM，确定性运行）');
lines.push('='.repeat(78));
for (const r of results) {
  if (r.group) {
    currentGroup = r.group;
    lines.push('');
    lines.push(`── ${currentGroup} ${'─'.repeat(Math.max(0, 66 - currentGroup.length * 2))}`);
    continue;
  }
  if (r.ok) { pass++; lines.push(`  ✅ ${r.name}`); }
  else {
    fail++;
    lines.push(`  ❌ ${r.name}`);
    lines.push(`       期望: ${r.expected}`);
    lines.push(`       实际: ${r.actual}`);
  }
}
lines.push('');
lines.push('-'.repeat(78));
lines.push(`结果：通过 ${pass} / ${pass + fail}${fail ? `，失败 ${fail}` : '，全部通过 🎉'}`);

console.log(lines.join('\n'));
process.exit(fail ? 1 : 0);
