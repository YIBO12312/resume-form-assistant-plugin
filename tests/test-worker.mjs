/**
 * service worker 逻辑测试：用 chrome API 桩加载 service-worker.js，
 * 验证右键菜单注册、消息分发、executeScript 桥接函数的传参、多 iframe 结果汇总。
 * 运行： node tests/test-worker.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const src = readFileSync(join(ROOT, 'src/background/service-worker.js'), 'utf8');

const results = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual === undefined ? null : actual);
  const e = JSON.stringify(expected);
  results.push({ name, ok: a === e, actual: a, expected: e });
}
function checkTrue(name, cond, detail) {
  results.push({ name, ok: !!cond, actual: String(detail === undefined ? !!cond : detail), expected: 'true' });
}

/* ------------------------------ chrome API 桩 ------------------------------ */
const registered = { menus: [], commands: null, messageListener: null, installed: null, storageListener: null };
const calls = { executeScript: [], insertCSS: [], tabsCreated: [], badges: [] };

/** 注入到 vm 里的 window，桥接函数会读它 */
let bridgeWindow = { __NRFA__: null };

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  Promise,
  JSON,
  Object,
  Array,
  String,
  Number,
  Date,
  Math,
  chrome: {
    runtime: {
      onInstalled: { addListener: (fn) => { registered.installed = fn; } },
      onMessage: { addListener: (fn) => { registered.messageListener = fn; } },
      getURL: (p) => 'chrome-extension://test/' + p
    },
    contextMenus: {
      removeAll: (cb) => cb && cb(),
      create: (m) => registered.menus.push(m),
      onClicked: { addListener: () => { } }
    },
    commands: { onCommand: { addListener: (fn) => { registered.commands = fn; } } },
    tabs: {
      query: (q, cb) => { const r = [{ id: 1, url: 'https://example.com/apply' }]; if (cb) { cb(r); return; } return Promise.resolve(r); },
      create: (o) => calls.tabsCreated.push(o)
    },
    action: {
      setBadgeBackgroundColor: () => Promise.resolve(),
      setBadgeText: (o) => { calls.badges.push(o); return Promise.resolve(); }
    },
    scripting: {
      executeScript: (opts) => {
        calls.executeScript.push({ target: opts.target, hasFiles: !!opts.files, files: opts.files, hasFunc: !!opts.func, args: opts.args });
        if (opts.files) return Promise.resolve([{ frameId: 0, result: null }]);
        // 真实浏览器会在页面隔离世界里调用 func，并把返回值放进 result
        let out;
        try { out = opts.func.apply(null, opts.args || []); } catch (e) { out = { ok: false, reason: String(e && e.message || e) }; }
        if (out && typeof out.then === 'function') {
          return out.then((v) => frameResults.map((f) => ({ frameId: f.frameId, result: v && v.__perFrame ? v.__perFrame[f.frameId] : v })));
        }
        return Promise.resolve(frameResults.map((f) => ({ frameId: f.frameId, result: out })));
      },
      insertCSS: (opts) => { calls.insertCSS.push(opts); return Promise.resolve(); }
    },
    storage: {
      onChanged: { addListener: (fn) => { registered.storageListener = fn; } }
    }
  },
  window: bridgeWindow
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(src, ctx, { filename: 'service-worker.js' });

