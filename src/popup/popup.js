/**
 * 网申助手 · 弹出面板
 * 通过 service worker 的 nrfa:* 消息在页面里执行动作（service worker 会连带处理 iframe）。
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = {
    profileName: $('profileName'),
    profileSelect: $('profileSelect'),
    dot: $('dot'),
    statusText: $('statusText'),
    metrics: $('metrics'),
    mControls: $('mControls'),
    mMatched: $('mMatched'),
    mUsable: $('mUsable'),
    mNodata: $('mNodata'),
    btnFill: $('btnFill'),
    btnPreview: $('btnPreview'),
    btnUndo: $('btnUndo'),
    btnOptions: $('btnOptions'),
    footTip: $('footTip')
  };

  const STORAGE_KEYS = { settings: 'nrfa_settings', profiles: 'nrfa_profiles' };

  function setStatus(text, kind) {
    el.statusText.textContent = text;
    el.dot.className = 'dot' + (kind ? ' ' + kind : '');
  }

  function send(type) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: type }, (res) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message });
          return;
        }
        resolve(res || { ok: false, reason: '无响应' });
      });
    });
  }

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
  }
  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  async function loadProfiles() {
    const data = await storageGet([STORAGE_KEYS.settings, STORAGE_KEYS.profiles]);
    const settings = data[STORAGE_KEYS.settings] || {};
    const profiles = data[STORAGE_KEYS.profiles] || [];
    el.profileSelect.innerHTML = profiles
      .map((p) => `<option value="${p.id}">${escapeHtml(p.name || p.id)}</option>`)
      .join('');
    const activeId = settings.activeProfileId || (profiles[0] && profiles[0].id) || '';
    el.profileSelect.value = activeId;
    const active = profiles.find((p) => p.id === activeId) || profiles[0];
    el.profileName.textContent = active ? active.name : '未配置档案';
    return { settings, profiles };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  async function refresh() {
    setStatus('正在扫描当前页面…', 'busy');
    el.metrics.hidden = true;
    const r = await send('nrfa:probe');
    if (!r || !r.ok) {
      setStatus(r && r.reason ? r.reason : '无法读取当前页面', 'warn');
      el.btnFill.disabled = true;
      el.btnPreview.disabled = true;
      el.footTip.textContent = '提示：浏览器内部页面（edge://、扩展商店等）无法注入。';
      return;
    }
    el.metrics.hidden = false;
    el.mControls.textContent = r.controls || 0;
    el.mMatched.textContent = r.matched || 0;
    el.mUsable.textContent = r.usable || 0;
    el.mNodata.textContent = r.nodata || 0;
    el.btnUndo.disabled = !r.hasUndo;

    if (!r.matched) {
      setStatus('这个页面没识别到简历表单字段', 'warn');
      el.footTip.textContent = '若表单是弹窗，请先点开表单再打开本面板。';
    } else if (!r.usable) {
      setStatus(`识别到 ${r.matched} 项，但档案里对应内容为空`, 'warn');
      el.footTip.textContent = '去「设置」把为空的字段补齐，再回来一键填充。';
    } else {
      setStatus(`识别到 ${r.matched} 项，其中 ${r.usable} 项可以填`, 'ok');
      el.footTip.textContent = '数据只保存在本机浏览器里，不会上传。';
    }
  }

  el.btnFill.addEventListener('click', async () => {
    el.btnFill.disabled = true;
    setStatus('正在填充…', 'busy');
    const r = await send('nrfa:fill');
    el.btnFill.disabled = false;
    if (r && r.ok) {
      const s = r.stat || {};
      setStatus(`已填充 ${s.filled || 0} 项` +
        (s.failed ? `，${s.failed} 项失败` : '') +
        (s.skipped ? `，跳过 ${s.skipped} 项` : ''), s.filled ? 'ok' : 'warn');
      el.btnUndo.disabled = !(s.filled > 0);
    } else {
      setStatus((r && r.reason) || '填充失败', 'err');
    }
  });

  el.btnPreview.addEventListener('click', async () => {
    const r = await send('nrfa:preview');
    if (r && r.ok) {
      setStatus(`已在页面上打开识别面板（${r.count || 0} 项）`, 'ok');
      window.close();
    } else {
      setStatus((r && r.reason) || '无法打开面板', 'err');
    }
  });

  el.btnUndo.addEventListener('click', async () => {
    const r = await send('nrfa:undo');
    if (r && r.ok) {
      setStatus(`已撤销 ${r.restored} 项`, 'ok');
      el.btnUndo.disabled = true;
    } else {
      setStatus((r && r.reason) || '没有可撤销的内容', 'warn');
    }
  });

  el.btnOptions.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  el.profileSelect.addEventListener('change', async () => {
    const data = await storageGet([STORAGE_KEYS.settings]);
    const settings = data[STORAGE_KEYS.settings] || {};
    settings.activeProfileId = el.profileSelect.value;
    await storageSet({ [STORAGE_KEYS.settings]: settings });
    const profiles = (await storageGet([STORAGE_KEYS.profiles]))[STORAGE_KEYS.profiles] || [];
    const active = profiles.find((p) => p.id === el.profileSelect.value);
    el.profileName.textContent = active ? active.name : '';
    refresh();
  });

  (async function init() {
    await loadProfiles();
    await refresh();
  })();
})();
