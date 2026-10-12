/**
 * 把 schema.js 里当前预置的档案导出成"设置页可导入"的 JSON。
 * 这是在把 schema.js 改成空白模板之前必须先跑的步骤，否则个人数据就丢了。
 *
 * 运行： node tools/export-profile.mjs <输出文件路径> [档案名]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const outPath = process.argv[2];
const profileName = process.argv[3] || null;
if (!outPath) {
  console.error('用法： node tools/export-profile.mjs <输出文件路径> [档案名]');
  process.exit(1);
}

const sandbox = { globalThis: null, console, JSON, Object, Array, String };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'src/common/schema.js'), 'utf8'), ctx, { filename: 'schema.js' });

const S = ctx.NRFA_SCHEMA;
const profile = JSON.parse(JSON.stringify(S.DEFAULT_PROFILE));
if (profileName) profile.name = profileName;

const filled = Object.keys(profile.fields).filter((k) => String(profile.fields[k] || '').trim() !== '');

const payload = {
  app: '网申助手 Resume Form Assistant',
  version: 1,
  exportedAt: new Date().toISOString(),
  note: '个人档案备份：包含真实简历数据，请勿公开分享。在扩展设置页「导入 / 导出」里导入即可。',
  settings: Object.assign({}, JSON.parse(JSON.stringify(S.DEFAULT_SETTINGS)), {
    activeProfileId: profile.id
  }),
  profiles: [profile]
};

writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`已导出：${outPath}`);
console.log(`档案名：${profile.name}`);
console.log(`非空字段：${filled.length} / ${Object.keys(profile.fields).length} 项`);
console.log('再次提醒：这个文件含真实简历数据（手机号等），不要提交到公开仓库。');
