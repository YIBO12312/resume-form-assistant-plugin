/**
 * 一次性脚本：给 schema.js 补上「大厂网申表单」需要的新字段与可重复区块字典。
 * 运行： node tools/add-campus-fields.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(dirname(__dirname), 'src/common/schema.js');
let src = readFileSync(FILE, 'utf8');
const before = src.length;

// 幂等保护：已经加过就不要再加一遍
if (src.includes('校园招聘表单常见补充项')) {
  console.log('schema.js 已经包含校园招聘补充字段，跳过（幂等）');
  process.exit(0);
}

/* ---------------------- 1. address 让出「通讯地址」别名 ---------------------- */
src = src.replace(
  "aliases: ['现居住地', '现居住地址', '居住地址', '通讯地址', '联系地址', '详细地址', '现住址', '家庭住址', '通信地址', '地址'],",
  "aliases: ['现居住地', '现居住地址', '居住地址', '详细地址', '现住址', '家庭住址', '居住地', '地址'],"
);

/* ---------------------- 2. 追加新的标量字段 ---------------------- */
const NEW_FIELDS = `,
    /* ==================== 校园招聘表单常见补充项 ==================== */
    {
      key: 'nationality', label: '国籍', group: '基本信息', type: 'text',
      aliases: ['国籍', '国籍地区'],
      weakAliases: ['nationality'],
      placeholder: '如：中国'
    },
    {
      key: 'idCardType', label: '证件类型', group: '基本信息', type: 'select',
      aliases: ['证件类型', '证件种类', '身份证件类型'],
      options: ['身份证', '护照', '港澳居民来往内地通行证', '台湾居民来往大陆通行证']
    },
    {
      key: 'graduateType', label: '应届 / 往届', group: '基本信息', type: 'select',
      aliases: ['应届往届', '考生类别', '毕业生类型', '毕业类型', '应届生类型'],
      options: ['应届', '往届']
    },
    {
      key: 'mailingAddress', label: '通讯地址 / 邮寄地址', group: '基本信息', type: 'text',
      aliases: ['通讯地址', '通信地址', '邮寄地址', '收件地址', '联系地址'],
      weakAliases: ['mailingaddress'],
      avoid: ['邮箱', '邮件', '网址', '主页'],
      placeholder: '如：江苏省南京市栖霞区某某大学'
    },
    {
      key: 'schoolLocation', label: '毕业院校所在地', group: '教育背景', type: 'text',
      aliases: ['毕业院校所在地', '院校所在地', '学校所在地', '院校地区'],
      placeholder: '如：江苏省南京市'
    },
    {
      key: 'majorCategory', label: '专业类别', group: '教育背景', type: 'text',
      aliases: ['专业类别', '专业大类', '学科类别', '专业门类'],
      placeholder: '如：计算机软件'
    },
    {
      key: 'classSize', label: '班级人数', group: '教育背景', type: 'number',
      aliases: ['班级人数', '班级总人数', '班级人数总计'],
      placeholder: '如：40'
    },
    {
      key: 'classRank', label: '班级排名', group: '教育背景', type: 'text',
      aliases: ['班级排名', '班级名次'],
      placeholder: '如：5/40'
    },
    {
      key: 'verifyCode', label: '学籍 / 学历验证码', group: '教育背景', type: 'text',
      aliases: ['学籍验证码', '学历验证码', '在线验证码', '学籍在线验证码', '验证报告编号'],
      placeholder: '学信网《教育部学籍在线验证报告》上的验证码'
    },
    {
      key: 'verifyCodeExpiry', label: '验证码有效截止日期', group: '教育背景', type: 'date',
      aliases: ['学籍验证码有效截止日期', '验证码有效期', '在线验证报告有效期', '有效期截止日期'],
      placeholder: '如：2026-12-31'
    },
    {
      key: 'languageType', label: '语言类型', group: '自我评价', type: 'text',
      aliases: ['语言类型', '语种', '外语语种'],
      placeholder: '如：英语'
    },
    {
      key: 'languageLevel', label: '语言等级', group: '自我评价', type: 'text',
      aliases: ['语言等级', '语言水平', '外语等级'],
      placeholder: '如：英语六级'
    },
    {
      key: 'languageScore', label: '语言成绩', group: '自我评价', type: 'text',
      aliases: ['语言成绩', '外语成绩', '语言考试分数'],
      placeholder: '如：437'
    },
    {
      key: 'certificateType', label: '证书种类', group: '自我评价', type: 'text',
      aliases: ['证书种类', '证书类别', '证书类型'],
      placeholder: '如：外语证书 / 其他证书'
    },
    {
      key: 'certificateName', label: '证书名称', group: '自我评价', type: 'text',
      aliases: ['证书名称', '证书名', '证书全称'],
      placeholder: '如：大学英语六级（CET-6）'
    },
    {
      key: 'skillName', label: '技能名称', group: '自我评价', type: 'text',
      aliases: ['技能名称', '技能项', '技能点'],
      placeholder: '如：Python'
    },
    {
      key: 'skillLevel', label: '掌握程度', group: '自我评价', type: 'select',
      aliases: ['掌握程度', '熟练程度', '掌握水平', '技能水平'],
      options: ['精通', '熟练', '掌握', '了解']
    },
    {
      key: 'awardName', label: '获奖项', group: '自我评价', type: 'text',
      aliases: ['获奖项', '奖项名称', '获奖名称', '荣誉名称'],
      placeholder: '如：优秀运动员代表'
    },
    {
      key: 'awardLevel', label: '获奖级别', group: '自我评价', type: 'select',
      aliases: ['获奖级别', '奖项级别', '获奖等级', '奖励级别'],
      options: ['国家级', '省级', '市级', '院校级', '院系级', '其他']
    },
    {
      key: 'awardDate', label: '获奖时间', group: '自我评价', type: 'month',
      aliases: ['获奖时间', '获奖日期', '获奖年月', '授奖时间'],
      placeholder: '如：2026-05'
    },
    {
      key: 'overseasStudy', label: '是否为海外留学经历', group: '教育背景', type: 'select',
      aliases: ['是否为海外留学经历', '海外留学经历', '是否海外经历', '留学经历'],
      options: ['是', '否']
    },
    {
      key: 'photoFile', label: '证件照（自动上传）', group: '附件', type: 'file',
      aliases: ['证件照', '免冠照片', '一寸照片', '照片上传', '头像', '个人照片'],
      avoid: ['简历', '附件'],
      placeholder: '在设置页选择本地证件照'
    }
`;

