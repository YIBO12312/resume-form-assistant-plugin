/**
 * 网申助手 · 后台服务（MV3 service worker）
 * ------------------------------------------------------------------
 * 职责：
 *   - 注册右键菜单与快捷键
 *   - 用 chrome.scripting 在页面（含 iframe）里调用注入脚本暴露的 window.__NRFA__
 *   - 注入脚本缺失时按需补注入
 *   - 首次安装打开设置页
 */

const FILES_JS = [
  'src/common/schema.js',
  'src/common/matcher.js',
  'src/content/content.js'
];
const FILES_CSS = ['src/content/content.css'];

/* ============================== 注入与调用 ============================== */

/** 在 func 里运行的代码必须自包含（不能引用外部变量），所以通过 args 传参 */
function callBridge(action, args) {
  return function (a, ar) {
    const api = window.__NRFA__;
    if (!api || typeof api[a] !== 'function') return null;
    try { return api[a].apply(api, ar || []); } catch (e) { return { ok: false, reason: String(e && e.message || e) }; }
  };
}

async function ensureInjected(tabId) {
  try {
    await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: FILES_CSS });
  } catch (e) { /* 有些 frame 不允许注入，忽略 */ }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: FILES_JS });
  } catch (e) {
    // allFrames 失败时退回只注入主框架
    try {
      await chrome.scripting.insertCSS({ target: { tabId }, files: FILES_CSS });
      await chrome.scripting.executeScript({ target: { tabId }, files: FILES_JS });
    } catch (e2) { /* 特殊页面（edge:// 等）无法注入 */ }
  }
}

/**
 * 在标签页所有 frame 里调用 __NRFA__[action]
 * @returns {{ok:boolean, frames:Array, reason?:string}}
 */
async function callInTab(tabId, action, args) {
  let injection;
  try {
    injection = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: callBridge(action, args),
      args: [action, args || []]
    });
  } catch (e) {
    return { ok: false, frames: [], reason: '无法访问此页面（可能是浏览器内部页面）' };
  }

  const anyLoaded = injection.some((r) => r.result !== null && r.result !== undefined);
  if (!anyLoaded) {
    await ensureInjected(tabId);
    try {
      injection = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        func: callBridge(action, args),
        args: [action, args || []]
      });
    } catch (e) {
      return { ok: false, frames: [], reason: '注入失败：' + (e && e.message ? e.message : e) };
    }
  }

  const frames = injection
    .filter((r) => r.result !== null && r.result !== undefined)
    .map((r) => ({ frameId: r.frameId, result: r.result }));

  if (!frames.length) {
    return { ok: false, frames: [], reason: '页面里没有识别到可填写的表单字段' };
  }
  return { ok: true, frames: frames };
}

/** 汇总各 frame 的填充统计 */
function mergeFillResult(res) {
  const stat = { filled: 0, skipped: 0, failed: 0, nodata: 0 };
  let framesWithWork = 0;
  for (const f of res.frames) {
    const r = f.result;
    if (!r || !r.ok) continue;
    if (r.stat) {
      stat.filled += r.stat.filled || 0;
      stat.skipped += r.stat.skipped || 0;
      stat.failed += r.stat.failed || 0;
      stat.nodata += r.stat.nodata || 0;
      if ((r.stat.filled || 0) > 0) framesWithWork++;
    }
  }
  return { ok: true, stat: stat, frames: framesWithWork };
}

function mergeProbeResult(res) {
  const out = { controls: 0, matched: 0, usable: 0, nodata: 0, nomatch: 0, hasUndo: false, profile: '' };
  for (const f of res.frames) {
    const r = f.result;
    if (!r || !r.ok) continue;
    out.controls += r.controls || 0;
    out.matched += r.matched || 0;
    out.usable += r.usable || 0;
    out.nodata += r.nodata || 0;
    out.nomatch += r.nomatch || 0;
    out.hasUndo = out.hasUndo || !!r.hasUndo;
    if (!out.profile && r.profile) out.profile = r.profile;
  }
  return out;
}

/* ============================== 动作分发 ============================== */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function doFill(tabId) {
  const res = await callInTab(tabId, 'fill', []);
  if (!res.ok) return res;
  return mergeFillResult(res);
}

