/**
 * 生成 examples/demo-form.html —— 一个自包含的在线演示页。
 *
 * 用途：
 *   1. 让来看仓库的人不装插件也能点开看到「识别 + 填充面板」的真实效果
 *   2. 作为作品集/项目材料的截图来源（用无头浏览器渲染）
 *
 * 做法：把 schema.js / matcher.js / content.js 内联进页面，并用一个内存版
 * chrome.storage 桩把示例档案喂给内容脚本；页面里放一份模拟的网申表单
 * （表格布局 + Ant Design 结构 + 北森式只读下拉 + 可重复区块）。
 *
 * 运行： node tools/build-demo-page.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const schema = read('src/common/schema.js');
const matcher = read('src/common/matcher.js');
const content = read('src/content/content.js');
const demoProfile = read('examples/demo-profile.json');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>网申助手 · 在线演示</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 28px 32px 80px; background: #f4f6f9; color: #111827;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; font-size: 14px;
  }
  .page { max-width: 940px; margin: 0 auto; }
  .topbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px 20px; margin-bottom: 18px;
  }
  .topbar h1 { margin: 0 0 4px; font-size: 17px; }
  .topbar p { margin: 0; font-size: 12.5px; color: #6b7280; line-height: 1.7; }
  .btn {
    flex: none; padding: 9px 16px; border-radius: 9px; border: 1px solid #2563eb;
    background: #2563eb; color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit;
  }
  .btn.ghost { background: #fff; color: #2563eb; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 14px; padding: 20px 22px; margin-bottom: 16px; }
  .card > h2 { margin: 0 0 14px; font-size: 15px; color: #1f4e79; }
  table.form { width: 100%; border-collapse: collapse; }
  table.form th, table.form td { text-align: left; padding: 9px 10px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  table.form th { width: 132px; font-weight: 500; color: #374151; font-size: 13px; }
  table.form th .req { color: #dc2626; margin-right: 3px; }
  input[type=text], select, textarea {
    width: 100%; max-width: 340px; padding: 7px 10px; border: 1px solid #d1d5db; border-radius: 8px;
    font-size: 13px; font-family: inherit; color: #111827; background: #fff;
  }
  textarea { max-width: 100%; min-height: 62px; resize: vertical; }
  .ant-form-item { display: grid; grid-template-columns: 132px 1fr; gap: 10px; padding: 9px 10px; border-bottom: 1px solid #f1f5f9; align-items: center; }
  .ant-form-item-label label { font-size: 13px; color: #374151; }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 22px; }
  .block { border: 1px dashed #dbe3ec; border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; background: #fbfcfe; }
  .block-title { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
  .hint { font-size: 12px; color: #9ca3af; margin-top: 10px; line-height: 1.8; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
</head>
<body>
<div class="page">

  <div class="topbar">
    <div>
      <h1>网申助手 · 在线演示</h1>
      <p>这是一个纯前端演示页：下面是一份模拟的网申表单，右下角会出现插件悬浮球。<br>
         点「预览识别结果」可以看到插件识别出了哪些字段、每个字段靠什么认出来的、置信度多少。</p>
    </div>
    <div style="display:flex;gap:8px;flex:none">
      <button class="btn ghost" id="btnPreview">预览识别结果</button>
      <button class="btn" id="btnFill">一键填充</button>
    </div>
  </div>

  <div class="card">
    <h2>个人信息（表格布局）</h2>
    <table class="form">
      <tr><th><span class="req">*</span>姓名</th><td><input type="text" id="d_name" placeholder="请输入姓名"></td></tr>
      <tr><th><span class="req">*</span>性别</th><td>
        <label style="margin-right:16px"><input type="radio" name="d_gender"> 男</label>
        <label><input type="radio" name="d_gender"> 女</label>
      </td></tr>
      <tr><th><span class="req">*</span>手机号码</th><td><input type="text" id="d_phone" placeholder="请输入手机号" maxlength="11"></td></tr>
      <tr><th><span class="req">*</span>电子邮箱</th><td><input type="text" id="d_email" placeholder="请输入邮箱"></td></tr>
      <tr><th>出生年月</th><td><input type="text" id="d_birth" placeholder="YYYY-MM"></td></tr>
      <tr><th>政治面貌</th><td>
        <div class="phoenix-select" style="max-width:340px">
          <input type="text" id="d_politics" readonly placeholder="请选择" style="cursor:pointer">
        </div>
      </td></tr>
    </table>
  </div>

  <div class="card">
    <h2>教育背景（Ant Design 结构）</h2>
    <div class="ant-form-item">
      <div class="ant-form-item-label"><label>毕业院校</label></div>
      <div class="ant-form-item-control"><input class="ant-input" type="text" placeholder="请输入毕业院校"></div>
    </div>
    <div class="ant-form-item">
      <div class="ant-form-item-label"><label>所学专业</label></div>
      <div class="ant-form-item-control"><input class="ant-input" type="text" placeholder="请输入专业"></div>
    </div>
    <div class="ant-form-item">
      <div class="ant-form-item-label"><label>最高学历</label></div>
      <div class="ant-form-item-control">
        <select id="d_degree">
          <option value="">请选择</option><option>大专</option><option>本科</option><option>硕士研究生</option>
        </select>
      </div>
    </div>
    <div class="ant-form-item">
      <div class="ant-form-item-label"><label>预计毕业时间</label></div>
      <div class="ant-form-item-control"><input class="ant-input" type="text" placeholder="YYYY-MM"></div>
    </div>
  </div>

  <div class="card">
    <h2>实习经历（可重复区块 · 页面上第 N 条对应档案里第 N 条）</h2>
    <div class="block">
      <div class="block-title">第 1 条</div>
      <div class="row2">
        <div><th style="all:unset;font-size:12.5px;color:#374151">单位名称</th><input type="text" id="d_int1"></div>
        <div><th style="all:unset;font-size:12.5px;color:#374151">职位名称</th><input type="text" id="d_int1p"></div>
        <div><th style="all:unset;font-size:12.5px;color:#374151">开始时间</th><input type="text" id="d_int1s" placeholder="YYYY-MM"></div>
        <div><th style="all:unset;font-size:12.5px;color:#374151">结束时间</th><input type="text" id="d_int1e" placeholder="YYYY-MM"></div>
      </div>
    </div>
    <div class="block">
      <div class="block-title">第 2 条</div>
      <div class="row2">
        <div><th style="all:unset;font-size:12.5px;color:#374151">单位名称</th><input type="text" id="d_int2"></div>
        <div><th style="all:unset;font-size:12.5px;color:#374151">职位名称</th><input type="text" id="d_int2p"></div>
        <div><th style="all:unset;font-size:12.5px;color:#374151">开始时间</th><input type="text" id="d_int2s" placeholder="YYYY-MM"></div>
        <div><th style="all:unset;font-size:12.5px;color:#374151">结束时间</th><input type="text" id="d_int2e" placeholder="YYYY-MM"></div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>其他</h2>
    <table class="form">
      <tr><th>自我评价</th><td><textarea id="d_self" placeholder="请输入自我评价"></textarea></td></tr>
      <tr><th>期望城市</th><td><input type="text" id="d_city" placeholder="请输入期望城市"></td></tr>
      <tr><th>简历附件</th><td><input type="file" id="d_cv"></td></tr>
      <tr><th>搜索职位</th><td><input type="text" id="d_search" placeholder="这个框不该被填充"><div class="hint">↑ 这一栏用来演示「搜索框不会被误填」</div></td></tr>
    </table>
  </div>

  <p class="hint">
    演示说明：本页把 <code>schema.js</code> / <code>matcher.js</code> / <code>content.js</code> 内联进来，
    并用内存版 <code>chrome.storage</code> 喂入 <code>examples/demo-profile.json</code> 的示例档案（虚构的「张三」）。
    没有网络请求，不会上传任何数据。
  </p>
</div>

<script>
/* ---------- 内存版 chrome.storage 桩（只为让演示页能跑） ---------- */
(function () {
  var payload = ${demoProfile};
  var store = {
    nrfa_settings: payload.settings,
    nrfa_profiles: payload.profiles,
    nrfa_resume: null,
    nrfa_photo: null
  };
  window.chrome = {
    storage: {
      local: {
        get: function (keys, cb) {
          var out = {};
          var list = Array.isArray(keys) ? keys : (typeof keys === 'string' ? [keys] : Object.keys(keys || {}));
          list.forEach(function (k) { if (store[k] !== undefined) out[k] = store[k]; });
          setTimeout(function () { cb(out); }, 0);
        },
        set: function (obj, cb) { Object.assign(store, obj); setTimeout(function () { cb && cb(); }, 0); }
      }
    },
    runtime: { id: 'demo', getURL: function (p) { return p; } }
  };
})();
</script>
<script>
${schema}
</script>
<script>
${matcher}
</script>
<script>
${content}
</script>

