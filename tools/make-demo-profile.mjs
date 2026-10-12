/**
 * 生成 examples/demo-profile.json —— 一份**完全虚构**的示例档案。
 * 用途：让刚 clone 下来的人能一键导入、马上看到"填好的档案长什么样"。
 * 里面的人名、手机、邮箱、学校、公司全部是编的，不能是任何真实信息。
 *
 * 运行： node tools/make-demo-profile.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const sandbox = { globalThis: null, console, JSON, Object, Array, String };
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);
vm.runInContext(readFileSync(join(ROOT, 'src/common/schema.js'), 'utf8'), ctx, { filename: 'schema.js' });
const S = ctx.NRFA_SCHEMA;

/* 全部虚构：张三 / 13800138000 / 示例大学 / 某某科技有限公司 */
const DEMO = {
  name: '张三',
  englishName: 'Zhang San',
  gender: '男',
  birth: '2003-05',
  age: '23',
  nation: '汉族',
  nativePlace: '江苏南京',
  hukou: '江苏省南京市',
  politicalStatus: '共青团员',
  maritalStatus: '未婚',
  height: '175',
  weight: '65',
  address: '江苏省南京市示例区示例路 1 号',
  postalCode: '210000',

  phone: '13800138000',
  email: 'zhangsan@example.com',
  wechat: 'zhangsan_demo',
  qq: '100000000',
  blog: 'https://github.com/example',
  emergencyContactName: '李四',
  emergencyContactPhone: '13900139000',
  emergencyContactRelation: '父子',

  school: '示例大学',
  college: '计算机学院',
  major: '软件工程',
  degree: '本科',
  academicDegree: '学士',
  eduStart: '2021-09',
  eduEnd: '2025-06',
  gpa: '3.6/4.0',
  eduRank: '8/120',
  englishLevel: 'CET-6',
  englishScore: '512',
  computerLevel: '二级',

  jobType: '实习',
  expectedPosition: '后端开发实习生',
  expectedCity: '南京',
  expectedSalary: '面议',
  availableDate: '随时到岗，每周可实习 5 天',
  jobSource: '校园招聘',
  acceptAdjust: '是',

  intern1Company: '某某科技有限公司',
  intern1Position: '后端开发实习生',
  intern1Start: '2024-07',
  intern1End: '2024-09',
  internSummary: [
    '某某科技有限公司 | 后端开发实习生 | 2024.07 - 2024.09',
    '参与订单中心重构，负责接口开发与联调。',
    '• 接口开发：基于 Spring Boot 完成 12 个 REST 接口，补充单元测试，覆盖率达到 80%。',
    '• 性能优化：定位并修复 3 处慢 SQL，列表接口平均响应时间从 800ms 降到 150ms。',
    '• 文档输出：整理接口文档与部署手册，被后续实习生直接复用。'
  ].join('\n'),
  internDuty: [
    '某某科技有限公司 · 后端开发实习生（2024.07-2024.09）',
    '• 接口开发：基于 Spring Boot 完成 12 个 REST 接口，补充单元测试，覆盖率达到 80%。',
    '• 性能优化：定位并修复 3 处慢 SQL，列表接口平均响应时间从 800ms 降到 150ms。',
    '• 文档输出：整理接口文档与部署手册，被后续实习生直接复用。'
  ].join('\n'),

  projectName: '示例数据看板',
  projectRole: '独立开发',
  projectSummary: [
    '示例数据看板：实时指标监控平台 | 独立开发 | 2024.03 - 2024.06',
    '项目背景：业务方缺少统一的实时指标看板，数据分散在多个系统里，无法快速定位异常。',
    '• 数据链路：使用 Kafka 接收埋点数据，Flink 做实时清洗与聚合，结果写入 MySQL 供查询。',
    '• 后端服务：Spring Boot 提供指标查询接口，Redis 缓存热点数据，QPS 提升约 3 倍。',
    '• 前端大屏：Vue3 + ECharts 实现 8 类核心指标展示，支持时间范围切换与阈值告警。',
    '成果：看板上线后异常发现时间从小时级缩短到分钟级，被 3 个业务团队日常使用。'
  ].join('\n'),

  selfEvaluation: [
    '软件工程本科在读，有两段企业实习经历，能独立承担接口开发、联调与文档输出。',
    '动手能力强，习惯把问题追到根因：曾通过分析慢查询日志把接口响应时间压缩到原来的五分之一。',
    '对后端工程化有持续投入，熟悉 Spring Boot 与常见中间件，能独立完成从开发到部署的完整流程。',
    '沟通与文档能力扎实，整理的接口文档与部署手册被团队直接复用。'
  ].join('\n'),

  skills: [
    '• 后端：Java、Spring Boot、MyBatis，MySQL、Redis',
    '• 数据：Kafka、Flink 实时链路开发，Kettle 数据同步',
    '• 前端：Vue3、ECharts 数据大屏',
    '• 工具：Git、Linux 常用运维命令、Postman / Apifox 接口联调',
    '• 语言：英语 CET-6，可阅读英文技术文档'
  ].join('\n'),

  awards: '示例一等奖学金（2022）；示例程序设计竞赛二等奖（2023）',
  campusExperience: '担任班级学习委员，组织期末互助复习；参与校园开放日志愿服务 2 次。',
  certificate: '大学英语六级（CET-6）；全国计算机等级考试二级',
  languageSkill: '英语（CET-6，可阅读英文技术文档）',
  hobby: '跑步、开源项目、技术文档写作',

  resumeFile: ''
};

const profile = {
  id: 'demo',
  name: '示例档案（张三 · 虚构数据）',
  updatedAt: 0,
  fields: {}
};
S.FIELD_DEFS.forEach((d) => { profile.fields[d.key] = ''; });
Object.keys(DEMO).forEach((k) => {
  if (!(k in profile.fields)) throw new Error('示例里出现了字典中没有的字段：' + k);
  profile.fields[k] = DEMO[k];
});

const missingRequired = S.FIELD_DEFS
  .filter((d) => d.required && !String(profile.fields[d.key] || '').trim())
  .map((d) => d.label);
if (missingRequired.length) throw new Error('示例档案缺少必填项：' + missingRequired.join('、'));

const payload = {
  app: '网申助手 Resume Form Assistant',
  version: 1,
  exportedAt: new Date(0).toISOString(),
  note: '这是完全虚构的示例档案（张三 / 13800138000 / 示例大学），仅用于演示格式。' +
    '在扩展设置页「导入 / 导出」里导入后，请把每一项改成你自己的信息。',
  settings: Object.assign({}, JSON.parse(JSON.stringify(S.DEFAULT_SETTINGS)), { activeProfileId: 'demo' }),
  profiles: [profile]
};

mkdirSync(join(ROOT, 'examples'), { recursive: true });
const out = join(ROOT, 'examples', 'demo-profile.json');
writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');

const filled = Object.keys(profile.fields).filter((k) => String(profile.fields[k]).trim() !== '');
console.log('已生成 ' + out);
console.log('非空字段 ' + filled.length + ' / ' + S.FIELD_DEFS.length + '，必填项齐全');
