/**
 * 网申助手 · 页面注入脚本（content script）
 * ------------------------------------------------------------------
 * 职责：
 *   1. 读取当前档案与设置
 *   2. 扫描页面控件 → 用 matcher 识别字段 → 生成"填充计划"
 *   3. 用 React/Vue 友好的方式写值（原生 setter + input/change 事件）
 *   4. 支持原生 select / 单选组 / Ant Design·Element·iView 等自定义下拉
 *   5. 支持把简历文件自动挂到 input[type=file]
 *   6. 悬浮球 + 预览面板（Shadow DOM 隔离，不污染页面样式）+ 一键撤销
 *
 * 对外接口（同扩展的隔离世界里可见，供 popup / service worker 用 executeScript 调用）：
 *   window.__NRFA__.count()    → 识别到的字段数
 *   window.__NRFA__.preview()  → 打开面板
 *   window.__NRFA__.fill()     → 直接填充，返回统计
 *   window.__NRFA__.undo()     → 撤销上一次填充
 *   window.__NRFA__.reload()   → 重新读取设置
 */
(function () {
  'use strict';

  if (window.__NRFA_LOADED__) return;
  window.__NRFA_LOADED__ = true;

  const S = globalThis.NRFA_SCHEMA;
  const M = globalThis.NRFA_MATCHER;
  if (!S || !M) { console.warn('[网申助手] schema/matcher 未加载'); return; }

  /**
   * 是否顶层框架。
   * 填充要在所有 frame 里都能跑（表单常常嵌在 iframe 里，由快捷键/弹窗/右键统一触发），
   * 但悬浮球只在顶层页面画一个，避免 iframe 里冒出多个按钮。
   */
  const IS_TOP = (function () { try { return window.top === window; } catch (e) { return false; } })();

  const STORAGE_KEYS = {
    settings: 'nrfa_settings',
    profiles: 'nrfa_profiles',
    resume: 'nrfa_resume',
    photo: 'nrfa_photo'
  };

  /** 匹配来源的中文说明，面板里展示给用户看 */
  const SOURCE_LABELS = {
    label: '表单标签',
    aria: '无障碍标签',
    title: 'title 属性',
    data: 'data 属性',
    placeholder: '输入提示',
    tableHead: '表头',
    rowLabel: '同行标签',
    dt: 'dt 标签',
    groupLabel: '选项组题干',
    groupPrev: '题干',
    sibling: '相邻文字',
    ancestor0: '外层容器',
    ancestor1: '外层容器',
    ancestor2: '外层容器',
    ancestor3: '外层容器',
    name: 'name 属性',
    id: 'id 属性',
    class: 'class 属性',
    'site-rule': '站点规则'
  };
  function sourceLabel(s) { return SOURCE_LABELS[s] || s; }

  const KIND_LABELS = {
    text: '单行输入',
    textarea: '多行输入',
    select: '下拉框',
    radio: '单选',
    customSelect: '自绘下拉',
    file: '文件上传'
  };

  const state = {
    settings: JSON.parse(JSON.stringify(S.DEFAULT_SETTINGS)),
    profile: null,
    profiles: [],
    resumeFile: null,
    index: null,
    plan: [],
    undo: null,
    ui: null,
    busy: false,
    lastScanAt: 0
  };

  /* ============================== 工具 ============================== */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function storageGet(keys) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(keys, (r) => resolve(r || {})); }
      catch (e) { resolve({}); }
    });
  }
  function storageSet(obj) {
    return new Promise((resolve) => {
      try { chrome.storage.local.set(obj, () => resolve(true)); }
      catch (e) { resolve(false); }
    });
  }

  function textOf(el) {
    return (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
  }

  function truncate(s, n) {
    const t = String(s == null ? '' : s).replace(/\s+/g, ' ');
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  /** 给元素生成一个稳定的选择器（用于站点规则记忆） */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + name + '"]';
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 4) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = Array.prototype.filter.call(parent.children, (c) => c.tagName === node.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  /* ============================== 数据 ============================== */

  /** 当前档案里的可重复区块数据 */
  function listsOf() {
    const p = state.profile || {};
    return (p.lists && typeof p.lists === 'object') ? p.lists : {};
  }

  /**
   * 参与识别的字段集合：
   *   - 扁平字段（单条）
   *   - 可重复区块的子字段（仅当档案里该区块有条目时才加入）
   *   - 用户自定义字段
   * 区块一旦有条目，就把被它顶替的扁平字段剔掉，
   * 免得同一个控件被「单条字段」和「第 N 条区块」同时争抢。
   */
  function effectiveFields() {
    const lists = listsOf();
    const dead = S.supersededKeys ? S.supersededKeys(lists) : {};
    const flat = S.FIELD_DEFS.filter((d) => !dead[d.key]);

    const listItems = (S.listItemFields ? S.listItemFields() : []).filter((f) => {
      const items = lists[f.listKey];
      return Array.isArray(items) && items.length > 0;
    });

    const custom = (state.settings.customFields || []).map((cf) => ({
      key: cf.key,
      label: cf.label || cf.key,
      group: '自定义字段',
      type: cf.type || 'text',
      aliases: (cf.aliases && cf.aliases.length) ? cf.aliases : [cf.label || cf.key]
    }));

    return flat.concat(listItems, custom);
  }

  function valueOf(key) {
    const f = state.profile && state.profile.fields ? state.profile.fields : {};
    const v = f[key];
    return v === undefined || v === null ? '' : v;
  }

  /** 取某条区块记录里的某个字段值 */
  function valueOfListItem(listKey, index, itemKey) {
    const items = listsOf()[listKey];
    if (!Array.isArray(items)) return '';
    const item = items[index];
    if (!item) return '';
    const v = item[itemKey];
    return v === undefined || v === null ? '' : v;
  }

  /** 档案里一共有几条 */
  function listCount(listKey) {
    const items = listsOf()[listKey];
    return Array.isArray(items) ? items.length : 0;
  }

  function fieldLabel(key) {
    const def = S.FIELD_MAP[key];
    if (def) return def.label;
    const cf = (state.settings.customFields || []).find((c) => c.key === key);
    if (cf) return cf.label || key;
    // 区块子字段的 key 形如 internship.company
    const dot = String(key).indexOf('.');
    if (dot > 0 && S.LIST_MAP) {
      const list = S.LIST_MAP[key.slice(0, dot)];
      const item = list && list.fields.find((f) => f.key === key.slice(dot + 1));
      if (list && item) return list.label + ' · ' + item.label;
    }
    return key;
  }

  async function loadAll() {
    const data = await storageGet([STORAGE_KEYS.settings, STORAGE_KEYS.profiles, STORAGE_KEYS.resume, STORAGE_KEYS.photo]);
    state.settings = Object.assign({}, S.DEFAULT_SETTINGS, data[STORAGE_KEYS.settings] || {});
    state.resumeFile = data[STORAGE_KEYS.resume] || null;
    state.photoFile = data[STORAGE_KEYS.photo] || null;
    let profiles = data[STORAGE_KEYS.profiles];
    if (!Array.isArray(profiles) || !profiles.length) {
      profiles = [JSON.parse(JSON.stringify(S.DEFAULT_PROFILE))];
      await storageSet({ [STORAGE_KEYS.profiles]: profiles });
    }
    state.profiles = profiles;
    state.profile = profiles.find((p) => p.id === state.settings.activeProfileId) || profiles[0];
    state.index = M.buildIndex(effectiveFields());
  }

  /* ========================= 站点规则（记忆映射） ========================= */

  function hostKey() {
    return location.hostname || '';
  }

  function siteRules() {
    const all = state.settings.siteRules || {};
    return all[hostKey()] || [];
  }

  function saveRule(selector, fieldKey) {
    if (!selector || !fieldKey) return;
    const all = state.settings.siteRules || {};
    const list = (all[hostKey()] || []).filter((r) => r.selector !== selector);
    list.push({ selector: selector, fieldKey: fieldKey, at: Date.now() });
    all[hostKey()] = list.slice(-200);
    state.settings.siteRules = all;
    storageSet({ [STORAGE_KEYS.settings]: state.settings });
  }

  function findRuleFor(el) {
    const rules = siteRules();
    if (!rules.length) return null;
    const directPath = cssPath(el);
    for (let i = rules.length - 1; i >= 0; i--) {
      if (rules[i].selector === directPath) return rules[i];
    }
    for (let i = rules.length - 1; i >= 0; i--) {
      try { if (el.matches && el.matches(rules[i].selector)) return rules[i]; } catch (e) { /* 非法选择器 */ }
    }
    return null;
  }

  /* ============================== 扫描 ============================== */

  /* 自绘下拉的类名。phoenix-* 是北森自家的设计系统（zhiye.com / 北森校招那套），
     ux-* / itl-* 是北森老版门户，一并覆盖。 */
  const CLASS_SELECT_SELECTOR = [
    '.ant-select', '.el-select', '.ivu-select', '.semi-select', '.next-select', '.arco-select',
    '.phoenix-select', '.phoenix-select-v2', '.phoenix-cascader', '.phoenix-tree-select',
    '.phoenix-date-picker', '.phoenix-time-picker', '.phoenix-picker', '.phoenix-selector',
    '.ux-select', '.ux-cascader', '.beisen-select'
  ].join(',');
  const CUSTOM_SELECT_SELECTOR = CLASS_SELECT_SELECTOR + ',[role="combobox"]';
  const DROPDOWN_OPTION_SELECTOR = [
    '.ant-select-dropdown .ant-select-item-option',
    '.ant-select-dropdown .ant-select-item',
    '.el-select-dropdown__item',
    '.el-select-dropdown .el-option',
    '.ivu-select-dropdown .ivu-select-item',
    '.semi-select-option',
    '.next-menu-item',
    '.arco-select-option',
    '.phoenix-select-dropdown [role="option"]',
    '.phoenix-select-dropdown li',
    '.phoenix-select-option',
    '.phoenix-select__option',
    '.phoenix-cascader-menu-item',
    '.phoenix-picker-panel li',
    '.phoenix-dropdown-menu-item',
    '[role="listbox"] [role="option"]',
    '[role="option"]'
  ].join(',');

  function countFillableControls() {
    let n = 0;
    const nodes = document.querySelectorAll('input,select,textarea');
    for (let i = 0; i < nodes.length; i++) {
      if (M.isCandidate(nodes[i], { allowFile: false })) n++;
    }
    return n;
  }

  function scannerRoots() {
    // 极少数站点把表单放在 open shadow root 里，这里一并覆盖
    const roots = [document];
    const hosts = document.querySelectorAll('*');
    for (let i = 0, n = Math.min(hosts.length, 4000); i < n; i++) {
      if (hosts[i].shadowRoot) roots.push(hosts[i].shadowRoot);
    }
    return roots;
  }

  function scanNativeControls() {
    const out = [];
    const roots = scannerRoots();
    for (const root of roots) {
      let nodes;
      try { nodes = root.querySelectorAll('input,select,textarea'); } catch (e) { continue; }
      for (let i = 0; i < nodes.length; i++) {
        const el = nodes[i];
        // 类名型自定义下拉内部的隐藏 input 交给 scanCustomSelects 处理
        if (el.closest && el.closest(CLASS_SELECT_SELECTOR)) continue;
        if (!M.isCandidate(el, { allowFile: state.settings.fillFileInput })) continue;
        out.push(el);
      }
    }
    return out;
  }

  function scanCustomSelects() {
    const out = [];
    let nodes;
    try { nodes = document.querySelectorAll(CUSTOM_SELECT_SELECTOR); } catch (e) { return out; }
    for (let i = 0; i < nodes.length; i++) {
      const w = nodes[i];
      // 原生控件不当作自定义下拉，避免同一个字段被处理两次
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(w.tagName)) continue;
      if (w.closest('.ant-select-dropdown,.el-select-dropdown,.ivu-select-dropdown,.semi-select-dropdown')) continue;
      // 只保留最外层包装
      if (w.parentElement && w.parentElement.closest(CLASS_SELECT_SELECTOR)) continue;
      if (w.closest('[data-nrfa-ui]')) continue;
      if (!M.isVisible(w)) continue;
      out.push(w);
    }
    return out;
  }

  /* ============================== 取值判断 ============================== */

  function currentValueOf(el) {
    if (!el) return '';
    if (el.tagName === 'SELECT') {
      const opt = el.options && el.options[el.selectedIndex];
      if (!opt) return '';
      const t = (opt.textContent || '').trim();
      if (opt.value === '' && /请选择|请选取|--|^$/.test(t)) return '';
      return t || opt.value || '';
    }
    return String(el.value == null ? '' : el.value).trim();
  }

  function selectDisplayValue(wrapper) {
    const sel = '.ant-select-selection-item,.ant-select-selection-selected-value,.el-select__selected-item,' +
      '.el-select__placeholder,.el-input__inner,.ivu-select-selected-value,.semi-select-selection-text,' +
      '.next-select-values,.arco-select-view-value';
    const node = wrapper.querySelector(sel);
    if (node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) return String(node.value || '').trim();
    if (node) return textOf(node);
    return '';
  }

  /** 该控件是否已经有用户内容（配合"只填空白字段"使用） */
  function entryHasUserValue(entry) {
    if (entry.kind === 'radio') {
      return !!(entry.group && entry.group.radios.some((r) => r.checked));
    }
    return hasUserValue(entry.el, entry.kind);
  }

  function hasUserValue(el, kind) {
    if (kind === 'customSelect') {
      const v = selectDisplayValue(el);
      return !!v && !/请选择|请选取|^$/.test(v);
    }
    if (kind === 'file') return !!(el.files && el.files.length);
    if (kind === 'radio') return false;
    return currentValueOf(el) !== '';
  }

  /* ============================== 生成计划 ============================== */

  /**
   * 生成一条填充计划。这里只记录「哪个控件命中了哪个字段」，
   * 具体填什么值留到 resolveEntry 统一算 —— 因为可重复区块要等
   * 全部控件匹配完、按 DOM 顺序分配完序号之后才知道该取第几条数据。
   */
  function makeEntry(kind, el, hit, extra) {
    const field = hit.field || {};
    return Object.assign({
      kind: kind,
      el: el,
      field: field,
      fieldKey: hit.fieldKey,
      listKey: field.listKey || null,
      itemKey: field.itemKey || null,
      instanceIndex: 0,
      label: fieldLabel(hit.fieldKey),
      matchedBy: hit.source,
      score: Math.round(hit.score),
      rawValue: '',
      value: '',
      include: true,
      status: 'pending',
      reason: ''
    }, extra || {});
  }

  /**
   * 给可重复区块的控件分配序号。
   * 规则很直白：同一个字段在一页上第 N 次出现，就取档案里第 N 条记录。
   * 遍历用一次 querySelectorAll（含自绘下拉容器），它天然返回文档顺序，
   * 所以「第几个」就等于「页面上从上到下第几个」。
   */
  function assignListIndices(plan) {
    const byEl = new Map();
    plan.forEach((e) => { if (e.listKey) byEl.set(e.el, e); });
    if (!byEl.size) return;

    /* 1. 按文档顺序编号：querySelectorAll 天然返回文档顺序（含自绘下拉容器） */
    const counters = {};
    const seen = new Set();
    let nodes = [];
    try {
      nodes = document.querySelectorAll('input,select,textarea,' + CUSTOM_SELECT_SELECTOR);
    } catch (e) {
      nodes = document.querySelectorAll('input,select,textarea');
    }
    for (let i = 0; i < nodes.length; i++) {
      const entry = byEl.get(nodes[i]);
      if (!entry) continue;
      const k = entry.listKey + '.' + entry.itemKey;
      entry.instanceIndex = counters[k] || 0;
      counters[k] = entry.instanceIndex + 1;
      seen.add(entry);
    }

    /* 2. 兜底：没被上面遍历到的（例如藏在 Shadow DOM 或模板克隆里的），按插入顺序续号 */
    const fallback = {};
    plan.forEach((e) => {
      if (!e.listKey || seen.has(e)) return;
      const k = e.listKey + '.' + e.itemKey;
      const idx = fallback[k] === undefined ? (counters[k] || 0) : fallback[k];
      e.instanceIndex = idx;
      fallback[k] = idx + 1;
      counters[k] = idx + 1;
    });

    /* 3. 把序号写进标签，并标出哪些超出了档案里的记录条数 */
    plan.forEach((e) => {
      if (!e.listKey) return;
      const total = listCount(e.listKey);
      const listLabel = (S.LIST_MAP && S.LIST_MAP[e.listKey]) ? S.LIST_MAP[e.listKey].label : '';
      e.label = fieldLabel(e.fieldKey) +
        '（' + listLabel + ' 第 ' + (e.instanceIndex + 1) + ' 条' +
        (total ? '，档案共 ' + total + ' 条' : '') + '）';
      e.outOfRange = e.instanceIndex >= total;
    });
  }

  /** 阶段三：算出每个控件到底要填什么值 */
  function resolveEntry(entry) {
    const el = entry.el;

    /* --- 文件类：值来自「简历附件 / 证件照」两个独立存储槽 --- */
    if (entry.kind === 'file') {
      const isPhoto = entry.fieldKey === 'photoFile';
      const f = isPhoto ? state.photoFile : state.resumeFile;
      if (f && f.name) {
        entry.status = 'pending';
        entry.include = true;
        entry.value = f.name;
        entry.rawValue = f.name;
        entry.reason = '';
      } else {
        entry.status = 'nodata';
        entry.include = false;
        entry.reason = isPhoto ? '尚未在设置页选择证件照' : '尚未在设置页选择简历文件';
      }
      return;
    }

    /* --- 取值：区块字段按序号取，扁平字段直接取 --- */
    const raw = entry.listKey
      ? valueOfListItem(entry.listKey, entry.instanceIndex, entry.itemKey)
      : valueOf(entry.fieldKey);
    entry.rawValue = (raw === null || raw === undefined) ? '' : raw;

    if (entry.outOfRange) {
      entry.status = 'nodata';
      entry.include = false;
      entry.reason = '档案里没有第 ' + (entry.instanceIndex + 1) + ' 条' +
        (S.LIST_MAP && S.LIST_MAP[entry.listKey] ? S.LIST_MAP[entry.listKey].label : '') + '记录';
      return;
    }
    if (entry.rawValue === '') {
      entry.status = 'nodata';
      entry.include = false;
      entry.reason = entry.listKey ? '这条记录里该字段为空' : '档案中该字段为空';
      return;
    }

    /* --- 按控件类型换算成可直接写入的值 --- */
    if (entry.kind === 'radio') {
      const g = entry.group;
      if (!g) { entry.status = 'failed'; entry.reason = '找不到选项组'; entry.include = false; return; }
      const texts = g.radios.map((r) => M.optionLabelOf(r));
      const picked = M.chooseOption(entry.rawValue, texts);
      if (!picked) {
        entry.status = 'nomatch';
        entry.reason = '没有「' + truncate(entry.rawValue, 12) + '」这个选项';
        entry.include = false;
      } else {
        entry.value = picked;
        entry.targetRadio = g.radios[texts.indexOf(picked)];
      }
      return;
    }

    if (entry.kind === 'select') {
      const opts = Array.prototype.map.call(el.options, (o) => (o.textContent || '').trim());
      const picked = M.chooseOption(entry.rawValue, opts);
      if (!picked) {
        entry.status = 'nomatch';
        entry.reason = '下拉里没有匹配的选项';
        entry.include = false;
      } else {
        entry.value = picked;
        entry.targetIndex = opts.indexOf(picked);
      }
      return;
    }

    if (entry.kind === 'customSelect') {
      entry.value = String(entry.rawValue);
      return;
    }

    /* --- 文本类：按控件要求改写日期格式，并按 maxlength 截断 --- */
    entry.value = M.formatValue(entry.rawValue, el, entry.field);
    if (el.getAttribute && el.getAttribute('maxlength')) {
      const max = parseInt(el.getAttribute('maxlength'), 10);
      if (!isNaN(max) && max > 0 && entry.value.length > max) {
        entry.value = entry.value.slice(0, max);
        entry.reason = '已按 maxlength=' + max + ' 截断';
      }
    }
  }

  async function buildPlan() {
    const plan = [];
    const handledRadioGroups = [];

    /* ---------------- 阶段一：匹配控件 ---------------- */
    const natives = scanNativeControls();
    for (const el of natives) {
      const itype = (el.getAttribute('type') || 'text').toLowerCase();

      if (itype === 'file') {
        if (!state.settings.fillFileInput) continue;
        const hit = M.matchElement(el, { index: state.index, threshold: state.settings.matchThreshold, allowFile: true });
        if (!hit) continue;
        plan.push(makeEntry('file', el, hit));
        continue;
      }

      if (itype === 'radio') {
        const g = M.radioGroupOf(el);
        if (!g) continue;
        if (handledRadioGroups.indexOf(g.radios[0]) !== -1) continue;
        handledRadioGroups.push(g.radios[0]);
        const hit = M.matchElement(el, { index: state.index, threshold: state.settings.matchThreshold });
        if (!hit) continue;
        plan.push(makeEntry('radio', el, hit, { group: g }));
        continue;
      }

      if (itype === 'checkbox') continue;   // 复选框语义太不明确，不自动勾

      /* 站点规则优先于自动识别 */
      let hit = null;
      const rule = findRuleFor(el);
      if (rule) {
        const rf = S.FIELD_MAP[rule.fieldKey] ||
          (S.listItemFields ? S.listItemFields().find((f) => f.key === rule.fieldKey) : null);
        if (rf) hit = { fieldKey: rule.fieldKey, field: rf, score: 999, source: 'site-rule' };
      }
      if (!hit) {
        hit = M.matchElement(el, { index: state.index, threshold: state.settings.matchThreshold });
      }
      if (!hit) continue;

      plan.push(makeEntry(el.tagName === 'SELECT' ? 'select' : 'text', el, hit));
    }

    /* ---------------- 自定义下拉（Ant Design / Element UI / iView / Semi / Arco） ---------------- */
    const customs = scanCustomSelects();
    for (const w of customs) {
      const cls = w.className || '';
      if (/pagination|page-size|search-select-filter/i.test(cls)) continue;
      const hit = M.matchElement(w, { index: state.index, threshold: state.settings.matchThreshold });
      if (!hit) continue;
      plan.push(makeEntry('customSelect', w, hit, { display: selectDisplayValue(w) }));
    }

    /* ---------------- 阶段二 / 三：分配区块序号 → 解析取值 ---------------- */
    assignListIndices(plan);
    plan.forEach(resolveEntry);

    return plan;
  }

  /* ============================== 写值 ============================== */

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireEvents(el) {
    if (!state.settings.triggerEvents) return;
    const win = el.ownerDocument.defaultView || window;
    try { el.dispatchEvent(new win.Event('input', { bubbles: true })); } catch (e) { /* ignore */ }
    try { el.dispatchEvent(new win.Event('change', { bubbles: true })); } catch (e) { /* ignore */ }
    try {
      el.dispatchEvent(new win.KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified', keyCode: 0 }));
    } catch (e) { /* ignore */ }
  }

  function highlight(el, cls) {
    if (!state.settings.highlightFilled || !el || el.nodeType !== 1) return;
    try {
      el.classList.add(cls || 'nrfa-filled');
      el.classList.add('nrfa-filled-pulse');
      setTimeout(() => { try { el.classList.remove('nrfa-filled-pulse'); } catch (e) { /* ignore */ } }, 1100);
    } catch (e) { /* 某些元素 classList 只读 */ }
  }

  function fillText(entry) {
    const el = entry.el;
    const prev = currentValueOf(el);
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    setNativeValue(el, entry.value);
    fireEvents(el);
    try { el.blur(); } catch (e) { /* ignore */ }
    if (currentValueOf(el) !== entry.value) {
      return { ok: false, reason: '页面拒绝写入（可能是只读或自绘控件）' };
    }
    highlight(el);
    return { ok: true, undo: { kind: 'value', el: el, prev: prev } };
  }

  function fillSelect(entry) {
    const el = entry.el;
    const prev = el.value;
    const opt = el.options[entry.targetIndex];
    if (!opt) return { ok: false, reason: '找不到目标选项' };
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    try {
      el.selectedIndex = entry.targetIndex;
    } catch (e) { /* ignore */ }
    setNativeValue(el, opt.value);
    fireEvents(el);
    if ((opt.textContent || '').trim() !== entry.value) {
      // 有些站点用 index 而非 value 驱动
      el.selectedIndex = entry.targetIndex;
      fireEvents(el);
    }
    const now = currentValueOf(el);
    if (M.chooseOption(entry.value, [now]) === null && now !== entry.value) {
      return { ok: false, reason: '下拉写入未生效' };
    }
    highlight(el);
    return { ok: true, undo: { kind: 'value', el: el, prev: prev } };
  }

  function fillRadio(entry) {
    const target = entry.targetRadio;
    if (!target) return { ok: false, reason: '找不到对应选项' };
    const prev = entry.group.radios.map((r) => ({ el: r, checked: r.checked }));
    try { target.click(); } catch (e) { /* ignore */ }
    if (!target.checked) {
      try {
        target.checked = true;
        fireEvents(target);
      } catch (e) { /* ignore */ }
    }
    if (!target.checked) return { ok: false, reason: '单选未选中' };
    highlight(target);
    return { ok: true, undo: { kind: 'radios', items: prev } };
  }

  async function waitForOptions(timeout) {
    const deadline = Date.now() + (timeout || 1500);
    while (Date.now() < deadline) {
      const opts = document.querySelectorAll(DROPDOWN_OPTION_SELECTOR);
      const visible = Array.prototype.filter.call(opts, (o) => M.isVisible(o) && textOf(o));
      if (visible.length) return visible;
      await sleep(60);
    }
    return [];
  }

  function clickLike(el) {
    const win = el.ownerDocument.defaultView || window;
    ['mousedown', 'mouseup', 'click'].forEach((type) => {
      try {
        el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, view: win, button: 0 }));
      } catch (e) { /* ignore */ }
    });
  }

  async function fillCustomSelect(entry) {
    const wrapper = entry.el;
    const want = entry.value;
    const before = selectDisplayValue(wrapper);
    if (before && M.chooseOption(want, [before])) {
      return { ok: true, undo: null };
    }

    const clickable = wrapper.querySelector('input:not([type=hidden]),.ant-select-selector,.el-input__wrapper,.ivu-select-selection,.semi-select-selection,.arco-select-view') || wrapper;
    clickLike(clickable);

    let options = await waitForOptions(1500);
    if (!options.length) {
      clickLike(wrapper);
      options = await waitForOptions(1200);
    }
    if (!options.length) return { ok: false, reason: '下拉未展开（该组件可能不是标准实现）' };

    const texts = options.map((o) => textOf(o));
    const picked = M.chooseOption(want, texts);
    if (!picked) {
      try { document.body.click(); } catch (e) { /* ignore */ }
      return { ok: false, reason: '下拉里没有匹配选项' };
    }
    const target = options[texts.indexOf(picked)];
    clickLike(target);
    await sleep(120);
    const after = selectDisplayValue(wrapper);
    if (after && M.chooseOption(want, [after])) {
      highlight(wrapper);
      return { ok: true, undo: null };
    }
    return { ok: false, reason: '已点击选项但组件未更新（可手动确认一次）' };
  }

  async function fillFile(entry) {
    const input = entry.el;
    const isPhoto = entry.fieldKey === 'photoFile';
    const f = isPhoto ? state.photoFile : state.resumeFile;
    const what = isPhoto ? '证件照' : '简历文件';
    if (!f || !f.dataUrl) return { ok: false, reason: '尚未在设置页选择' + what };
    try {
      const res = await fetch(f.dataUrl);
      const blob = await res.blob();
      const file = new File([blob], f.name, { type: f.type || blob.type || 'application/octet-stream' });
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      if (!input.files || !input.files.length) {
        return { ok: false, reason: '文件已构造但页面未接收，请手动选择一次' };
      }
      highlight(input);
      return { ok: true, undo: null };
    } catch (e) {
      return { ok: false, reason: '挂载' + what + '失败：' + (e && e.message ? e.message : e) };
    }
  }

  /**
   * 通用「点开再选」兜底：很多企业级组件库（北森 phoenix、各类自绘 Select）
   * 用一个 readonly 的 input 显示选中值，直接写 value 是无效的，必须先点开弹出层，
   * 再点里面的选项。这个函数不依赖具体类名，靠 role=option / li 等通用特征找选项。
   */
  async function pickFromPopup(el, want) {
    clickLike(el);
    let options = await waitForOptions(1500);
    if (!options.length) {
      // 有些组件要点外层容器才展开
      const wrap = (el.closest && el.closest(CLASS_SELECT_SELECTOR)) || el.parentElement || el;
      if (wrap !== el) clickLike(wrap);
      options = await waitForOptions(1200);
    }
    if (!options.length) return { ok: false, reason: '点开后没有出现选项列表（可能不是下拉控件）' };

    const texts = options.map((o) => textOf(o));
    const picked = M.chooseOption(want, texts);
    if (!picked) {
      try { document.body.click(); } catch (e) { /* ignore */ }
      return { ok: false, reason: '弹出的选项里没有「' + truncate(want, 12) + '」' };
    }
    clickLike(options[texts.indexOf(picked)]);
    await sleep(140);

    const after = currentValueOf(el);
    if (after && M.chooseOption(want, [after])) {
      highlight(el);
      return { ok: true, undo: null };
    }
    // 值没写进 input，但看起来是被选中的（部分组件把文本画在别的节点上）
    if (selectDisplayValue(el.parentElement || el) &&
        M.chooseOption(want, [selectDisplayValue(el.parentElement || el)])) {
      highlight(el);
      return { ok: true, undo: null };
    }
    return { ok: false, reason: '已点选但控件值未更新' };
  }

  async function applyEntry(entry) {
    try {
      if (entry.kind === 'text') {
        // 只读输入框几乎一定是自绘下拉，直接走「点开再选」
        if (entry.el.readOnly) {
          const picked = await pickFromPopup(entry.el, entry.value);
          if (picked.ok) return picked;
          return { ok: false, reason: '只读控件：' + (picked.reason || '无法写入') };
        }
        const r = fillText(entry);
        if (r.ok) return r;
        // 普通写入失败（页面拒绝）也再试一次点选兜底
        const fallback = await pickFromPopup(entry.el, entry.value);
        return fallback.ok ? fallback : r;
      }
      if (entry.kind === 'select') return fillSelect(entry);
      if (entry.kind === 'radio') return fillRadio(entry);
      if (entry.kind === 'customSelect') return await fillCustomSelect(entry);
      if (entry.kind === 'file') return await fillFile(entry);
    } catch (e) {
      return { ok: false, reason: '写入异常：' + (e && e.message ? e.message : e) };
    }
    return { ok: false, reason: '未知控件类型' };
  }

  async function runPlan(onlyIncluded) {
    if (state.busy) return { ok: false, reason: '正在填充中' };
    state.busy = true;
    const undoStack = [];
    const stat = { filled: 0, skipped: 0, failed: 0, nodata: 0 };

    for (const entry of state.plan) {
      if (onlyIncluded !== false && !entry.include) {
        if (entry.status === 'nodata') stat.nodata++;
        else stat.skipped++;
        continue;
      }
      if (entry.status === 'nodata') { stat.nodata++; continue; }

      if (state.settings.fillEmptyOnly && entryHasUserValue(entry)) {
        entry.status = 'skipped';
        entry.reason = '已有内容，按设置跳过';
        stat.skipped++;
        continue;
      }

      const r = await applyEntry(entry);
      if (r.ok) {
        entry.status = 'filled';
        stat.filled++;
        if (r.undo) undoStack.push(r.undo);
      } else {
        entry.status = 'failed';
        entry.reason = r.reason || '失败';
        stat.failed++;
      }
    }

    state.undo = undoStack.length ? { stack: undoStack, at: Date.now() } : null;
    state.settings.lastFillAt = Date.now();
    storageSet({ [STORAGE_KEYS.settings]: state.settings });
    state.busy = false;
    return { ok: true, stat: stat, plan: summarizePlan() };
  }

  function undoLast() {
    if (!state.undo || !state.undo.stack.length) return { ok: false, reason: '没有可撤销的操作' };
    let n = 0;
    for (const item of state.undo.stack.slice().reverse()) {
      try {
        if (item.kind === 'value') {
          setNativeValue(item.el, item.prev);
          fireEvents(item.el);
          n++;
        } else if (item.kind === 'radios') {
          item.items.forEach((it) => {
            it.el.checked = it.checked;
            fireEvents(it.el);
          });
          n++;
        }
        item.el && item.el.classList && item.el.classList.remove('nrfa-filled');
      } catch (e) { /* ignore */ }
    }
    state.undo = null;
    return { ok: true, restored: n };
  }

  function summarizePlan() {
    return state.plan.map((e) => ({
      label: e.label,
      value: truncate(e.value || e.rawValue, 60),
      kind: e.kind,
      status: e.status,
      reason: e.reason || '',
      include: e.include,
      score: e.score,
      matchedBy: e.matchedBy
    }));
  }

  /* ============================== 界面 ============================== */

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
    .wrap { position: fixed; right: 18px; bottom: 18px; z-index: 2147483647; }
    .fab {
      width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
      background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff;
      font-size: 15px; font-weight: 700; letter-spacing: 0.5px;
      box-shadow: 0 6px 20px rgba(37, 99, 235, 0.45);
      display: flex; align-items: center; justify-content: center;
      transition: transform 0.15s ease, box-shadow 0.15s ease;
    }
    .fab:hover { transform: translateY(-2px) scale(1.04); box-shadow: 0 10px 26px rgba(37, 99, 235, 0.55); }
    .badge {
      position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; padding: 0 4px;
      border-radius: 9px; background: #16a34a; color: #fff; font-size: 11px; line-height: 18px;
      text-align: center; font-weight: 600;
    }
    .panel {
      position: fixed; right: 18px; bottom: 78px; width: 360px; max-height: 62vh;
      background: #fff; color: #111827; border-radius: 14px; overflow: hidden;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28); border: 1px solid #e5e7eb;
      display: none; flex-direction: column;
    }
    .panel.open { display: flex; }
    .head { padding: 12px 14px; background: #f8fafc; border-bottom: 1px solid #e5e7eb; }
    .head h3 { margin: 0 0 4px; font-size: 14px; font-weight: 700; }
    .head p { margin: 0; font-size: 12px; color: #6b7280; }
    .list { overflow-y: auto; padding: 6px 0; flex: 1; }
    .row { display: flex; gap: 8px; padding: 7px 14px; align-items: flex-start; font-size: 12.5px; }
    .row:hover { background: #f9fafb; }
    .row input[type=checkbox] { margin-top: 3px; flex: none; }
    .info { flex: 1; min-width: 0; }
    .name { font-weight: 600; color: #111827; }
    .val { color: #374151; word-break: break-all; }
    .meta { color: #9ca3af; font-size: 11px; margin-top: 2px; }
    .tag { display: inline-block; padding: 1px 6px; border-radius: 6px; font-size: 10.5px; margin-left: 4px; }
    .t-nodata { background: #f3f4f6; color: #6b7280; }
    .t-nomatch { background: #fef3c7; color: #92400e; }
    .t-failed { background: #fee2e2; color: #991b1b; }
    .t-filled { background: #dcfce7; color: #166534; }
    .t-skipped { background: #e0e7ff; color: #3730a3; }
    .foot { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid #e5e7eb; background: #f8fafc; }
    button.btn {
      flex: 1; padding: 8px 10px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff;
      color: #374151; font-size: 12.5px; cursor: pointer; font-weight: 600;
    }
    button.btn:hover { background: #f3f4f6; }
    button.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    button.primary:hover { background: #1d4ed8; }
    button.primary:disabled { background: #93c5fd; border-color: #93c5fd; cursor: not-allowed; }
    .empty { padding: 22px 16px; text-align: center; color: #6b7280; font-size: 12.5px; }
    .link { color: #2563eb; cursor: pointer; text-decoration: underline; }
    .tip { font-size: 11px; color: #9ca3af; padding: 0 14px 8px; }
  `;

  function ensureUI() {
    if (state.ui) return state.ui;
    if (!IS_TOP) return null;          // iframe 里不画悬浮球
    if (!document.documentElement) return null;

    const host = document.createElement('div');
    host.setAttribute('data-nrfa-ui', '1');
    host.style.cssText = 'all: initial; position: static;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>${SHADOW_CSS}</style>
      <div class="wrap">
        <button class="fab" part="fab" title="网申助手：点击查看识别到的字段">填<span class="badge" style="display:none">0</span></button>
        <div class="panel">
          <div class="head">
            <h3>网申助手</h3>
            <p class="summary">正在扫描…</p>
          </div>
          <div class="list"></div>
          <div class="foot">
            <button class="btn undo" style="display:none">撤销</button>
            <button class="btn close">关闭</button>
            <button class="btn primary fill">一键填充</button>
          </div>
        </div>
      </div>`;
    document.documentElement.appendChild(host);

    const ui = {
      host: host,
      shadow: shadow,
      fab: shadow.querySelector('.fab'),
      badge: shadow.querySelector('.badge'),
      panel: shadow.querySelector('.panel'),
      summary: shadow.querySelector('.summary'),
      list: shadow.querySelector('.list'),
      fillBtn: shadow.querySelector('.fill'),
      closeBtn: shadow.querySelector('.close'),
      undoBtn: shadow.querySelector('.undo')
    };
    state.ui = ui;

    ui.fab.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
    ui.closeBtn.addEventListener('click', () => ui.panel.classList.remove('open'));
    ui.undoBtn.addEventListener('click', () => {
      const r = undoLast();
      renderPlan(r.ok ? `已撤销 ${r.restored} 项` : r.reason);
    });
    ui.fillBtn.addEventListener('click', async () => {
      ui.fillBtn.disabled = true;
      ui.fillBtn.textContent = '填充中…';
      const r = await runPlan(true);
      ui.fillBtn.disabled = false;
      ui.fillBtn.textContent = '一键填充';
      if (r.ok) {
        renderPlan(`已填充 ${r.stat.filled} 项` +
          (r.stat.failed ? `，${r.stat.failed} 项失败` : '') +
          (r.stat.skipped ? `，跳过 ${r.stat.skipped} 项` : ''));
      } else {
        renderPlan(r.reason);
      }
    });

    // 面板内阻止事件冒泡到页面，避免站点快捷键被触发
    ui.panel.addEventListener('keydown', (e) => e.stopPropagation());
    ui.panel.addEventListener('click', (e) => e.stopPropagation());

    return ui;
  }

  function renderPlan(notice) {
    const ui = state.ui;
    if (!ui) return;
    const list = ui.list;

    const willFill = state.plan.filter((e) => e.include && e.status !== 'nodata');
    ui.fillBtn.disabled = willFill.length === 0;
    ui.fillBtn.textContent = willFill.length ? `一键填充（${willFill.length}）` : '无可填字段';
    ui.undoBtn.style.display = (state.undo && state.undo.stack.length) ? '' : 'none';

    let html = '';
    if (notice) html += `<div class="tip">${escapeHtml(notice)}</div>`;

    if (!state.plan.length) {
      html += `<div class="empty">这个页面没识别到可填写的表单字段。<br>若是点击后弹出的表单，请先打开表单再点我。</div>`;
      list.innerHTML = html;
      ui.summary.textContent = '未识别到字段';
      return;
    }

    const statusTag = (e) => {
      if (e.status === 'nodata') return '<span class="tag t-nodata">档案为空</span>';
      if (e.status === 'nomatch') return '<span class="tag t-nomatch">选项不匹配</span>';
      if (e.status === 'failed') return '<span class="tag t-failed">失败</span>';
      if (e.status === 'filled') return '<span class="tag t-filled">已填</span>';
      if (e.status === 'skipped') return '<span class="tag t-skipped">跳过</span>';
      return '';
    };

    state.plan.forEach((e, i) => {
      const valueText = e.value || e.rawValue || '';
      html += `
        <div class="row">
          <input type="checkbox" data-i="${i}" ${e.include ? 'checked' : ''} ${e.status === 'nodata' ? 'disabled' : ''}>
          <div class="info">
            <div class="name">${escapeHtml(e.label)}${statusTag(e)}</div>
            <div class="val">${escapeHtml(truncate(valueText, 70))}</div>
            <div class="meta">${escapeHtml(KIND_LABELS[e.kind] || e.kind)} · 命中「${escapeHtml(sourceLabel(e.matchedBy))}」· 置信 ${e.score}${e.reason ? ' · ' + escapeHtml(e.reason) : ''}</div>
          </div>
        </div>`;
    });
    list.innerHTML = html;

    list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const e = state.plan[Number(cb.dataset.i)];
        if (e) e.include = cb.checked;
        renderPlan();
      });
    });

    const counts = state.plan.reduce((acc, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {});
    ui.summary.textContent = `识别 ${state.plan.length} 项`
      + (counts.pending || counts.filled ? ` · 待填 ${state.plan.filter((x) => x.status === 'pending' && x.include).length}` : '')
      + (counts.failed ? ` · 失败 ${counts.failed}` : '')
      + (counts.nodata ? ` · 档案为空 ${counts.nodata}` : '');
  }

  async function togglePanel() {
    const ui = ensureUI();
    if (!ui) return;
    if (ui.panel.classList.contains('open')) {
      ui.panel.classList.remove('open');
      return;
    }
    ui.panel.classList.add('open');
    ui.summary.textContent = '正在扫描…';
    ui.list.innerHTML = '';
    await loadAll();
    state.plan = await buildPlan();
    renderPlan();
  }

  function setBadge(n) {
    const ui = state.ui;
    if (!ui) return;
    if (n > 0) {
      ui.badge.style.display = '';
      ui.badge.textContent = n > 99 ? '99+' : String(n);
    } else {
      ui.badge.style.display = 'none';
    }
  }

  function removeUI() {
    if (state.ui && state.ui.host && state.ui.host.parentNode) {
      state.ui.host.parentNode.removeChild(state.ui.host);
    }
    state.ui = null;
  }

  /* ============================== 悬浮球显隐 ============================== */

  const PAGE_KEYWORDS = /(简历|应聘|申请|网申|投递|招聘|职位|岗位|实习|校招|社招|表单|填写|个人信息|求职)/;

  function likelyFormPage() {
    const count = countFillableControls();
    if (count === 0) return { show: false, count: count };
    const head = (document.title || '') + ' ' + ((document.body && document.body.textContent) || '').slice(0, 4000);
    const kw = PAGE_KEYWORDS.test(head);
    let show = false;
    if (count >= 6) show = true;
    else if (count >= 4 && kw) show = true;
    else if (count >= 3 && kw && /(网申|应聘|简历|投递|申请)/.test(document.title || '')) show = true;
    return { show: show, count: count };
  }

  async function refreshFab() {
    if (!IS_TOP) return;               // 悬浮球只在顶层页面维护
    const mode = (state.settings && state.settings.fabMode) || 'auto';
    if (mode === 'never') { removeUI(); return; }
    if (mode === 'always') {
      const ui = ensureUI();
      if (ui) setBadge(countFillableControls());
      return;
    }
    const v = likelyFormPage();
    if (!v.show) { removeUI(); return; }
    await loadAll();
    const plan = await buildPlan();
    state.plan = plan;
    const usable = plan.filter((e) => e.include && e.status !== 'nodata' && e.status !== 'nomatch').length;
    if (!usable && !plan.length) { removeUI(); return; }
    ensureUI();
    setBadge(usable);
  }

  /* ============================== 自动填充 ============================== */

  async function maybeAutoFill() {
    await loadAll();
    if (!state.settings.autoFillOnLoad) return;
    const plan = await buildPlan();
    const usable = plan.filter((e) => e.include && e.status === 'pending');
    if (usable.length < 3) return;
    state.plan = plan;
    ensureUI();
    const r = await runPlan(true);
    if (r.ok && r.stat.filled) {
      setBadge(r.stat.filled);
      renderPlan(`已自动填充 ${r.stat.filled} 项`);
    }
  }

  /* ============================== 对外接口 ============================== */

  const api = {
    count: function () {
      const v = likelyFormPage();
      return v.count;
    },
    /** 不开面板的静默探测：返回控件数与识别结果数 */
    async probe() {
      await loadAll();
      const plan = await buildPlan();
      state.plan = plan;
      return {
        ok: true,
        controls: countFillableControls(),
        matched: plan.length,
        usable: plan.filter((e) => e.include && (e.status === 'pending' || e.status === 'filled')).length,
        nodata: plan.filter((e) => e.status === 'nodata').length,
        nomatch: plan.filter((e) => e.status === 'nomatch').length,
        hasUndo: !!(state.undo && state.undo.stack.length),
        profile: state.profile ? state.profile.name : ''
      };
    },
    async preview() {
      await togglePanel();
      const ui = state.ui;
      if (ui) ui.panel.classList.add('open');
      return { ok: true, count: state.plan.length };
    },
    async fill() {
      await loadAll();
      state.plan = await buildPlan();
      ensureUI();
      const r = await runPlan(true);
      renderPlan(r.ok ? `已填充 ${r.stat.filled} 项` : r.reason);
      setBadge(r.ok ? r.stat.filled : 0);
      return r;
    },
    undo: function () { return undoLast(); },
    async reload() {
      await loadAll();
      state.plan = state.plan.length ? await buildPlan() : [];
      renderPlan();
      return { ok: true };
    },
    remember(selector, fieldKey) { saveRule(selector, fieldKey); return { ok: true }; },
    path: function (el) { return cssPath(el); }
  };
  window.__NRFA__ = api;

  /* ============================== 启动 ============================== */

  (async function boot() {
    await loadAll();

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => { refreshFab(); maybeAutoFill(); }, { once: true });
    } else {
      await refreshFab();
      await maybeAutoFill();
    }

    // 单页应用：DOM 变化后重新评估悬浮球（防抖 + 控件数变化才重扫，避免拖慢页面）
    let timer = null;
    let lastControlCount = countFillableControls();
    try {
      const mo = new MutationObserver(() => {
        if (state.ui && state.ui.panel.classList.contains('open')) return;   // 面板打开时别打扰
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          let now = 0;
          try { now = document.querySelectorAll('input,select,textarea').length; } catch (e) { now = 0; }
          if (Math.abs(now - lastControlCount) < 2) return;
          lastControlCount = now;
          refreshFab().catch(() => { });
        }, 1200);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { /* ignore */ }
  })();
})();