<script>
/* ---------- 北森式只读下拉：点开才出现选项 ---------- */
(function () {
  var input = document.getElementById('d_politics');
  var popup = null;
  input.addEventListener('click', function () {
    if (popup) return;
    popup = document.createElement('div');
    popup.style.cssText = 'position:absolute;background:#fff;border:1px solid #d1d5db;border-radius:8px;' +
      'box-shadow:0 8px 24px rgba(15,23,42,.14);padding:4px;z-index:99999;min-width:160px';
    popup.className = 'phoenix-select-dropdown';
    var rect = input.getBoundingClientRect();
    popup.style.left = (rect.left + window.scrollX) + 'px';
    popup.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    ['中共党员', '共青团员', '民主党派', '群众'].forEach(function (t) {
      var o = document.createElement('div');
      o.setAttribute('role', 'option');
      o.className = 'phoenix-select-option';
      o.textContent = t;
      o.style.cssText = 'padding:7px 12px;border-radius:6px;cursor:pointer;font-size:13px';
      o.addEventListener('mouseenter', function () { o.style.background = '#f3f4f6'; });
      o.addEventListener('mouseleave', function () { o.style.background = ''; });
      o.addEventListener('click', function () {
        input.value = t;
        document.body.removeChild(popup); popup = null;
      });
      popup.appendChild(o);
    });
    document.body.appendChild(popup);
  });
})();

/* ---------- 顶部按钮 ---------- */
document.getElementById('btnPreview').addEventListener('click', function () {
  if (window.__NRFA__) window.__NRFA__.preview();
});
document.getElementById('btnFill').addEventListener('click', function () {
  if (window.__NRFA__) window.__NRFA__.fill();
});

/* ---------- 演示页加载后自动打开面板（便于截图/演示） ---------- */
window.addEventListener('load', function () {
  setTimeout(function () { if (window.__NRFA__) window.__NRFA__.preview(); }, 600);
});
</script>
</body>
</html>
`;

const target = join(ROOT, 'examples', 'demo-form.html');
writeFileSync(target, html, 'utf8');
console.log('已生成 ' + target + '（' + Math.round(html.length / 1024) + ' KB）');
