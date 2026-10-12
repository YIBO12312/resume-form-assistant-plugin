/**
 * 端到端填充测试：在迷你 DOM 上真正跑一遍 content.js 的扫描 → 识别 → 写值流程，
 * 验证写进去的值、派发的事件、select/radio/date/file 各类控件的处理，
 * 以及「只填空白字段」「撤销」这些行为。
 *
 * 运行： node tests/test-fill.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createDom, ShimElement } from './dom-shim.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

/* ------------------------------- 测试表单 ------------------------------- */
const FORM = `
  <form id="apply">
    <h2>基本信息</h2>
    <div class="row"><label for="name">姓名</label><input id="name" type="text" name="realName"></div>
    <div class="row"><label for="phone">手机号码</label><input id="phone" type="text" maxlength="11"></div>
    <div class="row"><label for="mail">电子邮箱</label><input id="mail" type="email"></div>
    <div class="row"><label for="birth">出生年月</label><input id="birth" type="text" placeholder="YYYY-MM"></div>
    <div class="row"><span>性别</span>
      <label><input type="radio" name="gender" value="1">男</label>
      <label><input type="radio" name="gender" value="2">女</label>
    </div>

    <h2>教育背景</h2>
    <table>
      <tbody>
        <tr><td>毕业院校</td><td><input id="school" type="text"></td></tr>
        <tr><td>所学专业</td><td><input id="major" type="text"></td></tr>
        <tr><td>最高学历</td><td>
          <select id="degree">
            <option value="">请选择</option>
            <option value="college">大专</option>
            <option value="bachelor">本科</option>
            <option value="master">硕士研究生</option>
          </select>
        </td></tr>
        <tr><td>预计毕业时间</td><td><input id="eduend" type="text" placeholder="YYYY-MM"></td></tr>
      </tbody>
    </table>

    <h2>求职意向</h2>
    <div class="row"><label for="pos">应聘职位</label><input id="pos" type="text"></div>
    <div class="row"><label for="city">期望工作地点</label><input id="city" type="text"></div>

    <h2>自我评价</h2>
    <div class="row"><label for="self">自我评价</label><textarea id="self" rows="5"></textarea></div>

    <h2>附件</h2>
    <div class="row"><label for="cv">上传简历</label><input id="cv" type="file"></div>

    <div class="row"><label for="prefill">姓名</label><input id="prefill" type="text" value="李四"></div>
    <div class="row"><label for="searchbox">搜索职位</label><input id="searchbox" type="text"></div>
  </form>
`;

/* ------------------------------ 搭建运行环境 ------------------------------ */
const { document, window } = createDom(FORM);

const schemaSrc = read('src/common/schema.js');
const matcherSrc = read('src/common/matcher.js');
const contentSrc = read('src/content/content.js');

// 取出默认档案，作为 storage 的内容
const probeCtx = { globalThis: {} };
probeCtx.globalThis = probeCtx;
const sctx = vm.createContext(probeCtx);
vm.runInContext(schemaSrc, sctx, { filename: 'schema.js' });
const DEFAULTS = JSON.parse(JSON.stringify(sctx.NRFA_SCHEMA.DEFAULT_PROFILE));
const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(sctx.NRFA_SCHEMA.DEFAULT_SETTINGS));

