/**
 * 网申助手 · 字段识别引擎
 * ------------------------------------------------------------------
 * 设计要点：
 *  1. 归一化：全角转半角、去空白与标点、去"请输入/请选择/必填"等噪声词，
 *     这样 "姓 名："、"*姓名"、"请输入姓名" 都能归一到 "姓名"。
 *  2. 多来源取证：<label for>、包裹 label、aria-label、placeholder、
 *     表格 (th / 首列单元格)、dl>dt、唯一控件的祖先容器文本、前置兄弟节点、
 *     以及 name/id/class 兜底，每个来源带不同置信权重。
 *  3. 最长别名胜出：所有别名参与打分，score = 来源权重 + min(别名长度,10)*3，
 *     因此 "紧急联系人姓名" 一定赢过 "姓名"，避免填错人。
 *  4. avoid 硬排除：如 电话 字段遇到 "紧急联系人电话" 直接放弃匹配。
 *  5. 分区推断：向上找最近的标题（h1-h6 / legend / .title 等），
 *     推断 教育/实习/项目/求职意向 分区；分区不符的字段降权，
 *     解决 "开始时间/结束时间" 这类跨分区同名字段。
 *  6. 日期自适应：按控件 type / placeholder / maxlength 改写为 YYYY-MM-DD、
 *     YYYY-MM、YYYY年MM月 等格式。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NRFA_MATCHER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ============================== 归一化 ============================== */

  const NOISE_WORDS = [
    '请输入', '请填写', '请选择', '请上传', '请提供', '请补充', '请说明',
    '必填项', '非必填', '必填', '选填', 'required', 'optional',
    '格式要求', '格式为', '示例', '例如', '举例',
    '字符以内', '字以内', '个字符', '最多', '最少', '不超过', '不能超过'
  ];

  function toHalfWidth(str) {
    let out = '';
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code === 0x3000) out += '';
      else if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
      else out += str[i];
    }
    return out;
  }

  /** 把任意文本归一成可用于 includes 匹配的纯字符串 */
  function normalize(input) {
    if (input === null || input === undefined) return '';
    let s = toHalfWidth(String(input));
    s = s.toLowerCase();
    // 去掉所有非中英文数字字符（标点、空白、星号、括号全部消失）
    s = s.replace(/[^0-9a-z\u4e00-\u9fa5]+/g, '');
    for (let i = 0; i < NOISE_WORDS.length; i++) {
      const w = NOISE_WORDS[i];
      const nw = w.replace(/[^0-9a-z\u4e00-\u9fa5]+/g, '');
      if (nw && s.indexOf(nw) !== -1) s = s.split(nw).join('');
    }
    return s;
  }

  /* ============================ 元素可见性 ============================ */

  function isVisible(el, opts) {
    if (!el || el.nodeType !== 1) return false;
    if (opts && opts.ignoreVisibility) return true;
    if (el.hidden) return false;
    const style = el.ownerDocument && el.ownerDocument.defaultView
      ? el.ownerDocument.defaultView.getComputedStyle(el)
      : null;
    if (style) {
      if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      if (style.opacity === '0') return false;
    }
    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
    if (typeof el.getClientRects === 'function') {
      const rects = el.getClientRects();
      if (!rects || rects.length === 0) return false;
      const r = rects[0];
      if (r.width === 0 && r.height === 0) return false;
    }
    return true;
  }

  const SKIP_PATTERNS = /(search|搜索|查询|验证码|captcha|verifycode|checkcode|smscode|密码|password|passwd|短信|subscribe|订阅|newsletter)/i;
  const SKIP_TYPES = ['hidden', 'password', 'submit', 'button', 'reset', 'image', 'range', 'color', 'search', 'file'];

  /** 是否是一个值得考虑填充的控件 */
  function isCandidate(el, opts) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag !== 'input' && tag !== 'select' && tag !== 'textarea') return false;
    if (el.disabled) return false;
    if (el.closest && el.closest('[data-nrfa-ui]')) return false;
    // 跳过扩展自己注入到 Shadow DOM 里的元素
    const rootNode = el.getRootNode ? el.getRootNode() : null;
    if (rootNode && rootNode.host) return false;
    if (!isVisible(el, opts)) return false;

    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (tag === 'input' && type === 'file') {
      // 文件控件只在需要挂简历时才考虑
      return !!(opts && opts.allowFile);
    }
    if (tag === 'input' && SKIP_TYPES.indexOf(type) !== -1) return false;

    const sig = [el.getAttribute('name'), el.getAttribute('id'), el.getAttribute('placeholder'),
      el.getAttribute('class'), el.getAttribute('aria-label')].join(' ');
    if (SKIP_PATTERNS.test(sig)) return false;

    return true;
  }

  /* ========================== 取值来源（取证） ========================== */

  function ownTextOf(labelEl, excludeEl) {
    // label 的文本，剔除嵌套控件自身的文本
    let text = '';
    const walk = function (node) {
      if (node.nodeType === 3) { text += node.nodeValue; return; }
      if (node.nodeType !== 1) return;
      if (excludeEl && (node === excludeEl || (node.contains && excludeEl && node.contains(excludeEl) && node !== labelEl))) {
        // 跳过包含目标控件的子树
        if (!(node === labelEl)) return;
      }
      for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    };
    walk(labelEl);
    return text;
  }

  function labelForElement(el) {
    const doc = el.ownerDocument;
    if (!doc) return null;
    if (el.labels && el.labels.length) return el.labels[0];
    const id = el.getAttribute('id');
    if (id && doc.querySelector) {
      try {
        return doc.querySelector('label[for="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
      } catch (e) { /* 忽略非法选择器 */ }
    }
    return null;
  }

  function countControls(node) {
    if (!node.querySelectorAll) return 0;
    return node.querySelectorAll('input,select,textarea').length;
  }

  /** 取某个单选项自身的选项文本（"男" / "Female"） */
  function optionLabelOf(input) {
    const lab = input.closest ? input.closest('label') : null;
    if (lab) {
      const t = ownTextOf(lab, input).trim();
      if (t) return t;
    }
    const forLab = labelForElement(input);
    if (forLab && forLab !== lab) {
      const t = ownTextOf(forLab, input).trim();
      if (t) return t;
    }
    // 控件紧随其后的文本节点，如 <input type=radio>男
    let n = input.nextSibling;
    while (n) {
      if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim()) return n.nodeValue.trim();
      if (n.nodeType === 1) break;
      n = n.nextSibling;
    }
    return '';
  }

  /**
   * 找出单选/复选组的「问题容器」。
   * 规则：向上找到第一个「包含的控件个数恰好等于本组控件个数」的祖先，
   * 这样容器里只有这道题，把各选项文本剔除后剩下的就是题干（如 "性别 男 女" → "性别"）。
   * 找不到就返回 null，宁可识别不出也不猜错。
   */
  function radioGroupOf(el) {
    const type = (el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    if (type !== 'radio' && type !== 'checkbox') return null;
    const doc = el.ownerDocument;
    const name = el.getAttribute('name');
    let radios = null;

    if (name) {
      const all = doc.querySelectorAll('input[name="' + name + '"]');
      radios = Array.prototype.filter.call(all, function (r) {
        return (r.getAttribute('type') || '').toLowerCase() === type;
      });
    }
    if (!radios || radios.length < 2) {
      let node = el.parentElement;
      while (node) {
        const same = Array.prototype.filter.call(
          node.querySelectorAll('input'),
          function (r) { return (r.getAttribute('type') || '').toLowerCase() === type; }
        );
        if (same.length >= 2) { radios = same; break; }
        node = node.parentElement;
      }
    }
    if (!radios || radios.length < 2) return null;

    // 问题容器：控件个数恰好等于本组个数的最近祖先
    let container = null;
    let node2 = el.parentElement;
    while (node2) {
      const count = node2.querySelectorAll('input,select,textarea').length;
      if (count === radios.length) { container = node2; break; }
      node2 = node2.parentElement;
    }
    return {
      radios: Array.prototype.slice.call(radios),
      container: container
    };
  }

  function cellsOfRow(row) {
    const out = [];
    for (let i = 0; i < row.children.length; i++) {
      const c = row.children[i];
      if (c.tagName === 'TD' || c.tagName === 'TH') out.push(c);
    }
    return out;
  }

  /**
   * 收集一个控件的所有候选上下文文本
   * @returns {Array<{text:string, raw:string, source:string, weight:number}>}
   */
  function collectContext(el, opts) {
    opts = opts || {};
    const excludeTexts = (opts.excludeTexts || []).map(normalize).filter(Boolean);
    const picked = [];
    const seen = {};

    const push = function (raw, source, weight) {
      if (!raw) return;
      let text = String(raw);
      if (text.length > 120) text = text.slice(0, 120);
      for (let i = 0; i < excludeTexts.length; i++) {
        // 逐字符剔除选项文本（用于单选组：容器文本 "性别 男 女" → "性别"）
        if (excludeTexts[i]) {
          const norm = normalize(text);
          if (norm.indexOf(excludeTexts[i]) !== -1) {
            text = text.split(excludeTexts[i]).join(' ');
          }
        }
      }
      const n = normalize(text);
      if (!n || n.length > 60) return;
      const dedupeKey = source + '|' + n;
      if (seen[dedupeKey]) return;
      seen[dedupeKey] = 1;
      picked.push({ text: n, raw: String(raw).slice(0, 120), source: source, weight: weight });
    };

    /* 1. 显式 label */
    const lab = labelForElement(el);
    if (lab) push(ownTextOf(lab, el), 'label', 100);

    /* 2. 包裹型 label（排除自身选项文本，兼容单选） */
    const wrapLabel = el.closest ? el.closest('label') : null;
    if (wrapLabel && wrapLabel !== lab) {
      let t = ownTextOf(wrapLabel, el);
      push(t, 'label', 99);
    }

    /* 3. aria / title / data-* */
    push(el.getAttribute && el.getAttribute('aria-label'), 'aria', 90);
    push(el.getAttribute && el.getAttribute('title'), 'title', 86);
    if (el.getAttribute) {
      push(el.getAttribute('data-label') || el.getAttribute('data-name') ||
        el.getAttribute('data-title') || el.getAttribute('data-field'), 'data', 88);
    }

    /* 4. placeholder */
    push(el.getAttribute && el.getAttribute('placeholder'), 'placeholder', 84);

    /* 5. 表格布局（网申系统最常见） */
    if (el.closest) {
      const cell = el.closest('td,th');
      if (cell) {
        const row = cell.closest('tr');
        if (row) {
          const cells = cellsOfRow(row);
          const myIdx = cells.indexOf(cell);
          // 5a. 表头列（thead 或第一行 th）
          const table = row.closest('table');
          if (table) {
            const headRow = table.querySelector('thead tr') ||
              (table.rows && table.rows.length && table.rows[0] !== row && table.rows[0].querySelectorAll('th').length ? table.rows[0] : null);
            if (headRow && myIdx >= 0) {
              const headCells = cellsOfRow(headRow);
              if (headCells[myIdx]) push(headCells[myIdx].textContent, 'tableHead', 96);
            }
          }
          // 5b. 同行首列是标签列
          if (myIdx > 0 && cells[0]) push(cells[0].textContent, 'rowLabel', 95);
          // 5c. 同格内嵌标签（label 已在上面处理）
        }
      }

      /* 6. dl > dt */
      const dd = el.closest('dd');
      if (dd && dd.previousElementSibling && dd.previousElementSibling.tagName === 'DT') {
        push(dd.previousElementSibling.textContent, 'dt', 95);
      }
    }

    /* 7. 单选 / 复选组：用「剔除选项文本后的题干」作为上下文 */
    const group = radioGroupOf(el);
    if (group && group.container) {
      let gtext = group.container.textContent || '';
      group.radios.forEach(function (r) {
        const label = optionLabelOf(r);
        if (label) gtext = gtext.split(label).join(' ');
      });
      push(gtext, 'groupLabel', 93);
      const prev = group.container.previousElementSibling;
      if (prev && (!prev.querySelector || !prev.querySelector('input,select,textarea'))) {
        push(prev.textContent, 'groupPrev', 91);
      }
    }

    /* 8. 前置兄弟节点文本 */
    let sib = el.previousElementSibling;
    let sibCount = 0;
    while (sib && sibCount < 3) {
      if (!sib.querySelector || !sib.querySelector('input,select,textarea')) {
        push(sib.textContent, 'sibling', 82 - sibCount * 4);
      }
      sib = sib.previousElementSibling;
      sibCount++;
    }

    /* 9. 祖先容器文本：仅当该容器内只有当前一个控件时采用（避免串行误配） */
    let node = el.parentElement;
    let level = 0;
    while (node && level < 4) {
      if (countControls(node) === 1) {
        push(node.textContent, 'ancestor' + level, 80 - level * 5);
      }
      node = node.parentElement;
      level++;
    }

    /* 10. 属性兜底 */
    push(el.getAttribute && el.getAttribute('name'), 'name', 62);
    push(el.getAttribute && el.getAttribute('id'), 'id', 58);
    const cls = el.getAttribute && el.getAttribute('class');
    if (cls) push(cls, 'class', 44);

    return picked;
  }

  /* ============================== 分区推断 ============================== */

  const SECTION_RULES = [
    { section: 'edu', re: /(教育经历|教育背景|教育信息|学习经历|学历信息|学历背景|就读经历|教育情况)/ },
    { section: 'exp', re: /(实习经历|实习经验|工作经历|工作经验|职业经历|实习信息|工作信息|实践经历)/ },
    { section: 'project', re: /(项目经历|项目经验|项目信息|科研经历|项目情况)/ },
    { section: 'intent', re: /(求职意向|应聘意向|求职意愿|意向信息|岗位意向)/ },
    { section: 'basic', re: /(基本信息|个人信息|个人资料|基础信息|联系方式)/ }
  ];

  function sectionOfText(text) {
    const t = String(text || '').replace(/\s/g, '');
    if (!t || t.length > 40) return null;
    for (let i = 0; i < SECTION_RULES.length; i++) {
      if (SECTION_RULES[i].re.test(t)) return SECTION_RULES[i].section;
    }
    return null;
  }

  function isHeadingLike(el) {
    if (!el || !el.tagName) return false;
    if (/^H[1-6]$/.test(el.tagName)) return true;
    if (el.tagName === 'LEGEND' || el.tagName === 'CAPTION' || el.tagName === 'SUMMARY') return true;
    const cls = (el.getAttribute && (el.getAttribute('class') || '')) + ' ' +
      (el.getAttribute && (el.getAttribute('role') || ''));
    return /(title|heading|header|section|legend|subtitle|panel-head|card-head|group)/i.test(cls);
  }

  /** 向上寻找最近的、能识别出分区的标题文本 */
  function inferSection(el) {
    if (!el) return null;

    const fs = el.closest && el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) { const s = sectionOfText(lg.textContent); if (s) return s; }
    }

    let node = el;
    let level = 0;
    while (node && level < 6) {
      let sib = node.previousElementSibling;
      let guard = 0;
      while (sib && guard < 10) {
        const s = sectionOfText(sib.textContent);
        if (s) return s;
        // 标题类元素内容也可能就是分区名
        if (isHeadingLike(sib)) {
          const s2 = sectionOfText(sib.textContent);
          if (s2) return s2;
        }
        sib = sib.previousElementSibling;
        guard++;
      }
      // 父容器自身若带 title/heading 类名，取它自己的直接文本
      if (node.parentElement && isHeadingLike(node.parentElement)) {
        const s3 = sectionOfText(node.parentElement.textContent);
        if (s3) return s3;
      }
      node = node.parentElement;
      level++;
    }
    return null;
  }

  /* ============================== 匹配打分 ============================== */

  /**
   * 构建匹配索引：把字段别名归一化并缓存
   * 别名分三类：
   *   - 普通别名：正常权重
   *   - weakAliases：英文/极短通用词，扣 22 分，避免被 name/id/class 等弱来源误触发
   *   - ambiguousAliases：脱离分区就无法判断归属的别名（如裸的"开始时间"），
   *     在没有推断出分区时直接放弃匹配，宁可不填也不填错
   */
  function buildIndex(fields) {
    return fields.map(function (f) {
      const ambiguous = (f.ambiguousAliases || []).map(normalize);
      const list = [];
      const seen = {};
      const addAlias = function (raw, weak) {
        const a = normalize(raw);
        if (!a || a.length < 2 || seen[a]) return;
        seen[a] = 1;
        list.push({ a: a, weak: !!weak, ambiguous: ambiguous.indexOf(a) !== -1 });
      };
      (f.aliases || []).forEach(function (a) { addAlias(a, false); });
      (f.weakAliases || []).forEach(function (a) { addAlias(a, true); });
      return {
        field: f,
        key: f.key,
        aliases: list,
        avoids: (f.avoid || []).map(normalize).filter(Boolean),
        section: f.section || null,
        type: f.type || 'text'
      };
    });
  }

  function typeCompatible(field, el) {
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const it = (el.getAttribute && el.getAttribute('type') || 'text').toLowerCase();
    const ftype = field.type || 'text';

    // 文件类只与文件控件互配
    if (tag === 'input' && it === 'file') return ftype === 'file';
    if (ftype === 'file') return false;

    if (tag === 'input') {
      if (['hidden', 'password', 'submit', 'button', 'reset', 'image', 'checkbox', 'range', 'color', 'search'].indexOf(it) !== -1) return false;
      if (it === 'radio') return ftype === 'select' || ftype === 'radio';
      if (it === 'email') return ftype === 'email';
      return true;
    }
    // textarea 也能承载普通文本字段（很多网申把"现居住地/籍贯"做成多行框），
    // 只是长文本字段会拿到额外加分，优先胜出。
    if (tag === 'textarea') {
      return ftype !== 'file';
    }
    if (tag === 'select') return ftype === 'select' || ftype === 'text' || ftype === 'month' || ftype === 'date' || ftype === 'number';
    if (tag === 'div' || tag === 'span' || tag === 'a' || tag === 'button') return true;
    return false;
  }

  /**
   * 核心打分
   * @param {Array} ctx collectContext 的结果
   * @param {string|null} section inferSection 的结果
   * @param {Array} index buildIndex 的结果
   * @param {number} threshold
   * @param {Element} [el] 目标控件，用于控件类型加成
   */
  function pickBest(ctx, section, index, threshold, el) {
    const tag = el && el.tagName ? el.tagName.toLowerCase() : '';
    const it = el && el.getAttribute ? (el.getAttribute('type') || 'text').toLowerCase() : '';
    let best = null;
    for (let i = 0; i < index.length; i++) {
      const entry = index[i];
      if (!entry.aliases.length) continue;
      for (let a = 0; a < entry.aliases.length; a++) {
        const al = entry.aliases[a];
        // 分区未知时，不拿"开始时间"这类歧义别名去猜
        if (al.ambiguous && !section) continue;
        for (let c = 0; c < ctx.length; c++) {
          const item = ctx[c];
          if (item.text.indexOf(al.a) === -1) continue;

          // 硬排除：该字段不适合出现在这种上下文里
          let avoided = false;
          for (let v = 0; v < entry.avoids.length; v++) {
            if (item.text.indexOf(entry.avoids[v]) !== -1) { avoided = true; break; }
          }
          if (avoided) continue;

          let score = item.weight + Math.min(al.a.length, 10) * 3;
          if (al.weak) score -= 22;
          if (entry.section && section && entry.section !== section) score -= 26;
          if (item.text === al.a) score += 4;
          // 控件类型加成：让多行框优先配长文本字段、tel 框优先配手机号
          if (tag === 'textarea' && entry.type === 'textarea') score += 8;
          if (it === 'tel' && entry.type === 'tel') score += 6;

          if (!best || score > best.score) {
            best = {
              fieldKey: entry.key,
              field: entry.field,
              score: score,
              alias: al.a,
              source: item.source,
              matchedText: item.text
            };
          }
        }
      }
    }
    if (!best) return null;
    const limit = typeof threshold === 'number' ? threshold : 66;
    return best.score >= limit ? best : null;
  }

  /* ============================== 值格式化 ============================== */

  /** 从各种写法里解析年月日 */
  function parseDateParts(value) {
    if (value === null || value === undefined) return null;
    const s = toHalfWidth(String(value)).trim();
    if (!s) return null;
    if (/至今|现在|now|present|无/i.test(s)) return { raw: s, ongoing: true };

    let m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
    if (m) return { y: m[1], m: pad2(m[2]), d: pad2(m[3]) };

    m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})/);
    if (m) return { y: m[1], m: pad2(m[2]), d: null };

    m = s.match(/^(\d{4})\s*年?\s*$/);
    if (m) return { y: m[1], m: null, d: null };

    m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (m) return { y: m[1], m: pad2(m[2]), d: pad2(m[3]) };

    m = s.match(/^(\d{4})(\d{2})$/);
    if (m) return { y: m[1], m: pad2(m[2]), d: null };

    return { raw: s };
  }

  function pad2(v) { return String(v).length === 1 ? '0' + v : String(v); }

  /**
   * 按目标控件的要求改写取值
   */
  function formatValue(value, el, field) {
    if (value === null || value === undefined || value === '') return '';
    const str = String(value);
    const type = (el && el.getAttribute && el.getAttribute('type') || '').toLowerCase();
    const placeholder = (el && el.getAttribute && el.getAttribute('placeholder') || '');
    const maxLength = el && el.getAttribute ? parseInt(el.getAttribute('maxlength'), 10) : NaN;

    const wantsDate = type === 'date' || type === 'month' ||
      (field && (field.type === 'date' || field.type === 'month')) ||
      /(yyyy|yy|年|月|日)/i.test(placeholder);

    const parts = parseDateParts(str);
    if (parts && parts.ongoing) return str;
    if (!wantsDate || !parts || !parts.y) return str;

    const y = parts.y, mm = parts.m || '01', dd = parts.d || '01';

    if (type === 'date') return y + '-' + mm + '-' + dd;
    if (type === 'month') return y + '-' + mm;

    const ph = toHalfWidth(placeholder);
    if (/yyyy\s*年\s*mm\s*月\s*dd/i.test(ph)) return y + '年' + mm + '月' + dd + '日';
    if (/yyyy\s*年\s*mm\s*月/i.test(ph)) return y + '年' + mm + '月';
    if (/yyyy\s*年/i.test(ph) && !/mm/i.test(ph)) return y + '年';
    if (/yyyy-mm-dd/i.test(ph)) return y + '-' + mm + '-' + dd;
    if (/yyyy\/mm\/dd/i.test(ph)) return y + '/' + mm + '/' + dd;
    if (/yyyy\.mm\.dd/i.test(ph)) return y + '.' + mm + '.' + dd;
    if (/yyyy-mm/i.test(ph)) return y + '-' + mm;
    if (/yyyy\/mm/i.test(ph)) return y + '/' + mm;
    if (/yyyymmdd/i.test(ph)) return y + mm + dd;
    if (/yyyymm/i.test(ph)) return y + mm;

    if (!isNaN(maxLength) && maxLength === 4) return y;
    if (!isNaN(maxLength) && maxLength === 7) return y + '-' + mm;
    if (!isNaN(maxLength) && maxLength === 10) return y + '-' + mm + '-' + dd;

    // 中文界面默认「YYYY-MM」，仅在原值缺月份时补全
    if (!parts.m) return y;
    return str;
  }

  /* ============================== 选项匹配 ============================== */

  const VALUE_SYNONYMS = {
    '男': ['男', '男性', 'male', 'm', 'man', 'boy', '先生'],
    '女': ['女', '女性', 'female', 'f', 'woman', 'girl', '女士'],
    '本科': ['本科', '大学本科', '全日制本科', 'bachelor', 'undergraduate', 'bs', 'ba', '学士'],
    '大专': ['大专', '专科', '高职', 'college', 'associate'],
    '硕士研究生': ['硕士研究生', '硕士', '研究生', 'master', 'msc', 'ms'],
    '博士研究生': ['博士研究生', '博士', 'doctor', 'phd'],
    '学士': ['学士', 'bachelor', '本科'],
    '硕士': ['硕士', 'master', '研究生'],
    '是': ['是', 'yes', 'y', 'true', '接受', '愿意', '同意', '可以', '服从'],
    '否': ['否', 'no', 'n', 'false', '不接受', '不愿意', '不同意', '不可以', '不服从'],
    '汉族': ['汉族', '汉', 'han'],
    '未婚': ['未婚', 'single', 'unmarried'],
    '已婚': ['已婚', 'married'],
    '群众': ['群众', '普通群众', '无党派', 'masses'],
    '共青团员': ['共青团员', '团员', 'league member'],
    '中共党员': ['中共党员', '党员', '中国共产党党员', 'ccp member'],
    'CET-6': ['cet-6', 'cet6', '大学英语六级', '英语六级', '六级'],
    'CET-4': ['cet-4', 'cet4', '大学英语四级', '英语四级', '四级'],
    '实习': ['实习', 'intern', 'internship', '实习生'],
    '全职': ['全职', 'full-time', 'fulltime', '正式'],
    '随时到岗': ['随时到岗', '随时', '立即', '即刻', 'immediately', 'now', '一周内'],
    '面议': ['面议', 'negotiable', '可谈']
  };

  function optionVariants(value) {
    const v = normalize(value);
    const out = [v];
    const keys = Object.keys(VALUE_SYNONYMS);
    for (let i = 0; i < keys.length; i++) {
      const variants = VALUE_SYNONYMS[keys[i]].map(normalize);
      if (variants.indexOf(v) !== -1 || normalize(keys[i]) === v) {
        for (let j = 0; j < variants.length; j++) {
          if (out.indexOf(variants[j]) === -1) out.push(variants[j]);
        }
      }
    }
    return out;
  }

  /**
   * 在候选选项文本里挑出最匹配 value 的那个
   * @param {string} value 想要的值
   * @param {Array<string>} options 页面上的选项文本
   * @returns {string|null} 命中的原始选项文本
   */
  function chooseOption(value, options) {
    if (!value || !options || !options.length) return null;
    const variants = optionVariants(value);

    // 1. 精确归一化相等
    for (let i = 0; i < options.length; i++) {
      const n = normalize(options[i]);
      if (!n) continue;
      for (let v = 0; v < variants.length; v++) {
        if (n === variants[v]) return options[i];
      }
    }
    // 2. 选项包含目标值（"本科（学士）" 命中 "本科"）
    for (let i = 0; i < options.length; i++) {
      const n = normalize(options[i]);
      if (!n) continue;
      for (let v = 0; v < variants.length; v++) {
        if (variants[v].length >= 2 && n.indexOf(variants[v]) !== -1) return options[i];
      }
    }
    // 3. 目标值包含选项（"硕士研究生" 命中 "硕士"）
    for (let i = 0; i < options.length; i++) {
      const n = normalize(options[i]);
      if (!n || n.length < 2) continue;
      for (let v = 0; v < variants.length; v++) {
        if (variants[v].indexOf(n) !== -1) return options[i];
      }
    }
    return null;
  }

  /* ============================== 对外 API ============================== */

  function matchElement(el, opts) {
    opts = opts || {};
    // 隐藏元素永不参与匹配（content.js 会再过滤一次，这里做兜底）
    if (!opts.ignoreVisibility && !isVisible(el, opts)) return null;
    const index = opts.index || buildIndex(opts.fields || []);
    const ctx = collectContext(el, opts);
    const section = inferSection(el);
    const hit = pickBest(ctx, section, index, opts.threshold, el);
    if (!hit || !typeCompatible(hit.field, el)) return null;
    hit.section = section;
    return hit;
  }

  function isSelectLike(el) {
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'combobox' || role === 'listbox') return true;
    const cls = el.getAttribute('class') || '';
    if (/(ant-select|el-select|ivu-select|el-cascader|ant-cascader|semi-select|next-select|arco-select)/i.test(cls)) return true;
    const p = el.closest && el.closest('.ant-select,.el-select,.ivu-select,.semi-select,.next-select,.arco-select,[role="combobox"]');
    return !!p;
  }

  return {
    normalize: normalize,
    toHalfWidth: toHalfWidth,
    isVisible: isVisible,
    isCandidate: isCandidate,
    collectContext: collectContext,
    inferSection: inferSection,
    buildIndex: buildIndex,
    typeCompatible: typeCompatible,
    pickBest: pickBest,
    matchElement: matchElement,
    radioGroupOf: radioGroupOf,
    optionLabelOf: optionLabelOf,
    parseDateParts: parseDateParts,
    formatValue: formatValue,
    chooseOption: chooseOption,
    optionVariants: optionVariants,
    sectionOfText: sectionOfText,
    isSelectLike: isSelectLike,
    NOISE_WORDS: NOISE_WORDS
  };
});
