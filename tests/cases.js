/**
 * 识别引擎测试用例（浏览器 / Node 双端共用）
 * 只依赖注入进来的 document、M(matcher)、S(schema)，不依赖任何宿主环境。
 */
(function (root) {
  'use strict';

  const FIXTURES = {
    // 网申系统最常见的「左标签 右控件」表格布局
    tableLayout: `
      <table>
        <thead><tr><th>字段</th><th>内容</th></tr></thead>
        <tbody>
          <tr><td>姓名</td><td><input type="text" id="f1"></td></tr>
          <tr><td>手机号码</td><td><input type="text" id="f2"></td></tr>
          <tr><td>电子邮箱</td><td><input type="text" id="f3"></td></tr>
          <tr><td>紧急联系人姓名</td><td><input type="text" id="f4"></td></tr>
          <tr><td>紧急联系人电话</td><td><input type="text" id="f5"></td></tr>
        </tbody>
      </table>`,

    // 表头列布局（thead 里写字段名）
    headColumnLayout: `
      <table>
        <thead><tr><th>姓名</th><th>最高学历</th><th>期望城市</th></tr></thead>
        <tbody><tr>
          <td><input type="text" id="h1"></td>
          <td><select id="h2"><option>请选择</option><option>大专</option><option>本科</option><option>硕士研究生</option></select></td>
          <td><input type="text" id="h3"></td>
        </tr></tbody>
      </table>`,

    // 标签放在自己的 td 里，控件在下一个 td
    labelInCell: `
      <table><tbody>
        <tr><td><label>所学专业</label></td><td><input type="text" id="c1"></td></tr>
        <tr><td><span>毕业院校</span><span class="req">*</span></td><td><input type="text" id="c2"></td></tr>
        <tr><td>政治面貌：</td><td><input type="text" id="c3"></td></tr>
      </tbody></table>`,

    labelFor: `
      <div class="form-item"><label for="a1">毕业院校</label><input id="a1" type="text"></div>
      <div class="form-item"><label for="a2">所学专业</label><input id="a2" type="text"></div>
      <div class="form-item"><label for="a3">最高学历</label>
        <select id="a3"><option value="">请选择</option><option>大专</option><option>本科</option><option>硕士研究生</option></select>
      </div>
      <div class="form-item"><label for="a4">预计毕业时间</label><input id="a4" type="text" placeholder="YYYY-MM"></div>`,

    antdStyle: `
      <div class="ant-form-item">
        <div class="ant-form-item-label"><label>期望职位</label></div>
        <div class="ant-form-item-control"><input class="ant-input" type="text" placeholder="请输入期望职位"></div>
      </div>
      <div class="ant-form-item">
        <div class="ant-form-item-label"><label>期望城市</label></div>
        <div class="ant-form-item-control"><input class="ant-input" type="text" placeholder="请输入"></div>
      </div>`,

    radioGender: `
      <div class="field">
        <span class="label">性别</span>
        <label><input type="radio" name="gender" value="1">男</label>
        <label><input type="radio" name="gender" value="2">女</label>
      </div>`,

    // 同一份表单里出现两组「开始/结束时间」，靠分区标题区分
    sectioned: `
      <div class="card">
        <div class="card-title">教育经历</div>
        <div class="row"><label>开始时间</label><input id="s1" type="text" placeholder="YYYY-MM"></div>
        <div class="row"><label>结束时间</label><input id="s2" type="text" placeholder="YYYY-MM"></div>
      </div>
      <div class="card">
        <div class="card-title">实习经历</div>
        <div class="row"><label>开始时间</label><input id="s3" type="text" placeholder="YYYY-MM"></div>
        <div class="row"><label>结束时间</label><input id="s4" type="text" placeholder="YYYY-MM"></div>
      </div>`,

    shouldNotMatch: `
      <div><label for="n1">搜索职位</label><input id="n1" type="text"></div>
      <div><label for="n2">图形验证码</label><input id="n2" type="text"></div>
      <div><label for="n3">设置密码</label><input id="n3" type="password"></div>
      <div><label for="n4">确认密码</label><input id="n4" type="password"></div>
      <div style="display:none"><label for="n5">姓名</label><input id="n5" type="text"></div>
      <div><label for="n6">用户名</label><input id="n6" type="text" name="userName"></div>`,

    textareas: `
      <div><label for="t1">自我评价</label><textarea id="t1"></textarea></div>
      <div><label for="t2">专业技能</label><textarea id="t2"></textarea></div>
      <div><label for="t3">姓名</label><input id="t3" type="text"></div>
      <div><label for="t4">现居住地</label><textarea id="t4"></textarea></div>`,

    englishForm: `
      <div><label for="e1">Name</label><input id="e1" type="text"></div>
      <div><label for="e2">Gender</label>
        <select id="e2"><option>Male</option><option>Female</option></select></div>
      <div><label for="e3">Email</label><input id="e3" type="email"></div>
      <div><label for="e4">Mobile Phone</label><input id="e4" type="tel"></div>`,

    // 真实浏览器会把游离的 <td> 丢掉，所以包一层 table，保证两端结构一致
    noiseText: `
      <table><tbody><tr>
        <td><span>姓&nbsp;名</span><span class="req">*</span><input id="z1" type="text" placeholder="请输入姓名（必填）"></td>
      </tr></tbody></table>`,

    jobIntent: `
      <div><label for="j1">应聘职位</label><input id="j1" type="text"></div>
      <div><label for="j2">期望工作地点</label><input id="j2" type="text"></div>
      <div><label for="j3">期望薪资</label><input id="j3" type="text"></div>
      <div><label for="j4">最快到岗时间</label><input id="j4" type="text"></div>
      <div><label for="j5">英语等级</label>
        <select id="j5"><option>请选择</option><option>CET-4</option><option>CET-6</option></select></div>
      <div><label for="j6">实习公司名称</label><input id="j6" type="text"></div>
      <div><label for="j7">实习职位</label><input id="j7" type="text"></div>`,

    // 只给出无语义的 name，属于"识别不出来"的正常情况
    opaque: `<div><input type="text" id="o1" name="input_23" class="ipt"></div>`,

    // 出生年月 / 身份证 / 民族 等
    personal: `
      <div><label for="p1">出生年月</label><input id="p1" type="text" placeholder="YYYY-MM"></div>
      <div><label for="p2">身份证号码</label><input id="p2" type="text"></div>
      <div><label for="p3">民族</label><input id="p3" type="text"></div>
      <div><label for="p4">籍贯</label><input id="p4" type="text"></div>
      <div><label for="p5">婚姻状况</label><select id="p5"><option>未婚</option><option>已婚</option></select></div>
      <div><label for="p6">是否服从调剂</label><select id="p6"><option>是</option><option>否</option></select></div>`
  };

  function run(document, M, S) {
    const profile = S.DEFAULT_PROFILE.fields;
    const index = M.buildIndex(S.FIELD_DEFS);
    const results = [];

    // 夹具挂载点：浏览器自测页会提供一个「屏幕外的宿主容器」。
    // 若直接写 document.body.innerHTML，会把页面自己的结果区域一起冲掉，
    // 导致在浏览器里打开自测页只能看到最后一个夹具（Node 侧没这个容器，回退 body）。
    const host = document.getElementById('nrfa-fixture-host') || document.body;
    const mount = (html) => { host.innerHTML = html; };
    const matchOne = (el) => M.matchElement(el, { index: index, threshold: 66 });
    const keyOf = (el) => (matchOne(el) || {}).fieldKey;
    const check = (name, actual, expected) => {
      const a = String(actual);
      const e = String(expected);
      results.push({ name, ok: a === e, actual: a, expected: e });
    };
    const checkTrue = (name, cond, detail) => {
      results.push({ name, ok: !!cond, actual: detail === undefined ? String(!!cond) : String(detail), expected: 'true' });
    };
    const group = (title) => results.push({ group: title });

    /* ---------------- 1. 表格布局 ---------------- */
    group('表格布局（左标签 / 右控件）');
    mount(FIXTURES.tableLayout);
    check('姓名', keyOf(document.getElementById('f1')), 'name');
    check('手机号码', keyOf(document.getElementById('f2')), 'phone');
    check('电子邮箱', keyOf(document.getElementById('f3')), 'email');
    check('紧急联系人姓名 ≠ 姓名', keyOf(document.getElementById('f4')), 'emergencyContactName');
    check('紧急联系人电话 ≠ 手机号', keyOf(document.getElementById('f5')), 'emergencyContactPhone');

    group('表头列布局（thead 定义字段名）');
    mount(FIXTURES.headColumnLayout);
    check('姓名（表头）', keyOf(document.getElementById('h1')), 'name');
    check('最高学历（表头）', keyOf(document.getElementById('h2')), 'degree');
    check('期望城市（表头）', keyOf(document.getElementById('h3')), 'expectedCity');

    group('标签在独立单元格 / 带冒号与必填星号');
    mount(FIXTURES.labelInCell);
    check('所学专业', keyOf(document.getElementById('c1')), 'major');
    check('毕业院校（跨标签节点）', keyOf(document.getElementById('c2')), 'school');
    check('政治面貌：', keyOf(document.getElementById('c3')), 'politicalStatus');

    /* ---------------- 2. label for ---------------- */
    group('label for 布局');
    mount(FIXTURES.labelFor);
    check('毕业院校', keyOf(document.getElementById('a1')), 'school');
    check('所学专业', keyOf(document.getElementById('a2')), 'major');
    check('最高学历（select）', keyOf(document.getElementById('a3')), 'degree');
    check('预计毕业时间', keyOf(document.getElementById('a4')), 'eduEnd');

    /* ---------------- 3. Ant Design 结构 ---------------- */
    group('Ant Design 结构');
    mount(FIXTURES.antdStyle);
    const antInputs = document.querySelectorAll('.ant-input');
    check('期望职位', keyOf(antInputs[0]), 'expectedPosition');
    check('期望城市', keyOf(antInputs[1]), 'expectedCity');

    /* ---------------- 4. 单选组 ---------------- */
    group('单选组');
    mount(FIXTURES.radioGender);
    const radios = document.querySelectorAll('input[name=gender]');
    check('性别（容器文本剔除选项后识别）', (matchOne(radios[0]) || {}).fieldKey, 'gender');
    const optionTexts = Array.prototype.map.call(radios, (r) => r.parentNode.textContent.trim());
    check('选项命中「男」', M.chooseOption('男', optionTexts), '男');

    /* ---------------- 5. 分区推断 ---------------- */
    group('分区推断（教育 / 实习 同名时间字段）');
    mount(FIXTURES.sectioned);
    check('教育-开始时间', keyOf(document.getElementById('s1')), 'eduStart');
    check('教育-结束时间', keyOf(document.getElementById('s2')), 'eduEnd');
    check('实习-开始时间', keyOf(document.getElementById('s3')), 'intern1Start');
    check('实习-结束时间', keyOf(document.getElementById('s4')), 'intern1End');

    /* ---------------- 6. 安全：不该填的绝不填 ---------------- */
    group('安全边界（搜索框 / 验证码 / 密码 / 隐藏项 / 无语义字段）');
    mount(FIXTURES.shouldNotMatch);
    check('搜索职位 → 不匹配', String(matchOne(document.getElementById('n1'))), 'null');
    check('图形验证码 → 不匹配', String(matchOne(document.getElementById('n2'))), 'null');
    check('密码 → 不匹配', String(matchOne(document.getElementById('n3'))), 'null');
    check('确认密码 → 不匹配', String(matchOne(document.getElementById('n4'))), 'null');
    check('display:none → 不匹配', String(matchOne(document.getElementById('n5'))), 'null');
    check('用户名 → 不匹配姓名', String(matchOne(document.getElementById('n6'))), 'null');
    checkTrue('isCandidate 排除隐藏元素', M.isCandidate(document.getElementById('n5'), {}) === false);
    checkTrue('isCandidate 排除密码框', M.isCandidate(document.getElementById('n3'), {}) === false);
    mount(FIXTURES.opaque);
    check('无语义 name=input_23 → 不匹配', String(matchOne(document.getElementById('o1'))), 'null');

    /* ---------------- 7. 控件类型匹配 ---------------- */
    group('控件类型匹配');
    mount(FIXTURES.textareas);
    check('textarea ← 自我评价', keyOf(document.getElementById('t1')), 'selfEvaluation');
    check('textarea ← 专业技能', keyOf(document.getElementById('t2')), 'skills');
    check('input ← 姓名', keyOf(document.getElementById('t3')), 'name');
    check('textarea ← 现居住地', keyOf(document.getElementById('t4')), 'address');

    /* ---------------- 8. 英文表单 ---------------- */
    group('英文表单');
    mount(FIXTURES.englishForm);
    check('Name', keyOf(document.getElementById('e1')), 'name');
    check('Gender', keyOf(document.getElementById('e2')), 'gender');
    check('Email（type=email 只配邮箱字段）', keyOf(document.getElementById('e3')), 'email');
    check('Mobile Phone', keyOf(document.getElementById('e4')), 'phone');

    /* ---------------- 9. 归一化 ---------------- */
    group('文本归一化');
    mount(FIXTURES.noiseText);
    check('"姓 名 * 请输入姓名（必填）"', keyOf(document.getElementById('z1')), 'name');
    check('全角冒号', M.normalize('姓名：'), '姓名');
    check('噪声词', M.normalize('请输入姓名'), '姓名');
    check('星号 + 必填标记', M.normalize('* 手机号码（必填）'), '手机号码');
    check('大小写与连字符', M.normalize('E-mail Address'), 'emailaddress');
    check('全角英数', M.normalize('ＥＭＡＩＬ'), 'email');

    /* ---------------- 10. 求职意向与经历 ---------------- */
    group('求职意向 / 实习经历');
    mount(FIXTURES.jobIntent);
    check('应聘职位', keyOf(document.getElementById('j1')), 'expectedPosition');
    check('期望工作地点', keyOf(document.getElementById('j2')), 'expectedCity');
    check('期望薪资', keyOf(document.getElementById('j3')), 'expectedSalary');
    check('最快到岗时间', keyOf(document.getElementById('j4')), 'availableDate');
    check('英语等级', keyOf(document.getElementById('j5')), 'englishLevel');
    check('实习公司名称', keyOf(document.getElementById('j6')), 'intern1Company');
    check('实习职位', keyOf(document.getElementById('j7')), 'intern1Position');

    /* ---------------- 11. 个人信息 ---------------- */
    group('个人信息');
    mount(FIXTURES.personal);
    check('出生年月', keyOf(document.getElementById('p1')), 'birth');
    check('身份证号码', keyOf(document.getElementById('p2')), 'idCard');
    check('民族', keyOf(document.getElementById('p3')), 'nation');
    check('籍贯', keyOf(document.getElementById('p4')), 'nativePlace');
    check('婚姻状况', keyOf(document.getElementById('p5')), 'maritalStatus');
    check('是否服从调剂', keyOf(document.getElementById('p6')), 'acceptAdjust');

    /* ---------------- 12. 日期格式化 ---------------- */
    group('日期格式化');
    const elWith = (attrs) => {
      const i = document.createElement('input');
      Object.keys(attrs).forEach((k) => i.setAttribute(k, attrs[k]));
      return i;
    };
    check('type=date → YYYY-MM-DD', M.formatValue('2023-09', elWith({ type: 'date' }), { type: 'month' }), '2023-09-01');
    check('type=month → YYYY-MM', M.formatValue('2023-09-15', elWith({ type: 'month' }), { type: 'month' }), '2023-09');
    check('placeholder YYYY-MM', M.formatValue('2023-09', elWith({ placeholder: 'YYYY-MM' }), { type: 'month' }), '2023-09');
    check('placeholder YYYY年MM月', M.formatValue('2023-09', elWith({ placeholder: 'YYYY年MM月' }), { type: 'month' }), '2023年09月');
    check('placeholder YYYY/MM/DD', M.formatValue('2023-09-15', elWith({ placeholder: 'YYYY/MM/DD' }), { type: 'date' }), '2023/09/15');
    check('maxlength=4 只留年', M.formatValue('2023-09', elWith({ maxlength: '4' }), { type: 'month' }), '2023');
    check('"至今" 原样保留', M.formatValue('至今', elWith({}), { type: 'month' }), '至今');
    check('非日期字段不改写', M.formatValue('测试文本', elWith({}), { type: 'text' }), '测试文本');
    check('"2023年9月" → 补零', M.formatValue('2023年9月', elWith({ placeholder: 'YYYY-MM' }), { type: 'month' }), '2023-09');
    check('"202309" → YYYY-MM', M.formatValue('202309', elWith({ placeholder: 'YYYY-MM' }), { type: 'month' }), '2023-09');

    /* ---------------- 13. 选项匹配 ---------------- */
    group('下拉 / 单选选项匹配');
    check('本科 ← 精确', M.chooseOption('本科', ['请选择', '大专', '本科', '硕士研究生']), '本科');
    check('本科 ← 大学本科', M.chooseOption('本科', ['大专', '大学本科', '硕士']), '大学本科');
    check('硕士研究生 ← 硕士', M.chooseOption('硕士研究生', ['本科', '硕士', '博士']), '硕士');
    check('本科 ← 本科（学士）', M.chooseOption('本科', ['专科', '本科（学士）', '硕士']), '本科（学士）');
    check('CET-6 ← 大学英语六级', M.chooseOption('CET-6', ['大学英语四级', '大学英语六级', '无']), '大学英语六级');
    check('男 ← Male', M.chooseOption('男', ['Male', 'Female']), 'Male');
    check('是 ← Yes', M.chooseOption('是', ['Yes', 'No']), 'Yes');
    check('否 ← No', M.chooseOption('否', ['Yes', 'No']), 'No');
    check('找不到 → null', M.chooseOption('火星语', ['甲', '乙']), 'null');
    check('空值 → null', M.chooseOption('', ['甲']), 'null');

    /* ---------------- 14. 空白档案模板 ----------------
       仓库里必须不带任何真实个人数据，否则 clone 的人会把别人的信息填进自己表单。
       这里既检查结构完整，也扫一遍常见个人信息的格式。 */
    group('空白档案模板与隐私');
    const blankKeys = Object.keys(profile);
    check('字段 key 数量与字典一致', blankKeys.length, S.FIELD_DEFS.length);
    check('模板无缺失字段',
      S.FIELD_DEFS.filter((d) => !blankKeys.includes(d.key)).map((d) => d.key).join(','), '');
    check('模板所有值都是空字符串',
      blankKeys.filter((k) => String(profile[k]).trim() !== '').join(','), '');
    checkTrue('模板名字是通用名而非真实姓名',
      /我的档案|未命名|默认/.test(S.DEFAULT_PROFILE.name), S.DEFAULT_PROFILE.name);

    const blob = JSON.stringify(S.DEFAULT_PROFILE);
    const leakPatterns = [
      [/1[3-9]\d{9}/, '手机号'],
      [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, '邮箱'],
      [/\d{17}[\dXx]/, '身份证号'],
      [/\d{16,19}/, '长数字串（银行卡/证件号）']
    ];
    leakPatterns.forEach((pair) => {
      const hit = blob.match(pair[0]);
      checkTrue('档案模板不含' + pair[1], !hit, hit ? hit[0] : '无');
    });

    /* ---------------- 15. 字段字典自检 ---------------- */
    group('字段字典自检');
    const keys = S.FIELD_DEFS.map((d) => d.key);
    checkTrue('字段 key 无重复', new Set(keys).size === keys.length,
      keys.filter((k, i) => keys.indexOf(k) !== i).join(','));
    const noAlias = S.FIELD_DEFS.filter((d) => !(d.aliases || []).length).map((d) => d.key);
    checkTrue('每个字段都有别名', noAlias.length === 0, noAlias.join(','));
    const badGroup = S.FIELD_DEFS.filter((d) => !d.group || !d.label).map((d) => d.key);
    checkTrue('每个字段都有 label 与 group', badGroup.length === 0, badGroup.join(','));

    return results;
  }

  root.NRFA_TEST_CASES = { FIXTURES, run };
})(typeof globalThis !== 'undefined' ? globalThis : this);
