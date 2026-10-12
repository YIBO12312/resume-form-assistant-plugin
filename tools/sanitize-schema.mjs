/**
 * 把 schema.js 里预置的个人档案替换成"从 FIELD_DEFS 自动生成的空白模板"。
 * 之所以自动生成而不是手写：手写会随着字段增删而漂移，
 * 自动生成可以保证模板永远覆盖全部字段，且永远没有真实数据。
 *
 * 运行： node tools/sanitize-schema.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FILE = join(ROOT, 'src/common/schema.js');

const src = readFileSync(FILE, 'utf8');

const START = '  /** 富文本整段内容，供预置档案使用 */';
const END = '  /** 默认全局设置 */';

const startIdx = src.indexOf(START);
const endIdx = src.indexOf(END);
if (startIdx < 0) throw new Error('找不到起始标记，schema.js 可能已被改动');
if (endIdx < 0) throw new Error('找不到结束标记，schema.js 可能已被改动');
if (endIdx < startIdx) throw new Error('标记顺序异常');

const replacement = `  /**
   * 空白档案模板。
   * ------------------------------------------------------------------
   * 仓库里刻意不带任何真实个人数据：所有字段一律为空字符串，
   * 谁 clone 下来用都不会把别人的信息填进自己的表单。
   * 字段列表由 FIELD_DEFS 自动生成，增删字段时不会漏项。
   *
   * 填入数据的三种方式：
   *   1. 装好后在设置页「档案字段」逐项填写（左下角会提示还差哪些必填项）
   *   2. 设置页 →「导入 / 导出」→ 导入 examples/demo-profile.json（示例数据，可直接看效果）
   *   3. 投不同方向时点「复制当前档案」，各存一份，改掉「期望职位 / 专业技能」
   */
  const DEFAULT_PROFILE = {
    id: 'default',
    name: '我的档案',
    updatedAt: 0,
    fields: (function () {
      const blank = {};
      FIELD_DEFS.forEach(function (d) { blank[d.key] = ''; });
      return blank;
    })()
  };

`;

const out = src.slice(0, startIdx) + replacement + src.slice(endIdx);
writeFileSync(FILE, out, 'utf8');

console.log('已替换 schema.js 中的预置档案为空白模板');
console.log('原文件 ' + src.length + ' 字节 → 新文件 ' + out.length + ' 字节');
