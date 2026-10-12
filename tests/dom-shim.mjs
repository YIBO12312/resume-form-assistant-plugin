/**
 * 测试用迷你 DOM（Node 侧）
 * ------------------------------------------------------------------
 * 沙箱内 Edge 无法稳定运行（mojo IPC 依赖命名管道，被沙箱禁止），
 * 因此这里实现识别引擎真正用到的那一小撮 DOM 能力：
 *   - HTML 解析（含 table / tr / td / th / option / li 的隐式闭合）
 *   - Element 遍历：children / parentElement / previousElementSibling / closest / contains
 *   - querySelector(All)：支持逗号分组、后代与子代组合器、tag/.class/#id/[attr=v]
 *   - getComputedStyle + getClientRects：让可见性判断可被真实测试
 *   - input.labels / form / rows / textContent / innerHTML
 * 足够覆盖 matcher.js 的全部 DOM 依赖，且行为与浏览器一致。
 */

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

/* ------------------------------- 节点 ------------------------------- */

class ShimText {
  constructor(text) {
    this.nodeType = 3;
    this.nodeValue = text;
    this.parentNode = null;
  }
  get textContent() { return this.nodeValue; }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
}

class ShimElement {
  constructor(doc, tagName) {
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.tagName = String(tagName).toUpperCase();
    this._attrs = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = null;
    this.shadowRoot = null;
  }

  /* ---- 值 / 选中状态（供写值逻辑测试） ---- */
  get value() {
    if (this._value !== undefined) return this._value;
    return this.getAttribute('value') || '';
  }
  set value(v) { this._value = v === null || v === undefined ? '' : String(v); }

  get checked() {
    if (this._checked !== undefined) return this._checked;
    return this.hasAttribute('checked');
  }
  set checked(v) { this._checked = !!v; }

  get options() {
    if (this.tagName !== 'SELECT') return [];
    return this.children.filter((c) => c.tagName === 'OPTION');
  }
  get selectedIndex() {
    if (this._selectedIndex !== undefined) return this._selectedIndex;
    return this.options.length ? 0 : -1;
  }
  set selectedIndex(i) { this._selectedIndex = Number(i); }
  get selectedOptions() {
    const o = this.options[this.selectedIndex];
    return o ? [o] : [];
  }

