/**
 * 交付前静态自检：
 *   1. manifest.json 能解析，且所有引用的文件真实存在
 *   2. 所有 JS 能通过 Node 语法检查
 *   3. 关键接口在文件之间对得上（popup↔background 的消息名、content↔background 的 __NRFA__ 动作）
 *   4. 不该出现的东西（外链、eval、内联远程脚本）
 * 运行： node tools/verify.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const problems = [];
const notes = [];

function fail(msg) { problems.push(msg); }
function ok(msg) { notes.push(msg); }

/* ------------------------------- 1. manifest ------------------------------- */
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
  ok('manifest.json 解析成功');
} catch (e) {
  fail('manifest.json 解析失败：' + e.message);
  console.log(problems.join('\n'));
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail('manifest_version 必须是 3');
if (!manifest.name || !manifest.version) fail('缺少 name / version');

const referenced = new Set();
function collect(node) {
  if (typeof node === 'string') {
    if (/\.(js|css|html|png|json)$/i.test(node)) referenced.add(node);
    return;
  }
  if (Array.isArray(node)) { node.forEach(collect); return; }
  if (node && typeof node === 'object') { Object.values(node).forEach(collect); }
}
collect(manifest);
referenced.forEach((p) => {
  if (!existsSync(join(ROOT, p))) fail(`manifest 引用了不存在的文件：${p}`);
});
ok(`manifest 引用的 ${referenced.size} 个文件全部存在`);

/* ------------------------------- 2. 语法 ------------------------------- */
const jsFiles = [
  'src/common/schema.js',
  'src/common/matcher.js',
  'src/content/content.js',
  'src/background/service-worker.js',
  'src/popup/popup.js',
  'src/options/options.js',
  'tests/cases.js'
];
for (const f of jsFiles) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  try {
    new vm.Script(src, { filename: f });
  } catch (e) {
    fail(`${f} 语法错误：${e.message}`);
  }
}
ok(`${jsFiles.length} 个 JS 文件语法检查通过`);

/* --------------------------- 3. 接口一致性 --------------------------- */
const popupJs = readFileSync(join(ROOT, 'src/popup/popup.js'), 'utf8');
const bgJs = readFileSync(join(ROOT, 'src/background/service-worker.js'), 'utf8');
const contentJs = readFileSync(join(ROOT, 'src/content/content.js'), 'utf8');