async function doPreview(tabId) {
  const res = await callInTab(tabId, 'preview', []);
  if (!res.ok) return res;
  let total = 0;
  res.frames.forEach((f) => { if (f.result && f.result.count) total += f.result.count; });
  return { ok: true, count: total };
}

async function doProbe(tabId) {
  const res = await callInTab(tabId, 'probe', []);
  if (!res.ok) return res;
  return Object.assign({ ok: true }, mergeProbeResult(res));
}

async function doUndo(tabId) {
  const res = await callInTab(tabId, 'undo', []);
  if (!res.ok) return res;
  let restored = 0;
  res.frames.forEach((f) => { if (f.result && f.result.restored) restored += f.result.restored; });
  return { ok: true, restored: restored };
}

/** 在页面上显示一个轻量提示（用 content script 的注入样式类无法做浮层，这里用 console + 标题角标） */
function notifyTab(tabId, message) {
  chrome.action.setBadgeBackgroundColor({ color: '#2563eb' }).catch(() => { });
  chrome.action.setBadgeText({ tabId: tabId, text: '✓' }).catch(() => { });
  setTimeout(() => { chrome.action.setBadgeText({ tabId: tabId, text: '' }).catch(() => { }); }, 2500);
  console.log('[网申助手]', message);
}

/* ============================== 右键菜单 ============================== */

const MENUS = [
  { id: 'nrfa-fill', title: '网申助手：一键填充此表单', contexts: ['page', 'editable'] },
  { id: 'nrfa-preview', title: '网申助手：预览识别结果', contexts: ['page', 'editable'] },
  { id: 'nrfa-sep', type: 'separator' },
  { id: 'nrfa-options', title: '网申助手：打开设置…', contexts: ['page', 'editable'] }
];

function buildMenus() {
  chrome.contextMenus.removeAll(() => {
    MENUS.forEach((m) => {
      try { chrome.contextMenus.create(m); } catch (e) { /* ignore */ }
    });
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  buildMenus();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#welcome') });
  }
});

chrome.runtime.onStartup && chrome.runtime.onStartup.addListener(buildMenus);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'nrfa-options') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
    return;
  }
  if (!tab || tab.id == null) return;
  if (info.menuItemId === 'nrfa-fill') {
    const r = await doFill(tab.id);
    if (r.ok) notifyTab(tab.id, `已填充 ${r.stat.filled} 项`);
    else notifyTab(tab.id, r.reason || '填充失败');
  } else if (info.menuItemId === 'nrfa-preview') {
    await doPreview(tab.id);
  }
});

/* ============================== 快捷键 ============================== */

chrome.commands && chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab || tab.id == null) return;
  if (command === 'fill-form') {
    const r = await doFill(tab.id);
    notifyTab(tab.id, r.ok ? `已填充 ${r.stat.filled} 项` : (r.reason || '填充失败'));
  } else if (command === 'preview-form') {
    await doPreview(tab.id);
  }
});

/* ============================== 消息接口 ============================== */

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  const run = async () => {
    const tab = msg.tabId ? { id: msg.tabId } : await getActiveTab();
    if (!tab || tab.id == null) return { ok: false, reason: '没有活动标签页' };
    switch (msg.type) {
      case 'nrfa:probe': return await doProbe(tab.id);
      case 'nrfa:fill': return await doFill(tab.id);
      case 'nrfa:preview': return await doPreview(tab.id);
      case 'nrfa:undo': return await doUndo(tab.id);
      case 'nrfa:options':
        chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
        return { ok: true };
      default: return { ok: false, reason: '未知指令 ' + msg.type };
    }
  };

  run().then(sendResponse).catch((e) => sendResponse({ ok: false, reason: String(e && e.message || e) }));
  return true;   // 异步响应
});

/* ============================== 设置变更广播 ============================== */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!changes.nrfa_settings && !changes.nrfa_profiles && !changes.nrfa_resume) return;
  // 通知所有已注入的页面重新读取配置
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((t) => {
      if (t.id == null) return;
      chrome.scripting.executeScript({
        target: { tabId: t.id, allFrames: true },
        func: function () {
          const api = window.__NRFA__;
          if (api && typeof api.reload === 'function') { try { api.reload(); } catch (e) { /* ignore */ } }
        }
      }).catch(() => { /* 忽略无法注入的标签页 */ });
    });
  });
});