  /* ---- 事件 ---- */
  addEventListener(type, fn) {
    if (!this._listeners) this._listeners = {};
    this._listeners[type] = (this._listeners[type] || []).concat(fn);
  }
  removeEventListener(type, fn) {
    if (!this._listeners || !this._listeners[type]) return;
    this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
  }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    ev.currentTarget = this;
    let node = this;
    while (node) {
      const ls = node._listeners && node._listeners[ev.type];
      if (ls) ls.slice().forEach((fn) => { try { fn.call(node, ev); } catch (e) { /* ignore */ } });
      if (!ev.bubbles) break;
      node = node.parentNode;
    }
    return !ev.defaultPrevented;
  }

  click() {
    const type = (this.getAttribute('type') || '').toLowerCase();
    if (type === 'radio') {
      const name = this.getAttribute('name');
      if (name) {
        const all = this.ownerDocument.querySelectorAll('input[name="' + name + '"]');
        all.forEach((r) => { r._checked = false; });
      }
      this._checked = true;
    } else if (type === 'checkbox') {
      this._checked = !this.checked;
    }
    this.dispatchEvent(new (this.ownerDocument.defaultView.Event)('click', { bubbles: true, cancelable: true }));
  }

  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }

  /* ---- Shadow DOM ---- */
  attachShadow(init) {
    const root = new ShimShadowRoot(this.ownerDocument);
    root.host = this;
    this.shadowRoot = root;
    return root;
  }
  getRootNode() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n;
  }

  /* ---- 属性 ---- */
  getAttribute(name) {
    const k = String(name).toLowerCase();
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  setAttribute(name, value) { this._attrs.set(String(name).toLowerCase(), String(value)); }
  removeAttribute(name) { this._attrs.delete(String(name).toLowerCase()); }
  hasAttribute(name) { return this._attrs.has(String(name).toLowerCase()); }

  get id() { return this.getAttribute('id') || ''; }
  get name() { return this.getAttribute('name') || ''; }
  get className() { return this.getAttribute('class') || ''; }
  get classList() {
    const list = this.className.split(/\s+/).filter(Boolean);
    return {
      contains: (c) => list.includes(c),
      add: (c) => { if (!list.includes(c)) { list.push(c); this.setAttribute('class', list.join(' ')); } },
      remove: (c) => { const i = list.indexOf(c); if (i >= 0) { list.splice(i, 1); this.setAttribute('class', list.join(' ')); } }
    };
  }
  get type() { return (this.getAttribute('type') || '').toLowerCase(); }
  get hidden() { return this.hasAttribute('hidden'); }
  get disabled() {
    if (this._disabled !== undefined) return this._disabled;
    return this.hasAttribute('disabled');
  }
  set disabled(v) { this._disabled = !!v; }
  get style() { return parseStyle(this.getAttribute('style') || ''); }

  /* ---- 树遍历 ---- */
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] || null; }
  get parentElement() {
    return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.childNodes;
    let i = sibs.indexOf(this) - 1;
    while (i >= 0) { if (sibs[i].nodeType === 1) return sibs[i]; i--; }
    return null;
  }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.childNodes;
    let i = sibs.indexOf(this) + 1;
    while (i < sibs.length) { if (sibs[i].nodeType === 1) return sibs[i]; i++; }
    return null;
  }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) { this.childNodes.splice(i, 1); node.parentNode = null; }
    return node;
  }
  contains(node) {
    let n = node;
    while (n) { if (n === this) return true; n = n.parentNode; }
    return false;
  }

  /* ---- 文本 ---- */  get textContent() {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'SCRIPT' || n.tagName === 'STYLE') return;
      n.childNodes.forEach(walk);
    };
    this.childNodes.forEach(walk);
    return out;
  }
  set textContent(v) {
    this.childNodes = [];
    if (v !== '' && v !== null && v !== undefined) this.appendChild(new ShimText(String(v)));
  }
  get innerHTML() {
    return this.childNodes.map(serialize).join('');
  }
  set innerHTML(html) {
    this.childNodes = [];
    parseInto(this, String(html), this.ownerDocument);
  }

  /* ---- 选择器 ---- */
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (matchesSelector(n, selector)) return n;
      n = n.parentNode;
    }
    return null;
  }
  querySelector(selector) { return querySelectorAll(this, selector)[0] || null; }
  querySelectorAll(selector) { return querySelectorAll(this, selector); }

  /* ---- 表格 / 表单 ---- */
  get rows() {
    if (this.tagName !== 'TABLE') return [];
    const out = [];
    this.childNodes.forEach((sec) => {
      if (sec.nodeType !== 1) return;
      if (sec.tagName === 'TR') out.push(sec);
      else if (/^(THEAD|TBODY|TFOOT)$/.test(sec.tagName)) {
        sec.childNodes.forEach((tr) => { if (tr.nodeType === 1 && tr.tagName === 'TR') out.push(tr); });
      }
    });
    return out;
  }
  get cells() {
    if (this.tagName !== 'TR') return [];
    return this.children.filter((c) => c.tagName === 'TD' || c.tagName === 'TH');
  }
  get labels() {
    if (!/^(INPUT|SELECT|TEXTAREA)$/.test(this.tagName)) return [];
    const out = [];
    const id = this.getAttribute('id');
    if (id) {
      const found = this.ownerDocument.querySelector('label[for="' + cssEscape(id) + '"]');
      if (found) out.push(found);
    }
    const wrap = this.closest('label');
    if (wrap && !out.includes(wrap)) out.push(wrap);
    return out;
  }

  /* ---- 布局（供可见性判断） ---- */
  getClientRects() {
    const cs = this.ownerDocument.defaultView.getComputedStyle(this);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return [];
    return [{ width: 120, height: 24, top: 0, left: 0, right: 120, bottom: 24 }];
  }
  getBoundingClientRect() {
    const r = this.getClientRects()[0];
    return r || { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  }
}

class ShimShadowRoot extends ShimElement {
  constructor(doc) {
    super(doc, '#shadow-root');
    this.nodeType = 11;
    this.host = null;
  }
}

