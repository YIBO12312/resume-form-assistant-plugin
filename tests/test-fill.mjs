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
  },
  // 可重复区块：页面上第 N 条记录应当取这里的第 N 条
  lists: {
    education: [
      { school: '示例大学', startDate: '2021-09', endDate: '2025-06', major: '软件工程',
        degree: '本科', degreeType: '学士', college: '计算机学院' }
    ],
    internship: [
      { company: '示例科技有限公司', position: '后端开发实习生', startDate: '2024-07',
        endDate: '2024-09', content: '示例实习内容甲' },
      { company: '某某信息技术有限公司', position: '数据开发实习生', startDate: '2024-01',
        endDate: '2024-03', content: '示例实习内容乙' }
    ],
    certificate: [
      { type: '外语证书', name: '大学英语六级（CET-6）' },
      { type: '其他证书', name: '钢琴七级证书' }
    ],
    skill: [
      { name: 'Python', level: '熟练' },
      { name: 'Java', level: '掌握' }
    ]
  }
};

const SETTINGS = Object.assign({}, DEFAULT_SETTINGS, { fabMode: 'never', autoFillOnLoad: false });
const RESUME = { name: '测试简历.pdf', type: 'application/pdf', size: 12345, dataUrl: 'data:application/pdf;base64,AAAA' };

