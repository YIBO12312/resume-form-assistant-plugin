/**
 * 网申助手 · 设置页逻辑
 * 纯原生 JS，无构建步骤。
 */
(function () {
  'use strict';

  const S = globalThis.NRFA_SCHEMA;
  if (!S) { document.body.innerHTML = '<p style="padding:24px">schema.js 加载失败，请重新加载扩展。</p>'; return; }

  const STORAGE_KEYS = { settings: 'nrfa_settings', profiles: 'nrfa_profiles', resume: 'nrfa_resume' };
  const $ = (id) => document.getElementById(id);

  const state = {
    settings: Object.assign({}, S.DEFAULT_SETTINGS),
    profiles: [],
    resume: null,
    dirty: false,
    saveTimer: null,
    search: '',
    onlyEmpty: false
  };

  /* ============================== 存储 ============================== */

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, (r) => resolve(r || {})));
  }
  function storageSet(obj) {
    return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve(true)));
  }

  function toast(text, kind) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  function markDirty() {
    state.dirty = true;
    const el = $('saveState');
    el.textContent = '未保存…';
    el.classList.add('dirty');
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => save(true), 1200);
  }

  async function save(silent) {
    clearTimeout(state.saveTimer);
    state.settings.activeProfileId = activeProfile().id;
    await storageSet({
      [STORAGE_KEYS.settings]: state.settings,
      [STORAGE_KEYS.profiles]: state.profiles,
      [STORAGE_KEYS.resume]: state.resume
    });
    state.dirty = false;
    const el = $('saveState');
    el.textContent = '已保存';
    el.classList.remove('dirty');
    if (!silent) toast('已保存', 'ok');
    renderSideNote();
  }

  /* ============================== 档案 ============================== */

  function activeProfile() {
    return state.profiles.find((p) => p.id === state.settings.activeProfileId) || state.profiles[0];
  }

  function newProfileObject(name, copyFrom) {
    const base = copyFrom
      ? JSON.parse(JSON.stringify(copyFrom))
      : JSON.parse(JSON.stringify(S.DEFAULT_PROFILE));
    base.id = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    base.name = name;
    base.updatedAt = Date.now();
    if (!copyFrom) {
      // 新档案清空所有值，避免误以为已经填过
      Object.keys(base.fields).forEach((k) => { base.fields[k] = ''; });
    }
    return base;
  }

  function countFilled(profile) {
    const fields = profile.fields || {};
    return Object.keys(fields).filter((k) => String(fields[k] || '').trim() !== '').length;
  }

  function missingRequired() {
    const p = activeProfile();
    return S.FIELD_DEFS
      .filter((d) => d.required && !String((p.fields || {})[d.key] || '').trim())
      .map((d) => d.label);
  }

  function renderProfileList() {
    const ul = $('profileList');
    ul.innerHTML = state.profiles.map((p) => `
      <li data-id="${p.id}" class="${p.id === state.settings.activeProfileId ? 'active' : ''}">
        <span>${escapeHtml(p.name)}</span>
        <span class="cnt">${countFilled(p)} 项</span>
      </li>`).join('');
    ul.querySelectorAll('li').forEach((li) => {
      li.addEventListener('click', () => {
        state.settings.activeProfileId = li.dataset.id;
        renderAll();
        markDirty();
      });
    });
  }

  function renderSideNote() {
    const note = $('missingNote');
    const missing = missingRequired();
    if (!missing.length) {
      note.hidden = true;
      return;
    }
    note.hidden = false;
    note.innerHTML = `<b>还有 ${missing.length} 个必填项是空的：</b><br>${escapeHtml(missing.join('、'))}`;
  }

  /* ============================== 字段编辑 ============================== */

  function allFields() {
    const custom = (state.settings.customFields || []).map((cf) => ({
      key: cf.key,
      label: cf.label || cf.key,
      group: '自定义字段',
      type: cf.type || 'text',
      aliases: [],
      options: null,
      multiline: (cf.type || 'text') === 'textarea'
    }));
    return S.FIELD_DEFS.concat(custom);
  }

  function groupedFields() {
    const groups = [];
    const map = {};
    allFields().forEach((f) => {
      if (!map[f.group]) { map[f.group] = []; groups.push(f.group); }
      map[f.group].push(f);
    });
    return groups.map((g) => ({ name: g, fields: map[g] }));
  }

  function fieldControl(def, value) {
    const id = 'f_' + def.key;
    const common = `id="${id}" data-key="${def.key}"`;
    if (def.multiline || def.type === 'textarea') {
      return `<textarea ${common} rows="${def.key === 'selfEvaluation' || def.key === 'internSummary' || def.key === 'projectSummary' ? 8 : 4}" placeholder="${escapeAttr(def.placeholder || '')}">${escapeHtml(value)}</textarea>`;
    }
    if (def.options && def.options.length) {
      const listId = 'dl_' + def.key;
      return `<input type="text" ${common} list="${listId}" value="${escapeAttr(value)}" placeholder="${escapeAttr(def.placeholder || '')}">
        <datalist id="${listId}">${def.options.map((o) => `<option value="${escapeAttr(o)}"></option>`).join('')}</datalist>`;
    }
    return `<input type="text" ${common} value="${escapeAttr(value)}" placeholder="${escapeAttr(def.placeholder || '')}">`;
  }

  function renderFields() {
    const p = activeProfile();
    const kw = state.search.trim().toLowerCase();
    const root = $('fieldsRoot');
    let html = '';
    let shown = 0;

    groupedFields().forEach((g) => {
      const items = g.fields.filter((f) => {
        const v = String((p.fields || {})[f.key] || '');
        if (state.onlyEmpty && v.trim() !== '') return false;
        if (!kw) return true;
        return (f.label + ' ' + f.key + ' ' + (f.aliases || []).join(' ')).toLowerCase().indexOf(kw) !== -1;
      });
      if (!items.length) return;

      html += `<div class="group"><h3>${escapeHtml(g.name)}</h3><div class="grid">`;
      items.forEach((f) => {
        shown++;
        const value = String((p.fields || {})[f.key] || '');
        const isLong = f.multiline || f.type === 'textarea';
        const missing = f.required && !value.trim();
        html += `
          <div class="field ${missing ? 'missing' : ''} ${isLong ? 'span2' : ''}" data-field="${f.key}">
            <label for="f_${f.key}">
              <span class="req ${f.required ? '' : 'hidden'}"></span>
              ${escapeHtml(f.label)}
            </label>
            ${fieldControl(f, value)}
            ${isLong ? `<div class="counter" data-counter="${f.key}">${value.length} 字</div>` : ''}
            ${f.placeholder ? `<div class="fhint">${escapeHtml(f.placeholder)}</div>` : ''}
          </div>`;
      });
      html += '</div></div>';
    });

    if (!shown) {
      html = `<div class="empty-tip">没有匹配的字段${state.onlyEmpty ? '（当前没有空字段）' : ''}。</div>`;
    }
    root.innerHTML = html;

    root.querySelectorAll('[data-key]').forEach((input) => {
      const key = input.dataset.key;
      const handler = () => {
        activeProfile().fields[key] = input.value;
        activeProfile().updatedAt = Date.now();
        const counter = root.querySelector(`[data-counter="${key}"]`);
        if (counter) counter.textContent = input.value.length + ' 字';
        const wrap = input.closest('.field');
        const def = allFields().find((f) => f.key === key);
        if (wrap && def && def.required) wrap.classList.toggle('missing', !input.value.trim());
        renderSideNote();
        renderProfileList();
        markDirty();
      };
      input.addEventListener('input', handler);
      input.addEventListener('change', handler);
    });
  }

  /* ============================== 附件 ============================== */

  function renderAttachment() {
    const info = $('attachInfo');
    if (state.resume && state.resume.name) {
      const kb = Math.round((state.resume.size || 0) / 1024);
      info.innerHTML = `<b>${escapeHtml(state.resume.name)}</b> <span>${kb} KB · ${escapeHtml(state.resume.type || '未知类型')}</span>`;
    } else {
      info.textContent = '尚未选择简历文件';
    }
  }

  function pickResume(file) {
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) {
      toast('文件超过 6MB，建议先用压缩版简历', 'err');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.resume = {
        name: file.name,
        type: file.type || 'application/octet-stream',
        size: file.size,
        dataUrl: String(reader.result)
      };
      renderAttachment();
      save(true);
      toast('简历已保存，之后填表会自动挂载', 'ok');
    };
    reader.onerror = () => toast('读取文件失败', 'err');
    reader.readAsDataURL(file);
  }

  /* ============================== 自定义字段 ============================== */

  function renderCustom() {
    const list = state.settings.customFields || [];
    const root = $('customRoot');
    if (!list.length) {
      root.innerHTML = '<div class="empty-tip">还没有自定义字段。点右上角「添加字段」新增。</div>';
      return;
    }
    root.innerHTML = `
      <div class="custom-row" style="border-bottom:1px solid #e5e7eb;padding-bottom:6px">
        <b style="font-size:11.5px;color:#6b7280">字段名</b>
        <b style="font-size:11.5px;color:#6b7280">页面上的别名（英文逗号分隔）</b>
        <b style="font-size:11.5px;color:#6b7280">控件类型</b>
        <span></span>
      </div>` + list.map((cf, i) => `
      <div class="custom-row" data-i="${i}">
        <input type="text" data-role="label" value="${escapeAttr(cf.label || '')}" placeholder="如：是否接受外派">
        <input type="text" data-role="aliases" value="${escapeAttr((cf.aliases || []).join(','))}" placeholder="如：外派,接受外派,是否接受外派">
        <select data-role="type">
          <option value="text" ${cf.type === 'text' ? 'selected' : ''}>单行文本</option>
          <option value="textarea" ${cf.type === 'textarea' ? 'selected' : ''}>多行文本</option>
          <option value="select" ${cf.type === 'select' ? 'selected' : ''}>下拉 / 单选</option>
        </select>
        <button class="mini danger" data-role="del">删除</button>
      </div>`).join('');

    root.querySelectorAll('.custom-row[data-i]').forEach((row) => {
      const i = Number(row.dataset.i);
      const cf = state.settings.customFields[i];
      row.querySelector('[data-role=label]').addEventListener('input', (e) => {
        cf.label = e.target.value;
        if (!cf.key) cf.key = 'custom_' + i;
        markDirty();
      });
      row.querySelector('[data-role=aliases]').addEventListener('input', (e) => {
        cf.aliases = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
        markDirty();
      });
      row.querySelector('[data-role=type]').addEventListener('change', (e) => {
        cf.type = e.target.value;
        markDirty();
      });
      row.querySelector('[data-role=del]').addEventListener('click', () => {
        const key = cf.key;
        state.settings.customFields.splice(i, 1);
        state.profiles.forEach((p) => { if (p.fields) delete p.fields[key]; });
        renderCustom();
        renderFields();
        markDirty();
      });
    });
  }

  function addCustomField() {
    if (!state.settings.customFields) state.settings.customFields = [];
    if (state.settings.customFields.length >= 40) { toast('自定义字段最多 40 个', 'err'); return; }
    const key = 'custom_' + Date.now().toString(36);
    state.settings.customFields.push({ key: key, label: '', aliases: [], type: 'text' });
    state.profiles.forEach((p) => { if (p.fields) p.fields[key] = p.fields[key] || ''; });
    renderCustom();
    renderFields();
    markDirty();
  }

  /* ============================== 站点规则 ============================== */

  function renderRules() {
    const rules = state.settings.siteRules || {};
    const hosts = Object.keys(rules).filter((h) => (rules[h] || []).length);
    const root = $('rulesRoot');
    if (!hosts.length) {
      root.innerHTML = '<div class="empty-tip">还没有记录任何站点规则。自动识别能覆盖绝大多数网站。</div>';
      return;
    }
    let rows = '';
    hosts.forEach((h) => {
      rules[h].forEach((r, i) => {
        rows += `<tr>
          <td class="host">${escapeHtml(h)}</td>
          <td><code>${escapeHtml(r.selector)}</code></td>
          <td>${escapeHtml(fieldLabelOf(r.fieldKey))}</td>
          <td><button class="mini danger" data-host="${escapeAttr(h)}" data-i="${i}">删除</button></td>
        </tr>`;
      });
    });
    root.innerHTML = `<table class="rules">
      <thead><tr><th>网站</th><th>页面选择器</th><th>对应字段</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>`;

    root.querySelectorAll('button[data-host]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const h = btn.dataset.host;
        const i = Number(btn.dataset.i);
        state.settings.siteRules[h].splice(i, 1);
        if (!state.settings.siteRules[h].length) delete state.settings.siteRules[h];
        renderRules();
        markDirty();
      });
    });
  }

  function fieldLabelOf(key) {
    const def = S.FIELD_MAP[key];
    if (def) return def.label;
    const cf = (state.settings.customFields || []).find((c) => c.key === key);
    return cf ? (cf.label || key) : key;
  }

  /* ============================== 通用设置 ============================== */

  function renderGeneral() {
    $('setFabMode').value = state.settings.fabMode || 'auto';
    $('setFillEmptyOnly').checked = !!state.settings.fillEmptyOnly;
    $('setHighlight').checked = !!state.settings.highlightFilled;
    $('setEvents').checked = !!state.settings.triggerEvents;
    $('setFillFile').checked = !!state.settings.fillFileInput;
    $('setAutoFill').checked = !!state.settings.autoFillOnLoad;
    $('setThreshold').value = state.settings.matchThreshold || 66;
    $('thresholdText').textContent = `当前 ${state.settings.matchThreshold || 66}：数值越低填得越多但越可能填错，建议 62～72。`;
  }

  function bindGeneral() {
    $('setFabMode').addEventListener('change', (e) => { state.settings.fabMode = e.target.value; markDirty(); });
    $('setFillEmptyOnly').addEventListener('change', (e) => { state.settings.fillEmptyOnly = e.target.checked; markDirty(); });
    $('setHighlight').addEventListener('change', (e) => { state.settings.highlightFilled = e.target.checked; markDirty(); });
    $('setEvents').addEventListener('change', (e) => { state.settings.triggerEvents = e.target.checked; markDirty(); });
    $('setFillFile').addEventListener('change', (e) => { state.settings.fillFileInput = e.target.checked; markDirty(); });
    $('setAutoFill').addEventListener('change', (e) => {
      state.settings.autoFillOnLoad = e.target.checked;
      if (e.target.checked) toast('已开启自动填充：进入网申页会自动填写', 'ok');
      markDirty();
    });
    $('setThreshold').addEventListener('input', (e) => {
      state.settings.matchThreshold = Number(e.target.value);
      $('thresholdText').textContent = `当前 ${state.settings.matchThreshold}：数值越低填得越多但越可能填错，建议 62～72。`;
      markDirty();
    });
  }

  /* ============================== 导入导出 ============================== */

  function exportJSON() {
    const data = {
      app: '网申助手 Resume Form Assistant',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      profiles: state.profiles
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `网申助手-档案备份-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('已导出（不含简历附件文件）', 'ok');
  }

  function importJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.profiles) || !data.profiles.length) {
          throw new Error('文件里没有档案数据');
        }
        state.profiles = data.profiles;
        state.settings = Object.assign({}, S.DEFAULT_SETTINGS, data.settings || {});
        if (!state.profiles.some((p) => p.id === state.settings.activeProfileId)) {
          state.settings.activeProfileId = state.profiles[0].id;
        }
        await save(true);
        renderAll();
        toast(`已导入 ${state.profiles.length} 个档案`, 'ok');
      } catch (e) {
        toast('导入失败：' + (e && e.message ? e.message : e), 'err');
      }
    };
    reader.readAsText(file);
  }

  async function resetAll() {
    if (!confirm('确定恢复为初始档案吗？当前所有档案与设置都会被替换（简历附件保留）。')) return;
    state.profiles = [JSON.parse(JSON.stringify(S.DEFAULT_PROFILE))];
    state.settings = Object.assign({}, S.DEFAULT_SETTINGS, {
      activeProfileId: state.profiles[0].id,
      resumeFile: state.settings.resumeFile
    });
    await save(true);
    renderAll();
    toast('已恢复初始档案', 'ok');
  }

  /* ============================== 渲染入口 ============================== */

  function renderAll() {
    renderProfileList();
    renderFields();
    renderAttachment();
    renderCustom();
    renderRules();
    renderGeneral();
    renderSideNote();
    const p = activeProfile();
    $('subtitle').textContent = `当前档案：${p.name} · 数据只保存在这台电脑的浏览器里`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function escapeAttr(s) { return escapeHtml(s); }

  /* ============================== 绑定 ============================== */

  function bind() {
    $('btnSave').addEventListener('click', () => save(false));
    $('btnNewProfile').addEventListener('click', () => {
      const name = prompt('新档案名称（例如：Java 后端实习 / 大数据方向）', '新档案');
      if (name === null) return;
      const p = newProfileObject(name.trim() || '新档案', null);
      state.profiles.push(p);
      state.settings.activeProfileId = p.id;
      renderAll();
      markDirty();
      toast('已新建空档案，去「档案字段」里填写内容', 'ok');
    });
    $('btnDuplicateProfile').addEventListener('click', () => {
      const cur = activeProfile();
      const name = prompt('复制后的档案名称', cur.name + ' 副本');
      if (name === null) return;
      const p = newProfileObject(name.trim() || (cur.name + ' 副本'), cur);
      state.profiles.push(p);
      state.settings.activeProfileId = p.id;
      renderAll();
      markDirty();
    });
    $('btnDeleteProfile').addEventListener('click', () => {
      if (state.profiles.length <= 1) { toast('至少要保留一个档案', 'err'); return; }
      const cur = activeProfile();
      if (!confirm(`确定删除档案「${cur.name}」吗？`)) return;
      state.profiles = state.profiles.filter((p) => p.id !== cur.id);
      state.settings.activeProfileId = state.profiles[0].id;
      renderAll();
      markDirty();
    });

    $('fieldSearch').addEventListener('input', (e) => { state.search = e.target.value; renderFields(); });
    $('onlyEmpty').addEventListener('change', (e) => { state.onlyEmpty = e.target.checked; renderFields(); });

    $('btnPickResume').addEventListener('click', () => $('resumeInput').click());
    $('resumeInput').addEventListener('change', (e) => pickResume(e.target.files && e.target.files[0]));
    $('btnClearResume').addEventListener('click', () => {
      state.resume = null;
      renderAttachment();
      save(true);
      toast('已清除简历附件');
    });

    $('btnAddCustom').addEventListener('click', addCustomField);

    $('btnClearRules').addEventListener('click', () => {
      if (!Object.keys(state.settings.siteRules || {}).length) { toast('当前没有规则'); return; }
      if (!confirm('确定清空所有站点规则吗？')) return;
      state.settings.siteRules = {};
      renderRules();
      markDirty();
    });

    $('btnExport').addEventListener('click', exportJSON);
    $('btnImport').addEventListener('click', () => $('importInput').click());
    $('importInput').addEventListener('change', (e) => importJSON(e.target.files && e.target.files[0]));
    $('btnReset').addEventListener('click', resetAll);

    $('btnSelfTest').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('tests/engine-test.html') });
    });

    // 导航高亮
    const links = Array.from(document.querySelectorAll('#nav a'));
    links.forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.querySelector(a.getAttribute('href'));
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        links.forEach((x) => x.classList.remove('active'));
        a.classList.add('active');
      });
    });
    const sections = Array.from(document.querySelectorAll('.sec'));
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver((entries) => {
        entries.forEach((en) => {
          if (!en.isIntersecting) return;
          const id = '#' + en.target.id.replace(/^sec-/, '');
          links.forEach((x) => x.classList.toggle('active', x.getAttribute('href') === id));
        });
      }, { rootMargin: '-80px 0px -70% 0px' });
      sections.forEach((s) => io.observe(s));
    }

    window.addEventListener('beforeunload', () => { if (state.dirty) save(true); });
  }

  /* ============================== 启动 ============================== */

  (async function init() {
    const data = await storageGet([STORAGE_KEYS.settings, STORAGE_KEYS.profiles, STORAGE_KEYS.resume]);
    state.settings = Object.assign({}, S.DEFAULT_SETTINGS, data[STORAGE_KEYS.settings] || {});
    state.profiles = data[STORAGE_KEYS.profiles];
    state.resume = data[STORAGE_KEYS.resume] || null;
    if (!Array.isArray(state.profiles) || !state.profiles.length) {
      state.profiles = [JSON.parse(JSON.stringify(S.DEFAULT_PROFILE))];
    }
    if (!state.profiles.some((p) => p.id === state.settings.activeProfileId)) {
      state.settings.activeProfileId = state.profiles[0].id;
    }
    bind();
    renderAll();

    if (location.hash === '#welcome') {
      const box = $('welcomeBox');
      box.hidden = false;
      setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
    }
  })();
})();
