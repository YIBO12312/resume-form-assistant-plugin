/**
 * 把 schema.js / matcher.js / cases.js 组装成一个自包含的浏览器自测页，
 * 让用户可以在自己的 Edge/Chrome 里复核识别引擎（不依赖 Node、不联网）。
 * 运行： node tools/build-test-page.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const schema = read('src/common/schema.js');
const matcher = read('src/common/matcher.js');
const cases = read('tests/cases.js');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>网申助手 · 识别引擎自测</title>
<style>
  :root { --green:#16a34a; --red:#dc2626; --ink:#111827; --muted:#6b7280; --line:#e5e7eb; --blue:#2563eb; }
  * { box-sizing: border-box; }
  body { margin:0; padding:28px 32px 60px; background:#f6f7f9; color:var(--ink);
         font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif; font-size:14px; }
  h1 { margin:0 0 4px; font-size:20px; }
  .sub { color:var(--muted); font-size:13px; margin-bottom:18px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px 22px; max-width:1000px; }
  .summary { display:flex; gap:22px; align-items:center; flex-wrap:wrap; margin-bottom:6px; }
  .big { font-size:30px; font-weight:800; }
  .big.ok { color:var(--green); }
  .big.bad { color:var(--red); }
  .bar { height:10px; border-radius:6px; background:#e5e7eb; overflow:hidden; margin:12px 0 20px; }
  .bar i { display:block; height:100%; background:var(--green); transition:width .4s ease; }
  h2 { font-size:14px; margin:22px 0 8px; padding-bottom:6px; border-bottom:1px dashed var(--line); color:var(--blue); }
  .case { display:flex; gap:9px; padding:5px 0; font-size:13px; align-items:baseline; }
  .case .m { flex:none; width:16px; }
  .case.fail { color:var(--red); }
  .case.fail .detail { display:block; color:#7f1d1d; font-size:12px; margin-top:2px; }
  .detail { display:none; }
  .note { font-size:12.5px; color:var(--muted); line-height:1.8; margin-top:18px; }
  code { background:#f3f4f6; padding:1px 5px; border-radius:4px; font-size:12px; }
</style>
</head>
<body>
  <h1>网申助手 · 识别引擎自测</h1>
  <div class="sub" id="env">正在运行…</div>
  <div class="card">
    <div class="summary">
      <div><span class="big" id="pass">–</span> <span style="color:var(--muted)">通过</span></div>
      <div><span class="big bad" id="fail">–</span> <span style="color:var(--muted)">失败</span></div>
      <div id="verdict" style="font-weight:700"></div>
    </div>
    <div class="bar"><i id="bar" style="width:0%"></i></div>
    <div id="results"></div>
    <div class="note">
      这些用例覆盖真实的网申表单结构：左标签右控件表格、thead 表头列、label for、
      Ant Design 结构、单选组、分区标题下的同名时间字段、日期格式改写、下拉选项模糊匹配，
      以及「搜索框 / 验证码 / 密码 / 隐藏元素 / 无语义 name」这些绝不能误填的情况。<br>
      页面只在本机运行，不会发起任何网络请求。
    </div>
  </div>

<script>
${schema}
</script>
<script>
${matcher}
</script>
<script>
${cases}
</script>
<script>
(function () {
  var out = document.getElementById('results');
  var results;
  try {
    results = NRFA_TEST_CASES.run(document, NRFA_MATCHER, NRFA_SCHEMA);
  } catch (e) {
    document.getElementById('env').textContent = '运行出错：' + e.message;
    return;
  }
  var pass = results.filter(function (r) { return r.ok; }).length;
  var fail = results.length - pass;
  document.getElementById('pass').textContent = pass;
  document.getElementById('fail').textContent = fail;
  document.getElementById('fail').className = 'big ' + (fail ? 'bad' : '');
  document.getElementById('bar').style.width = Math.round(pass / results.length * 100) + '%';
  document.getElementById('verdict').textContent = fail ? '有 ' + fail + ' 项未通过' : '全部通过 🎉';
  document.getElementById('verdict').style.color = fail ? 'var(--red)' : 'var(--green)';

  var html = '';
  results.forEach(function (r) {
    if (r.group) { html += '<h2>' + r.group + '</h2>'; return; }
    html += '<div class="case ' + (r.ok ? '' : 'fail') + '">'
      + '<span class="m">' + (r.ok ? '✅' : '❌') + '</span>'
      + '<span>' + r.name
      + '<span class="detail">期望：' + r.expected + ' ／ 实际：' + r.actual + '</span>'
      + '</span></div>';
  });
  out.innerHTML = html;

  document.getElementById('env').textContent =
    '运行环境：' + navigator.userAgent + '　·　用例总数 ' + results.length;
})();
</script>
</body>
</html>
`;

const target = join(ROOT, 'tests', 'engine-test.html');
writeFileSync(target, html, 'utf8');
console.log('已生成 ' + target + '（' + html.length + ' 字节）');