const store = {
  nrfa_settings: SETTINGS,
  nrfa_profiles: [SAMPLE_PROFILE],
  nrfa_resume: RESUME,
  nrfa_photo: { name: '测试证件照.jpg', type: 'image/jpeg', size: 2048, dataUrl: 'data:image/jpeg;base64,BBBB' }
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

/* ================= 可重复区块：第 N 条页面记录 ← 第 N 条数据 =================
   模拟北森 / 大易那类网申：同一组字段名重复出现多条，每条后面带个「删除」。
   页面上放了 2 条实习、2 条证书、2 条技能，以及第 3 条实习（档案里没有 → 应当提示越界）。 */
const REPEAT_FORM = `
  <form id="campus">
    <h2>基本信息</h2>
    <div><label for="r_name">姓名</label><input id="r_name" type="text"></div>

    <h2>教育经历</h2>
    <div class="block">
      <div><label>学校名称</label><input id="edu1_school" type="text"></div>
      <div><label>开始时间</label><input id="edu1_start" type="text" placeholder="YYYY-MM"></div>
      <div><label>专业名称</label><input id="edu1_major" type="text"></div>
      <div><label>学历</label><select id="edu1_degree">
        <option value="">请选择</option><option>大专</option><option>本科</option><option>硕士研究生</option>
      </select></div>
    </div>

    <h2>实习经历</h2>
    <div class="block">
      <div><label>单位名称</label><input id="int1_company" type="text"></div>
      <div><label>开始时间</label><input id="int1_start" type="text" placeholder="YYYY-MM"></div>
      <div><label>结束时间</label><input id="int1_end" type="text" placeholder="YYYY-MM"></div>
      <div><label>实习内容</label><textarea id="int1_content"></textarea></div>
    </div>
    <div class="block">
      <div><label>单位名称</label><input id="int2_company" type="text"></div>
      <div><label>开始时间</label><input id="int2_start" type="text" placeholder="YYYY-MM"></div>
      <div><label>结束时间</label><input id="int2_end" type="text" placeholder="YYYY-MM"></div>
      <div><label>实习内容</label><textarea id="int2_content"></textarea></div>
    </div>
    <div class="block">
      <div><label>单位名称</label><input id="int3_company" type="text"></div>
      <div><label>开始时间</label><input id="int3_start" type="text" placeholder="YYYY-MM"></div>
    </div>

    <h2>证书</h2>
    <div class="block">
      <div><label>证书种类</label><input id="cert1_type" type="text"></div>
      <div><label>证书名称</label><input id="cert1_name" type="text"></div>
    </div>
    <div class="block">
      <div><label>证书种类</label><input id="cert2_type" type="text"></div>
      <div><label>证书名称</label><input id="cert2_name" type="text"></div>
    </div>

    <h2>技能</h2>
    <div class="block">
      <div><label>技能名称</label><input id="sk1_name" type="text"></div>
      <div><label>掌握程度</label><select id="sk1_level">
        <option value="">请选择</option><option>精通</option><option>熟练</option><option>掌握</option><option>了解</option>
      </select></div>
    </div>
    <div class="block">
      <div><label>技能名称</label><input id="sk2_name" type="text"></div>
      <div><label>掌握程度</label><select id="sk2_level">
        <option value="">请选择</option><option>精通</option><option>熟练</option><option>掌握</option><option>了解</option>
      </select></div>
    </div>

    <h2>附件</h2>
    <div><label for="r_cv">简历附件</label><input id="r_cv" type="file"></div>
    <div><label for="r_photo">证件照</label><input id="r_photo" type="file"></div>
  </form>
`;

document.body.innerHTML = REPEAT_FORM;
store.nrfa_settings.fillEmptyOnly = true;
await window.__NRFA__.reload();
const repeatResult = await window.__NRFA__.fill();

check('区块：整体填充成功', repeatResult.ok, true);
check('区块：无失败项', repeatResult.stat.failed, 0);

/* 教育经历（1 条） */
check('区块·教育：学校名称', document.getElementById('edu1_school').value, '示例大学');
check('区块·教育：开始时间', document.getElementById('edu1_start').value, '2021-09');
check('区块·教育：专业名称', document.getElementById('edu1_major').value, '软件工程');
check('区块·教育：学历下拉', document.getElementById('edu1_degree').options[document.getElementById('edu1_degree').selectedIndex].textContent.trim(), '本科');

/* 实习经历（页面上 2 条都有数据，第 3 条越界） */
check('区块·实习1：单位名称', document.getElementById('int1_company').value, '示例科技有限公司');
check('区块·实习1：开始时间', document.getElementById('int1_start').value, '2024-07');
check('区块·实习1：实习内容', document.getElementById('int1_content').value, '示例实习内容甲');
check('区块·实习2：单位名称（取第 2 条）', document.getElementById('int2_company').value, '某某信息技术有限公司');
check('区块·实习2：开始时间', document.getElementById('int2_start').value, '2024-01');
check('区块·实习2：实习内容', document.getElementById('int2_content').value, '示例实习内容乙');
check('区块·实习3：越界不填', document.getElementById('int3_company').value, '');
check('区块·实习3：越界不填', document.getElementById('int3_start').value, '');

/* 证书（2 条，且「证书名称」要能和列表里的「语言证书」字段区分开） */
check('区块·证书1：种类', document.getElementById('cert1_type').value, '外语证书');
check('区块·证书1：名称', document.getElementById('cert1_name').value, '大学英语六级（CET-6）');
check('区块·证书2：种类', document.getElementById('cert2_type').value, '其他证书');
check('区块·证书2：名称', document.getElementById('cert2_name').value, '钢琴七级证书');

/* 技能（2 条，掌握程度走下拉匹配） */
check('区块·技能1：名称', document.getElementById('sk1_name').value, 'Python');
check('区块·技能1：掌握程度', document.getElementById('sk1_level').options[document.getElementById('sk1_level').selectedIndex].textContent.trim(), '熟练');
check('区块·技能2：名称', document.getElementById('sk2_name').value, 'Java');
check('区块·技能2：掌握程度', document.getElementById('sk2_level').options[document.getElementById('sk2_level').selectedIndex].textContent.trim(), '掌握');

/* 两个文件槽要各挂各的，不能串 */
check('区块·附件：简历挂对了', document.getElementById('r_cv').files[0].name, '测试简历.pdf');
check('区块·附件：证件照挂对了', document.getElementById('r_photo').files[0].name, '测试证件照.jpg');

/* 平面字段不受影响 */
check('区块：扁平字段仍生效', document.getElementById('r_name').value, '张三');

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