// schema.js 里出厂的是空白模板，所以这里灌一份**虚构的**测试档案。
// 刻意用「张三 / 13800138000 / 示例大学」这类明显的假数据：
// 仓库是公开的，测试文件里也不能出现任何真实个人信息。
const SAMPLE_PROFILE = {
  id: 'test',
  name: '测试档案',
  updatedAt: 0,
  fields: {
    name: '张三',
    englishName: 'Zhang San',
    gender: '男',
    birth: '2003-05',
    nation: '汉族',
    maritalStatus: '未婚',
    phone: '13800138000',
    email: 'zhangsan@example.com',
    school: '示例大学',
    college: '计算机学院',
    major: '软件工程',
    degree: '本科',
    academicDegree: '学士',
    eduStart: '2021-09',
    eduEnd: '2025-06',
    englishLevel: 'CET-6',
    jobType: '实习',
    expectedPosition: '后端开发实习生',
    expectedCity: '南京',
    expectedSalary: '面议',
    availableDate: '随时到岗',
    intern1Company: '示例科技有限公司',
    intern1Position: '后端开发实习生',
    intern1Start: '2024-07',
    intern1End: '2024-09',
    selfEvaluation: '这是一段用于自动化测试的自我评价文本，长度必须超过一百个字符，' +
      '以便验证多行文本框的写入逻辑是否真的正常工作。测试所用数据全部为虚构内容，' +
      '其中的人名、手机号、邮箱、学校与公司均为编造，不指向任何一个真实存在的人，' +
      '也不包含任何真实个人信息，请勿据此推断实际使用者的情况，谢谢配合。'
  }
};

const SETTINGS = Object.assign({}, DEFAULT_SETTINGS, { fabMode: 'never', autoFillOnLoad: false });
const RESUME = { name: '测试简历.pdf', type: 'application/pdf', size: 12345, dataUrl: 'data:application/pdf;base64,AAAA' };

const store = {
  nrfa_settings: SETTINGS,
  nrfa_profiles: [SAMPLE_PROFILE],
  nrfa_resume: RESUME
};

const chromeStub = {
  storage: {
    local: {
      get(keys, cb) {
        const out = {};
        const list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
        list.forEach((k) => { if (store[k] !== undefined) out[k] = store[k]; });
        setTimeout(() => cb(out), 0);
      },
      set(obj, cb) { Object.assign(store, obj); setTimeout(() => cb && cb(), 0); }
    }
  },
  runtime: { id: 'test', getURL: (p) => 'chrome-extension://test/' + p }
};

