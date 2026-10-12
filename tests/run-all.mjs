/**
 * 一键跑完全部自检（识别引擎 → 端到端填充 → service worker → 交付前静态检查）。
 * 运行： node tests/run-all.mjs
 */
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SUITES = [
  ['识别引擎测试（90 条识别用例）', 'tests/run-tests.mjs'],
  ['端到端填充测试（真实执行 content.js）', 'tests/test-fill.mjs'],
  ['service worker 逻辑测试', 'tests/test-worker.mjs'],
  ['交付前静态自检', 'tools/verify.mjs']
];

let failed = 0;
for (const [title, file] of SUITES) {
  console.log('\n' + '█'.repeat(74));
  console.log('▶ ' + title);
  console.log('█'.repeat(74));
  const r = spawnSync(process.execPath, [join(ROOT, file)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n' + '='.repeat(74));
console.log(failed === 0
  ? `全部 ${SUITES.length} 个测试套件通过 🎉`
  : `有 ${failed} / ${SUITES.length} 个测试套件未通过`);
console.log('='.repeat(74));
process.exit(failed ? 1 : 0);