class ShimDocument {
  constructor() {
    this.nodeType = 9;
    this.ownerDocument = this;
    this.readyState = 'complete';
    this.activeElement = null;
    this.documentElement = new ShimElement(this, 'html');
    this.documentElement.parentNode = this;
    this.head = new ShimElement(this, 'head');
    this.body = new ShimElement(this, 'body');
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.defaultView = null;
    this._listeners = {};
  }
  createElement(tag) { return new ShimElement(this, tag); }
  createTextNode(t) { return new ShimText(t); }
  get childNodes() { return [this.documentElement]; }
  querySelector(sel) { return querySelectorAll(this.documentElement, sel)[0] || null; }
  querySelectorAll(sel) { return querySelectorAll(this.documentElement, sel); }
  getElementById(id) {
    return this.querySelectorAll('#' + cssEscape(id))[0] || null;
  }
  addEventListener(type, fn) {
    this._listeners[type] = (this._listeners[type] || []).concat(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
  }
  dispatchEvent(ev) {
    (this._listeners[ev.type] || []).slice().forEach((fn) => fn(ev));
    return true;
  }
}

function serialize(node) {
  if (node.nodeType === 3) return node.nodeValue;
  const attrs = [];
  node._attrs.forEach((v, k) => attrs.push(` ${k}="${v}"`));
  const open = `<${node.tagName.toLowerCase()}${attrs.join('')}>`;
  if (VOID_TAGS.has(node.tagName.toLowerCase())) return open;
  return open + node.childNodes.map(serialize).join('') + `</${node.tagName.toLowerCase()}>`;
}

/* --------------------------- style 与可见性 --------------------------- */

function parseStyle(text) {
  const out = {};
  String(text).split(';').forEach((part) => {
    const i = part.indexOf(':');
    if (i < 0) return;
    const k = part.slice(0, i).trim().toLowerCase();
    const v = part.slice(i + 1).trim().toLowerCase();
    if (k) out[k] = v;
  });
  return out;
}

function getComputedStyle(el) {
  const result = { display: 'block', visibility: 'visible', opacity: '1' };
  const chain = [];
  let n = el;
  while (n && n.nodeType === 1) { chain.unshift(n); n = n.parentNode; }
  for (const node of chain) {
    const s = parseStyle(node.getAttribute('style') || '');
    if (s.display) result.display = s.display;
    if (s.visibility) result.visibility = s.visibility;   // visibility 会被继承
    if (s.opacity) result.opacity = s.opacity;
    if (node.hidden) result.display = 'none';
  }
  // 常见隐藏方式（class 名约定）
  for (const node of chain) {
    if (/(^|\s)(hidden|hide|d-none|display-none)(\s|$)/.test(node.className)) result.display = 'none';
  }
  return result;
}

/* ------------------------------ 选择器 ------------------------------ */

function cssEscape(v) { return String(v).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, (c) => '\\' + c); }