const FIELD_ANCHOR = '\n  ];\n\n  const FIELD_MAP';
if (!src.includes(FIELD_ANCHOR)) throw new Error('找不到 FIELD_DEFS 结束标记');
src = src.replace(FIELD_ANCHOR, NEW_FIELDS + '\n  ];\n\n  const FIELD_MAP');

/* ---------------------- 3. 追加可重复区块字典 ---------------------- */
const LISTS = `
  /**
   * 可重复区块字典（大厂网申必备）
   * ------------------------------------------------------------------
   * 北森 / 大易 / Moka 这类系统里，「教育经历 / 语言能力 / 证书 / 技能 /
   * 获奖情况 / 实习经历 / 工作经历 / 在校实践」都是可以点「添加」加多条的区块，
   * 每一条的字段名完全一样（都叫「学校名称」「开始时间」…）。
   *
   * 处理方式：同一个字段在一页上按 DOM 顺序出现第 N 次，就取第 N 条数据。
   * 所以只要档案里有 N 条，页面上 N 条区块就都能填上。
   *
   * supersedes 列出「本区块有条目时应当被顶替掉的扁平字段」，
   * 避免同一个控件被「单条字段」和「第 N 条区块」同时争抢。
   */
  const LIST_DEFS = [
    {
      key: 'education',
      label: '教育经历',
      hint: '从最高学历往下填；「学历/学位/开始时间」等会按顺序对应页面上的第 1、2… 条',
      supersedes: ['school', 'college', 'major', 'degree', 'academicDegree',
        'eduStart', 'eduEnd', 'gpa', 'eduRank', 'majorCategory', 'schoolLocation',
        'classSize', 'classRank', 'overseasStudy'],
      fields: [
        { key: 'school', label: '学校名称', type: 'text', aliases: ['学校名称', '毕业院校', '就读院校', '学校', '院校'] },
        { key: 'startDate', label: '开始时间', type: 'month', aliases: ['开始时间', '入学时间', '起始时间'] },
        { key: 'endDate', label: '结束时间', type: 'month', aliases: ['结束时间', '毕业时间', '离校时间'] },
        { key: 'major', label: '专业名称', type: 'text', aliases: ['专业名称', '所学专业', '专业'] },
        { key: 'degree', label: '学历', type: 'select', aliases: ['学历', '最高学历'], options: ['大专', '本科', '硕士研究生', '博士研究生'] },
        { key: 'degreeType', label: '学位', type: 'select', aliases: ['学位'], options: ['学士', '硕士', '博士', '无'] },
        { key: 'college', label: '学院名称', type: 'text', aliases: ['学院名称', '所在学院', '学院', '院系'] },
        { key: 'majorCategory', label: '专业类别', type: 'text', aliases: ['专业类别', '专业大类'] },
        { key: 'gpa', label: '成绩（GPA）', type: 'text', aliases: ['成绩gpa', 'gpa', '平均绩点', '平均成绩', '成绩'] },
        { key: 'classSize', label: '班级人数', type: 'number', aliases: ['班级人数'] },
        { key: 'classRank', label: '班级排名', type: 'text', aliases: ['班级排名'] },
        { key: 'eduRank', label: '专业排名', type: 'text', aliases: ['专业排名', '年级排名'] },
        { key: 'overseas', label: '是否为海外留学经历', type: 'select', aliases: ['是否为海外留学经历', '海外留学经历'], options: ['是', '否'] }
      ]
    },
    {
      key: 'internship',
      label: '实习经历',
      hint: '按时间倒序填；页面上的第 N 条实习区块会取这里的第 N 条',
      supersedes: ['intern1Company', 'intern1Position', 'intern1Start', 'intern1End', 'internDuty'],
      fields: [
        { key: 'company', label: '单位名称', type: 'text', aliases: ['单位名称', '公司名称', '实习单位', '实习公司'] },
        { key: 'startDate', label: '开始时间', type: 'month', aliases: ['开始时间', '起始时间'] },
        { key: 'endDate', label: '结束时间', type: 'month', aliases: ['结束时间'] },
        { key: 'position', label: '职位名称', type: 'text', aliases: ['职位名称', '实习职位', '岗位名称', '担任职位'] },
        { key: 'content', label: '实习内容', type: 'textarea', aliases: ['实习内容', '工作内容', '岗位职责', '主要职责', '工作描述'] }
      ]
    },
    {
      key: 'job',
      label: '工作经历',
      hint: '正式工作/全职经历，没有就留空',
      supersedes: [],
      fields: [
        { key: 'company', label: '公司名称', type: 'text', aliases: ['公司名称', '单位名称'] },
        { key: 'position', label: '职位名称', type: 'text', aliases: ['职位名称', '职位', '岗位'] },
        { key: 'startDate', label: '开始时间', type: 'month', aliases: ['开始时间'] },
        { key: 'endDate', label: '结束时间', type: 'month', aliases: ['结束时间'] },
        { key: 'duty', label: '工作职责', type: 'textarea', aliases: ['工作职责', '工作内容', '岗位职责'] }
      ]
    },
    {
      key: 'project',
      label: '项目经历',
      hint: '页面上「项目名称 / 项目描述」重复出现时，会按顺序取这里的第 N 条',
      supersedes: ['projectName', 'projectRole'],
      fields: [
        { key: 'name', label: '项目名称', type: 'text', aliases: ['项目名称', '项目课题'] },
        { key: 'role', label: '项目角色', type: 'text', aliases: ['项目角色', '担任角色'] },
        { key: 'startDate', label: '开始时间', type: 'month', aliases: ['开始时间', '项目开始时间'] },
        { key: 'endDate', label: '结束时间', type: 'month', aliases: ['结束时间', '项目结束时间'] },
        { key: 'description', label: '项目描述', type: 'textarea', aliases: ['项目描述', '项目内容', '项目介绍', '项目职责'] }
      ]
    },
    {
      key: 'language',
      label: '语言能力',
      supersedes: ['languageType', 'languageLevel', 'languageScore', 'languageSkill'],
      fields: [
        { key: 'type', label: '语言类型', type: 'text', aliases: ['语言类型', '语种'] },
        { key: 'level', label: '语言等级', type: 'text', aliases: ['语言等级', '语言水平'] },
        { key: 'score', label: '语言成绩', type: 'text', aliases: ['语言成绩', '考试分数'] },
        { key: 'certificate', label: '语言证书', type: 'text', aliases: ['语言证书', '证书名称'] }
      ]
    },
    {
      key: 'certificate',
      label: '证书',
      supersedes: ['certificateType', 'certificateName'],
      fields: [
        { key: 'type', label: '证书种类', type: 'text', aliases: ['证书种类', '证书类别', '证书类型'] },
        { key: 'name', label: '证书名称', type: 'text', aliases: ['证书名称', '证书名', '证书全称'] },
        { key: 'date', label: '获得时间', type: 'month', aliases: ['获得时间', '发证时间', '取证时间'] }
      ]
    },
    {
      key: 'skill',
      label: '技能',
      supersedes: ['skillName', 'skillLevel'],
      fields: [
        { key: 'name', label: '技能名称', type: 'text', aliases: ['技能名称', '技能项', '技能'] },
        { key: 'level', label: '掌握程度', type: 'select', aliases: ['掌握程度', '熟练程度', '掌握水平'], options: ['精通', '熟练', '掌握', '了解'] }
      ]
    },
    {
      key: 'award',
      label: '获奖情况',
      supersedes: ['awardName', 'awardLevel', 'awardDate'],
      fields: [
        { key: 'name', label: '获奖项', type: 'text', aliases: ['获奖项', '奖项名称', '获奖名称', '荣誉名称'] },
        { key: 'level', label: '获奖级别', type: 'select', aliases: ['获奖级别', '奖项级别', '获奖等级'], options: ['国家级', '省级', '市级', '院校级', '院系级', '其他'] },
        { key: 'date', label: '获奖时间', type: 'month', aliases: ['获奖时间', '获奖日期'] }
      ]
    },
    {
      key: 'practice',
      label: '在校实践',
      supersedes: ['campusExperience'],
      fields: [
        { key: 'name', label: '实践名称', type: 'text', aliases: ['实践名称', '活动名称', '项目名称'] },
        { key: 'startDate', label: '开始时间', type: 'month', aliases: ['开始时间'] },
        { key: 'endDate', label: '结束时间', type: 'month', aliases: ['结束时间'] },
        { key: 'description', label: '实践描述', type: 'textarea', aliases: ['实践描述', '实践内容', '活动描述'] }
      ]
    }
  ];

  const LIST_MAP = {};
  LIST_DEFS.forEach(function (l) { LIST_MAP[l.key] = l; });

  /** 把区块字典展平成「带 listKey/itemKey 的伪字段」，供识别引擎使用 */
  function listItemFields() {
    const out = [];
    LIST_DEFS.forEach(function (list) {
      list.fields.forEach(function (f) {
        out.push({
          key: list.key + '.' + f.key,
          label: list.label + ' · ' + f.label,
          group: '可重复区块',
          type: f.type,
          aliases: f.aliases,
          options: f.options,
          multiline: f.type === 'textarea',
          listKey: list.key,
          itemKey: f.key,
          placeholder: f.placeholder || ''
        });
      });
    });
    return out;
  }

  /** 某个区块非空时，应当被顶替掉的扁平字段 key 集合 */
  function supersededKeys(lists) {
    const dead = {};
    LIST_DEFS.forEach(function (list) {
      const items = lists && lists[list.key];
      if (!Array.isArray(items) || !items.length) return;
      (list.supersedes || []).forEach(function (k) { dead[k] = 1; });
    });
    return dead;
  }
`;

const MAP_ANCHOR = '  const FIELD_MAP = {};';
if (!src.includes(MAP_ANCHOR)) throw new Error('找不到 FIELD_MAP 标记');
src = src.replace(MAP_ANCHOR, LISTS + '\n' + MAP_ANCHOR);

/* ---------------------- 4. 导出新增内容 ---------------------- */
src = src.replace(
  `  return {
    FIELD_DEFS: FIELD_DEFS,
    FIELD_MAP: FIELD_MAP,
    GROUPS: GROUPS,`,
  `  return {
    FIELD_DEFS: FIELD_DEFS,
    FIELD_MAP: FIELD_MAP,
    GROUPS: GROUPS,
    LIST_DEFS: LIST_DEFS,
    LIST_MAP: LIST_MAP,
    listItemFields: listItemFields,
    supersededKeys: supersededKeys,`
);

writeFileSync(FILE, src, 'utf8');
console.log(`schema.js: ${before} → ${src.length} 字节`);