/* ------------------------------- 1. 菜单注册 ------------------------------- */
checkTrue('onInstalled 已注册', typeof registered.installed === 'function');
registered.installed({ reason: 'install' });
check('右键菜单项数量', registered.menus.length, 4);
check('菜单 id 顺序', registered.menus.map((m) => m.id), ['nrfa-fill', 'nrfa-preview', 'nrfa-sep', 'nrfa-options']);
checkTrue('首次安装会打开设置页', calls.tabsCreated.some((t) => /options\.html#welcome$/.test(t.url)),
  JSON.stringify(calls.tabsCreated));
checkTrue('快捷键监听已注册', typeof registered.commands === 'function');

/* --------------------------- 2. 消息桥接：probe --------------------------- */
sandbox.window = {
  __NRFA__: {
    probe: async () => ({ ok: true, controls: 12, matched: 9, usable: 7, nodata: 1, nomatch: 1, hasUndo: false, profile: '测试档案' })
  }
};

function sendMessage(msg) {
  return new Promise((resolve) => {
    const ret = registered.messageListener(msg, {}, resolve);
    if (ret !== true) resolve({ ok: false, reason: '监听器没有返回 true（无法异步响应）' });
  });
}

// 第一次 executeScript 返回 null（模拟内容脚本尚未注入），触发按需注入；
// 之后返回两个 frame 的结果：只有主框架真的有表单。
let firstPass = true;
sandbox.chrome.scripting.executeScript = (opts) => {
  calls.executeScript.push({ target: opts.target, hasFiles: !!opts.files, files: opts.files, hasFunc: !!opts.func, args: opts.args });
  if (opts.files) return Promise.resolve([{ frameId: 0, result: null }]);
  if (firstPass) {
    firstPass = false;
    return Promise.resolve([{ frameId: 0, result: null }]);
  }
  const out = opts.func.apply(null, opts.args || []);
  const settle = (v) => [{ frameId: 0, result: v }, { frameId: 1, result: null }];
  return (out && typeof out.then === 'function') ? out.then(settle) : Promise.resolve(settle(out));
};

const probeRes = await sendMessage({ type: 'nrfa:probe' });
checkTrue('probe 消息返回 ok', probeRes.ok === true, JSON.stringify(probeRes));
check('probe 汇总 controls', probeRes.controls, 12);
check('probe 汇总 matched', probeRes.matched, 9);
check('probe 带上档案名', probeRes.profile, '测试档案');
checkTrue('第一次失败后触发了按需注入',
  calls.insertCSS.length > 0 && calls.executeScript.some((c) => c.hasFiles && c.files.includes('src/common/matcher.js')),
  'CSS ' + calls.insertCSS.length + ' 次, 注入 ' + calls.executeScript.filter((c) => c.hasFiles).length + ' 次');
checkTrue('executeScript 使用了 allFrames',
  calls.executeScript.every((c) => c.target.allFrames === true), JSON.stringify(calls.executeScript.map((c) => c.target)));
checkTrue('桥接函数收到动作名参数',
  calls.executeScript.some((c) => c.args && c.args[0] === 'probe'), JSON.stringify(calls.executeScript.map((c) => c.args)));

/* ----------------------- 3. 多 iframe 填充结果汇总 ----------------------- */
calls.executeScript.length = 0;
sandbox.chrome.scripting.executeScript = (opts) => {
  calls.executeScript.push({ target: opts.target, hasFunc: true, args: opts.args });
  // 外层页面、内嵌 iframe 各填了一部分，还有一个 frame 没有表单
  return Promise.resolve([
    { frameId: 0, result: { ok: true, stat: { filled: 3, skipped: 1, failed: 0, nodata: 2 } } },
    { frameId: 1, result: { ok: true, stat: { filled: 2, skipped: 0, failed: 1, nodata: 0 } } },
    { frameId: 2, result: null }
  ]);
};
const fillRes = await sendMessage({ type: 'nrfa:fill' });
checkTrue('fill 返回 ok', fillRes.ok === true, JSON.stringify(fillRes));
check('fill 汇总 filled', fillRes.stat.filled, 5);
check('fill 汇总 skipped', fillRes.stat.skipped, 1);
check('fill 汇总 failed', fillRes.stat.failed, 1);
check('fill 汇总 nodata', fillRes.stat.nodata, 2);

/* ------------------------------ 4. 未知指令 ------------------------------ */
const badRes = await sendMessage({ type: 'nrfa:nope' });
checkTrue('未知指令被拒绝', badRes.ok === false && /未知指令/.test(badRes.reason), JSON.stringify(badRes));

/* --------------------- 5. 桥接函数面对不存在的 API --------------------- */
sandbox.window = { __NRFA__: null };
sandbox.chrome.scripting.executeScript = (opts) => {
  const out = opts.func.apply(null, opts.args || []);
  return Promise.resolve([{ frameId: 0, result: out === undefined ? null : out }]);
};
const noApi = await sendMessage({ type: 'nrfa:probe' });
checkTrue('页面没有注入脚本时给出可读原因',
  noApi.ok === false && typeof noApi.reason === 'string' && noApi.reason.length > 0, JSON.stringify(noApi));

/* ------------------------- 6. 设置变更时广播刷新 ------------------------- */
sandbox.window = { __NRFA__: { reload: () => ({ ok: true }) } };
sandbox.chrome.scripting.executeScript = (opts) => {
  calls.executeScript.push({ target: opts.target, hasFunc: !!opts.func, args: opts.args });
  if (opts.func) { try { opts.func.apply(null, opts.args || []); } catch (e) { /* ignore */ } }
  return Promise.resolve([{ frameId: 0, result: null }]);
};
calls.executeScript.length = 0;
registered.storageListener({ nrfa_settings: { newValue: {} } }, 'local');
await new Promise((r) => setTimeout(r, 30));
checkTrue('设置变更会重新读取页面配置', calls.executeScript.length > 0, calls.executeScript.length + ' 次');
checkTrue('刷新用的是 reload 动作', calls.executeScript.every((c) => !c.args), JSON.stringify(calls.executeScript.map((c) => c.args)));
checkTrue('无关的 storage 变更不触发广播', (() => {
  calls.executeScript.length = 0;
  registered.storageListener({ somethingElse: { newValue: 1 } }, 'local');
  return calls.executeScript.length === 0;
})(), calls.executeScript.length);

/* ------------------------------- 输出 ------------------------------- */
const failed = results.filter((r) => !r.ok);
console.log('='.repeat(74));
console.log('网申助手 · service worker 逻辑测试');
console.log('='.repeat(74));
results.forEach((r) => {
  if (r.ok) console.log('  ✅ ' + r.name);
  else console.log(`  ❌ ${r.name}\n       期望: ${r.expected}\n       实际: ${r.actual}`);
});
console.log('-'.repeat(74));
console.log(`结果：通过 ${results.length - failed.length} / ${results.length}` +
  (failed.length ? `，失败 ${failed.length}` : '，全部通过 🎉'));
process.exit(failed.length ? 1 : 0);