// popup 发出的消息类型必须被 background 处理
const sentTypes = [...popupJs.matchAll(/send\('([^']+)'\)/g)].map((m) => m[1]);
const handledTypes = [...bgJs.matchAll(/case '([^']+)'/g)].map((m) => m[1]);
for (const t of new Set(sentTypes)) {
  if (!handledTypes.includes(t)) fail(`popup 发送的 ${t} 在 service worker 里没有处理分支`);
}
ok(`消息接口一致：popup 发送 ${new Set(sentTypes).size} 种，sw 处理 ${handledTypes.length} 种`);

// background 调用的 __NRFA__ 动作必须在 content.js 里存在
const calledActions = [...bgJs.matchAll(/do(Fill|Preview|Probe|Undo)\b/g)].map((m) => m[1].toLowerCase());
const apiBlock = contentJs.slice(contentJs.indexOf('const api = {'));
const definedActions = ['count', 'probe', 'preview', 'fill', 'undo', 'reload', 'remember', 'path']
  .filter((a) => new RegExp(`(^|[\\s{,])${a}\\s*[:(]`, 'm').test(apiBlock));
for (const a of ['fill', 'preview', 'probe', 'undo']) {
  if (!definedActions.includes(a)) fail(`content.js 的 __NRFA__ 缺少动作：${a}`);
}
ok(`__NRFA__ 暴露动作：${definedActions.join(', ')}`);

// 存储键必须一致
const keysInContent = [...contentJs.matchAll(/'(nrfa_[a-z]+)'/g)].map((m) => m[1]);
const keysInOptions = [...readFileSync(join(ROOT, 'src/options/options.js'), 'utf8').matchAll(/'(nrfa_[a-z]+)'/g)].map((m) => m[1]);
const keysInPopup = [...popupJs.matchAll(/'(nrfa_[a-z]+)'/g)].map((m) => m[1]);
const allKeys = new Set([...keysInContent, ...keysInOptions, ...keysInPopup]);
const expectedKeys = ['nrfa_settings', 'nrfa_profiles', 'nrfa_resume', 'nrfa_photo'];
for (const k of allKeys) {
  if (!expectedKeys.includes(k)) fail(`出现了意料之外的存储键：${k}`);
}
ok(`存储键统一：${[...allKeys].sort().join(', ')}`);

/* --------------------------- 4. 安全与合规 --------------------------- */
const allSources = [...jsFiles.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')])];
const htmlFiles = ['src/popup/popup.html', 'src/options/options.html'];
for (const [f, src] of allSources) {
  if (/\beval\s*\(/.test(src)) fail(`${f} 使用了 eval`);
  if (/new Function\s*\(/.test(src)) fail(`${f} 使用了 new Function`);
  if (/https?:\/\/(?!github\.com)[^\s'"]+\.(js|css)/.test(src)) fail(`${f} 疑似引用远程脚本`);
}
for (const f of htmlFiles) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  if (/<script[^>]+src=["']https?:/i.test(src)) fail(`${f} 引用了远程脚本`);
  if (/on(click|load|error)\s*=\s*["']/i.test(src)) fail(`${f} 使用了内联事件处理器（MV3 不允许）`);
}
ok('未发现 eval / new Function / 远程脚本 / 内联事件处理器');

// 内容脚本里不应出现 DOM 之外的危险写入
if (/document\.write\s*\(/.test(contentJs)) fail('content.js 使用了 document.write');
ok('未使用 document.write');

/* ------------------------------- 5. 权限体检 ------------------------------- */
const perms = manifest.permissions || [];
const heavy = ['webRequest', 'debugger', 'management', 'proxy', 'nativeMessaging', 'downloads'];
const used = heavy.filter((p) => perms.includes(p));
if (used.length) fail('申请了不必要的敏感权限：' + used.join(', '));
ok('权限清单：' + perms.join(', '));

/* ------------- 5.5 保留名检查（Chromium 的硬性要求，踩过一次坑） -------------
 * 扩展目录里任何以 "_" 开头的文件或目录都会让整个扩展加载失败：
 *   Cannot load extension with file or directory name _xxx.
 *   Filenames starting with "_" are reserved for use by the system.
 * 只有 _locales / _metadata 例外。这里全量拦截，避免改名后再踩。 */
{
  const RESERVED_OK = new Set(['_locales', '_metadata']);
  const offenders = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.name.startsWith('_') && !RESERVED_OK.has(entry.name)) offenders.push(childRel);
      if (entry.isDirectory()) walk(join(dir, entry.name), childRel);
    }
  };
  walk(ROOT, '');
  if (offenders.length) {
    fail('存在以 "_" 开头的文件/目录，Chromium 会拒绝加载整个扩展，必须改名：' + offenders.join(', '));
  } else {
    ok('没有以 "_" 开头的保留名（这类名字会让 Chromium 拒绝加载扩展）');
  }
}

/* --------------- 5.6 个人数据泄漏检查（仓库是公开的） ---------------
 * 两层防护：
 *   1. 通用格式：手机号 / 邮箱 / 身份证号 / 银行卡号，任何文件里出现都告警。
 *      示例域名（example.com）与明显占位用的号码段会被白名单放行。
 *   2. 精确关键词：如果本地存在 tools/privacy-keywords.local.json（已 gitignore），
 *      就用里面列出的真实姓名、手机、公司等逐个扫。公开仓库里没有这个文件，
 *      所以 clone 的人只会做通用检查，而本机开发者能拿到最强保护。
 */
{
  const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.md', '.html', '.css', '.bat', '.txt', '.yml', '.yaml']);
  const SKIP_DIRS = new Set(['.git', 'node_modules']);
  const ALLOW = [
    /13800138000/g,                       // 测试/演示用假号码
    /13900139000/g,                       // 测试/演示用假号码
    /18012345678/g,                       // 文档里的号码格式示例
    /@example\.com/g,                     // 保留域名，专门用于示例
    /@users\.noreply\.github\.com/g
  ];

  const files = [];
  const SKIP_FILES = new Set(['tools/privacy-keywords.local.json']);   // 关键词表本身当然含关键词
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const childRel = rel ? rel + '/' + entry.name : entry.name;
      if (entry.isDirectory()) { walk(join(dir, entry.name), childRel); continue; }
      if (SKIP_FILES.has(childRel)) continue;
      const dot = entry.name.lastIndexOf('.');
      const ext = dot < 0 ? '' : entry.name.slice(dot).toLowerCase();
      if (TEXT_EXT.has(ext) || entry.name === 'LICENSE') files.push(childRel);
    }
  };
  walk(ROOT, '');

  const strip = (text) => ALLOW.reduce((acc, re) => acc.replace(re, ''), text);

  const GENERIC = [
    [/1[3-9]\d{9}/, '手机号'],
    [/[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '邮箱'],
    [/\d{17}[\dXx]/, '身份证号'],
    [/\b\d{16,19}\b/, '银行卡号']
  ];

  let keywordList = [];
  const kwFile = join(ROOT, 'tools', 'privacy-keywords.local.json');
  if (existsSync(kwFile)) {
    try {
      const parsed = JSON.parse(readFileSync(kwFile, 'utf8'));
      keywordList = Array.isArray(parsed) ? parsed : (parsed.keywords || []);
    } catch (e) {
      fail('tools/privacy-keywords.local.json 解析失败：' + e.message);
    }
  }

  const found = [];
  for (const rel of files) {
    const text = strip(readFileSync(join(ROOT, rel), 'utf8'));
    for (const [re, label] of GENERIC) {
      const m = text.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'));
      if (m) found.push(`${rel} 命中${label}：${m[0]}`);
    }
    for (const kw of keywordList) {
      if (!kw) continue;
      if (text.includes(kw)) found.push(`${rel} 命中本地关键词：${kw}`);
    }
  }

  if (found.length) {
    fail('疑似个人数据残留在将要公开的文件里（共 ' + found.length + ' 处）：\n      ' + found.slice(0, 20).join('\n      '));
  } else {
    ok(`个人数据扫描通过（${files.length} 个文本文件` +
      (keywordList.length ? `，含 ${keywordList.length} 个本地关键词` : '，未配置本地关键词') + '）');
  }
}

/* ----------------------- 6. JS 引用与 HTML 元素对齐 ----------------------- */
for (const [jsPath, htmlPath] of [
  ['src/popup/popup.js', 'src/popup/popup.html'],
  ['src/options/options.js', 'src/options/options.html']
]) {
  const js = readFileSync(join(ROOT, jsPath), 'utf8');
  const html = readFileSync(join(ROOT, htmlPath), 'utf8');
  const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const usedIds = new Set([...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]));
  const missingIds = [...usedIds].filter((id) => !htmlIds.has(id));
  if (missingIds.length) {
    fail(`${jsPath} 引用了 ${htmlPath} 中不存在的元素 id：${missingIds.join(', ')}`);
  } else {
    ok(`${jsPath} 引用的 ${usedIds.size} 个元素 id 在 HTML 中都存在`);
  }
  // 反向检查：HTML 里定义了但 JS 从不用的 id（可能是笔误）
  const unused = [...htmlIds].filter((id) => !usedIds.has(id));
  if (unused.length) notes.push(`   （${htmlPath} 中未被 JS 使用的 id：${unused.join(', ')}）`);
}

/* ------------------------------- 输出 ------------------------------- */
console.log('='.repeat(74));
console.log('网申助手 · 交付前静态自检');
console.log('='.repeat(74));
notes.forEach((n) => console.log('  ✅ ' + n));
if (problems.length) {
  console.log('');
  problems.forEach((p) => console.log('  ❌ ' + p));
  console.log('-'.repeat(74));
  console.log(`发现 ${problems.length} 个问题`);
  process.exit(1);
}
console.log('-'.repeat(74));
console.log('全部通过 🎉');