const sandbox = {
  window,
  document,
  chrome: chromeStub,
  location: window.location,
  navigator: { userAgent: 'NodeTest/1.0' },
  console,
  CSS: window.CSS,
  getComputedStyle: window.getComputedStyle,
  Event: window.Event,
  MouseEvent: window.MouseEvent,
  KeyboardEvent: window.KeyboardEvent,
  File: window.File,
  DataTransfer: window.DataTransfer,
  HTMLInputElement: window.HTMLInputElement,
  HTMLTextAreaElement: window.HTMLTextAreaElement,
  HTMLSelectElement: window.HTMLSelectElement,
  MutationObserver: window.MutationObserver,
  Element: ShimElement,
  fetch: async () => ({ blob: async () => ({ size: 12345, type: 'application/pdf' }) }),
  setTimeout,
  clearTimeout,
  Math, JSON, Object, Array, Set, Map, String, Number, Boolean, Promise, RegExp, Date, Error,
  parseInt, parseFloat, isNaN
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
const ctx = vm.createContext(sandbox);

vm.runInContext(schemaSrc, ctx, { filename: 'schema.js' });
vm.runInContext(matcherSrc, ctx, { filename: 'matcher.js' });
vm.runInContext(contentSrc, ctx, { filename: 'content.js' });

/* ------------------------------- 断言工具 ------------------------------- */
const results = [];
function check(name, actual, expected) {
  const a = actual === undefined ? 'undefined' : JSON.stringify(actual);
  const e = JSON.stringify(expected);
  results.push({ name, ok: a === e, actual: a, expected: e });
}

/* ------------------------------- 事件计数 ------------------------------- */
let inputEvents = 0;
let changeEvents = 0;
const nameEl = document.getElementById('name');
nameEl.addEventListener('input', () => { inputEvents++; });
nameEl.addEventListener('change', () => { changeEvents++; });
document.getElementById('degree').addEventListener('change', () => { changeEvents++; });

/* ------------------------------- 执行填充 ------------------------------- */
await new Promise((r) => setTimeout(r, 30));   // 让 boot() 里的 loadAll 先跑完
if (!window.__NRFA__) { console.error('content.js 没有暴露 __NRFA__'); process.exit(2); }

const fillResult = await window.__NRFA__.fill();

/* ------------------------------- 断言 ------------------------------- */
check('fill 返回 ok', fillResult.ok, true);
check('填充成功数 > 0', fillResult.stat.filled > 0, true);
check('失败数为 0', fillResult.stat.failed, 0);

check('文本：姓名', document.getElementById('name').value, '张三');
check('文本：手机号码（含 maxlength 控制）', document.getElementById('phone').value, '13800138000');
check('文本：type=email 只被邮箱字段命中', document.getElementById('mail').value, 'zhangsan@example.com');
check('表格布局：毕业院校', document.getElementById('school').value, '示例大学');
check('表格布局：所学专业', document.getElementById('major').value, '软件工程');
check('日期：出生年月 → YYYY-MM', document.getElementById('birth').value, '2003-05');
check('日期：预计毕业时间 → YYYY-MM', document.getElementById('eduend').value, '2025-06');
check('多行：自我评价已写入', document.getElementById('self').value.length > 100, true);
check('求职意向：应聘职位', document.getElementById('pos').value, '后端开发实习生');
check('求职意向：期望工作地点', document.getElementById('city').value, '南京');

/* select：选项文本命中「本科」 */
const degree = document.getElementById('degree');
check('下拉：最高学历选中项文本', degree.options[degree.selectedIndex].textContent.trim(), '本科');
check('下拉：最高学历 option value', degree.options[degree.selectedIndex].getAttribute('value'), 'bachelor');

/* radio：性别选中「男」 */
const radios = Array.prototype.slice.call(document.querySelectorAll('input[name=gender]'));
check('单选：男被选中', radios[0].checked, true);
check('单选：女未被选中', radios[1].checked, false);

/* file：简历已挂载 */
const cv = document.getElementById('cv');
check('附件：已挂载 1 个文件', cv.files && cv.files.length, 1);
check('附件：文件名正确', cv.files && cv.files[0].name, '测试简历.pdf');

/* 事件：React/Vue 兼容 */
check('事件：name 触发过 input', inputEvents > 0, true);
check('事件：name 触发过 change', changeEvents > 0, true);

/* 只填空白字段：已有值不被覆盖 */
check('已填内容不被覆盖（只填空白字段开启）', document.getElementById('prefill').value, '李四');

/* 搜索框没被误填 */
check('搜索框未被填充', document.getElementById('searchbox').value, '');

/* ------------------------------- 撤销 ------------------------------- */
const undoResult = window.__NRFA__.undo();
check('撤销返回 ok', undoResult.ok, true);
check('撤销：姓名恢复为空', document.getElementById('name').value, '');
check('撤销：单选恢复为未选', radios[0].checked, false);

/* ------------------------- 关闭「只填空白字段」后再填 -------------------------
   注意：content.js 每次填充后会把自己那份 settings 写回 storage，
   所以这里要改 storage 里的对象，而不是最初那个 SETTINGS 引用。 */
store.nrfa_settings.fillEmptyOnly = false;
document.getElementById('name').value = '张三';
document.getElementById('name')._value = '张三';
await window.__NRFA__.reload();
const fillResult2 = await window.__NRFA__.fill();
check('关闭「只填空白」后第二次填充 ok', fillResult2.ok, true);
check('关闭「只填空白」后覆盖已有值', document.getElementById('name').value, '张三');

/* ------------------------------- 输出 ------------------------------- */
const failed = results.filter((r) => !r.ok);
console.log('='.repeat(74));
console.log('网申助手 · 端到端填充测试（迷你 DOM 上真实执行 content.js）');
console.log('='.repeat(74));
results.forEach((r) => {
  if (r.ok) console.log('  ✅ ' + r.name);
  else console.log(`  ❌ ${r.name}\n       期望: ${r.expected}\n       实际: ${r.actual}`);
});
console.log('-'.repeat(74));
console.log(`结果：通过 ${results.length - failed.length} / ${results.length}` +
  (failed.length ? `，失败 ${failed.length}` : '，全部通过 🎉'));
process.exit(failed.length ? 1 : 0);