function parseCompound(part) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([#.]?[\w\u4e00-\u9fa5-]+)|\[([^\]]+)\]/g;
  let m;
  let first = true;
  while ((m = re.exec(part))) {
    if (m[2] !== undefined) {
      const body = m[2];
      const eq = body.indexOf('=');
      if (eq < 0) out.attrs.push({ name: body.trim().toLowerCase(), op: 'exists', value: null });
      else {
        const name = body.slice(0, eq).trim().toLowerCase();
        let value = body.slice(eq + 1).trim();
        if (/^".*"$/.test(value) || /^'.*'$/.test(value)) value = value.slice(1, -1);
        out.attrs.push({ name, op: '=', value });
      }
      continue;
    }
    const token = m[1];
    if (token[0] === '#') out.id = token.slice(1);
    else if (token[0] === '.') out.classes.push(token.slice(1));
    else if (first) out.tag = token.toLowerCase();
  }
  return out;
}

function matchesCompound(el, part) {
  if (part === '*') return true;
  const c = parseCompound(part);
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  if (c.id && el.getAttribute('id') !== c.id) return false;
  for (const cls of c.classes) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const a of c.attrs) {
    if (a.op === 'exists') { if (!el.hasAttribute(a.name)) return false; }
    else if (el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

/** 把选择器拆成 [compound, combinator, compound, ...] */
function tokenizeGroup(group) {
  const tokens = [];
  const re = /\s*(>)\s*|\s+/g;
  let lastIndex = 0;
  let m;
  const pushPart = (s) => { const t = s.trim(); if (t) tokens.push(t); };
  while ((m = re.exec(group))) {
    pushPart(group.slice(lastIndex, m.index));
    if (m[1]) tokens.push('>');
    else tokens.push(' ');
    lastIndex = re.lastIndex;
  }
  pushPart(group.slice(lastIndex));
  return tokens.filter((t) => t !== '');
}

function matchesGroup(el, group) {
  const tokens = tokenizeGroup(group);
  // 从右往左匹配
  let idx = tokens.length - 1;
  if (idx < 0) return false;
  if (!matchesCompound(el, tokens[idx])) return false;
  idx--;
  let current = el;
  while (idx >= 0) {
    const combinator = tokens[idx];
    idx--;
    const part = tokens[idx];
    idx--;
    if (combinator === '>') {
      current = current.parentElement;
      if (!current || !matchesCompound(current, part)) return false;
    } else {
      let anc = current.parentElement;
      let found = null;
      while (anc) {
        if (matchesCompound(anc, part)) { found = anc; break; }
        anc = anc.parentElement;
      }
      if (!found) return false;
      current = found;
    }
  }
  return true;
}

function matchesSelector(el, selector) {
  return String(selector).split(',').some((g) => g.trim() && matchesGroup(el, g.trim()));
}

function querySelectorAll(root, selector) {
  const groups = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue;
      if (groups.some((g) => matchesGroup(child, g))) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/* ------------------------------ HTML 解析 ------------------------------ */

const AUTO_CLOSE = {
  td: ['td', 'th'], th: ['td', 'th'],
  tr: ['td', 'th', 'tr'],
  option: ['option'],
  li: ['li'], p: ['p'], dt: ['dt', 'dd'], dd: ['dt', 'dd']
};

function parseInto(parent, html, doc) {
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      const text = html.slice(i);
      if (text) top().appendChild(new ShimText(decodeEntities(text)));
      break;
    }
    if (lt > i) {
      const text = html.slice(i, lt);
      if (text.trim()) top().appendChild(new ShimText(decodeEntities(text)));
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {           // doctype 等
      const end = html.indexOf('>', lt);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html[lt + 1] === '/') {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s--) {
        if (stack[s].tagName.toLowerCase() === name) { stack.length = s; break; }
      }
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const end = findTagEnd(html, lt + 1);
    const raw = html.slice(lt + 1, end);
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const spaceIdx = body.search(/\s/);
    const name = (spaceIdx < 0 ? body : body.slice(0, spaceIdx)).trim().toLowerCase();
    const attrText = spaceIdx < 0 ? '' : body.slice(spaceIdx);

    if (/^[a-z][a-z0-9-]*$/.test(name)) {
      const closes = AUTO_CLOSE[name];
      if (closes && closes.includes(top().tagName.toLowerCase())) stack.pop();
      const el = new ShimElement(doc, name);
      parseAttrs(attrText, el);
      top().appendChild(el);
      if (!VOID_TAGS.has(name) && !selfClosing) stack.push(el);
    }
    i = end + 1;
  }
}

function findTagEnd(html, from) {
  let i = from;
  let quote = null;
  while (i < html.length) {
    const ch = html[i];
    if (quote) { if (ch === quote) quote = null; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '>') return i;
    i++;
  }
  return html.length;
}

function parseAttrs(text, el) {
  const re = /([^\s=\/>]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const value = m[3] !== undefined ? m[3] : (m[4] !== undefined ? m[4] : (m[5] !== undefined ? m[5] : ''));
    el.setAttribute(name, decodeEntities(value));
  }
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/* --------------------------- 伪构造器与全局对象 --------------------------- */

class ShimEvent {
  constructor(type, init) {
    init = init || {};
    this.type = type;
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { /* no-op */ }
}

class ShimMouseEvent extends ShimEvent {}
class ShimKeyboardEvent extends ShimEvent {}

class ShimFile {
  constructor(parts, name, opts) {
    this.name = name;
    this.type = (opts && opts.type) || '';
    this.size = (parts || []).reduce((n, p) => n + (p && p.size ? p.size : 0), 0);
  }
}

class ShimDataTransfer {
  constructor() {
    this.items = {
      _files: [],
      add: (f) => { this.items._files.push(f); }
    };
    const self = this;
    Object.defineProperty(this, 'files', {
      get() { return self.items._files.slice(); }
    });
  }
}

/** 让 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value') 这类调用能拿到 setter */
class FakeInputProto {}
class FakeTextareaProto {}
class FakeSelectProto {}
[FakeInputProto, FakeTextareaProto, FakeSelectProto, ShimElement].forEach((proto) => {
  Object.defineProperty(proto.prototype, 'value', {
    get() {
      if (this._value !== undefined) return this._value;
      const attr = this.getAttribute('value');
      if (attr !== null) return attr;
      // <option>没有 value 属性时，浏览器用其文本作为值
      if (this.tagName === 'OPTION') return this.textContent.trim();
      return '';
    },
    set(v) { this._value = v === null || v === undefined ? '' : String(v); },
    configurable: true
  });
});

/* ------------------------------- 对外 API ------------------------------- */

export function createDom(html) {
  const document = new ShimDocument();
  const window = {
    document,
    CSS: { escape: cssEscape },
    getComputedStyle: (el) => getComputedStyle(el),
    Event: ShimEvent,
    MouseEvent: ShimMouseEvent,
    KeyboardEvent: ShimKeyboardEvent,
    File: ShimFile,
    DataTransfer: ShimDataTransfer,
    HTMLInputElement: FakeInputProto,
    HTMLTextAreaElement: FakeTextareaProto,
    HTMLSelectElement: FakeSelectProto,
    MutationObserver: class { observe() { } disconnect() { } },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    location: { hostname: 'example.com', href: 'https://example.com/apply' }
  };
  document.defaultView = window;
  window.window = window;
  window.self = window;
  window.top = window;
  if (html) document.body.innerHTML = html;
  return { document, window, Element: ShimElement };
}

export { ShimElement, ShimShadowRoot };

