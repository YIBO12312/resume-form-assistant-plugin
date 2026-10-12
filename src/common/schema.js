/**
 * 网申助手 · 字段字典
 * ------------------------------------------------------------------
 * 定义网申表单里会遇到的字段：key / 中文标签 / 分组 / 控件类型 / 别名 / 互斥词。
 * matcher.js 会用 aliases 去匹配页面上的元素，用 avoid 排除误匹配。
 *
 * 该文件同时兼容：
 *   - 扩展 content script（挂到 globalThis.NRFA_SCHEMA）
 *   - Node 单元测试（module.exports）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NRFA_SCHEMA = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * 控件类型说明：
   *   text / textarea / tel / email / url / number：文本类
   *   date / month / year：日期类，会按目标控件格式自动改写
   *   select / radio / checkbox：选项类，会按文本匹配选项
   *   file：文件类，用于自动挂载简历附件
   */
  const FIELD_DEFS = [
    /* ============================ 基本信息 ============================ */
    {
      key: 'name', label: '姓名', group: '基本信息', type: 'text', required: true,
      aliases: ['姓名', '真实姓名', '名字', '中文名', '本人姓名', '申请人姓名'],
      // 英文别名一律放进 weakAliases：它们太通用，若与 name/id/class 属性同权重，
      // name="userName"、class="schoolname" 之类的弱来源会误触发。
      weakAliases: ['name', 'fullname', 'chinesename', 'yourname'],
      avoid: ['紧急联系人', '联系人', '父亲', '母亲', '监护人', '推荐人', '负责人', '用户名', '昵称', '英文', '拼音', '学校', '公司', '项目'],
      placeholder: '请输入姓名'
    },
    {
      key: 'englishName', label: '英文名 / 姓名拼音', group: '基本信息', type: 'text',
      aliases: ['英文名', '英文姓名', '姓名拼音', '拼音', '姓名的拼音'],
      placeholder: '如：Zhang San'
    },
    {
      key: 'gender', label: '性别', group: '基本信息', type: 'select', required: true,
      aliases: ['性别'],
      weakAliases: ['gender', 'sex'],
      options: ['男', '女']
    },
    {
      key: 'birth', label: '出生年月', group: '基本信息', type: 'month', required: true,
      aliases: ['出生年月日', '出生年月', '出生日期', '出生时间', '生日', '出生'],
      placeholder: '如：2003-05'
    },
    {
      key: 'age', label: '年龄', group: '基本信息', type: 'number',
      aliases: ['年龄'],
      placeholder: '如：23'
    },
    {
      key: 'idCard', label: '身份证号', group: '基本信息', type: 'text',
      aliases: ['身份证号码', '身份证号', '证件号码', '身份证件号', '身份证'],
      avoid: ['学号', '工号'],
      placeholder: '18 位身份证号'
    },
    {
      key: 'nation', label: '民族', group: '基本信息', type: 'select',
      aliases: ['民族'],
      options: ['汉族', '回族', '满族', '蒙古族', '壮族', '维吾尔族', '其他']
    },
    {
      key: 'nativePlace', label: '籍贯', group: '基本信息', type: 'text',
      aliases: ['籍贯', '祖籍', '出生地', '生源地'],
      placeholder: '如：江苏南京'
    },
    {
      key: 'hukou', label: '户口所在地', group: '基本信息', type: 'text',
      aliases: ['户口所在地', '户籍所在地', '户口所在', '户籍'],
      placeholder: '如：江苏省南京市'
    },
    {
      key: 'politicalStatus', label: '政治面貌', group: '基本信息', type: 'select',
      aliases: ['政治面貌'],
      options: ['中共党员', '中共预备党员', '共青团员', '民主党派', '群众']
    },
    {
      key: 'maritalStatus', label: '婚姻状况', group: '基本信息', type: 'select',
      aliases: ['婚姻状况', '婚否', '婚姻'],
      options: ['未婚', '已婚', '离异']
    },
    {
      key: 'height', label: '身高(cm)', group: '基本信息', type: 'number',
      aliases: ['身高'], placeholder: '如：175'
    },
    {
      key: 'weight', label: '体重(kg)', group: '基本信息', type: 'number',
      aliases: ['体重'], placeholder: '如：65'
    },
    {
      key: 'address', label: '现居住地 / 通讯地址', group: '基本信息', type: 'text',
      aliases: ['现居住地', '现居住地址', '居住地址', '通讯地址', '联系地址', '详细地址', '现住址', '家庭住址', '通信地址', '地址'],
      weakAliases: ['address', 'currentaddress', 'homeaddress', 'mailingaddress'],
      avoid: ['邮箱', '邮件', '网址', '主页', '学校地址', '公司地址'],
      placeholder: '如：江苏省南京市玄武区'
    },
    {
      key: 'postalCode', label: '邮编', group: '基本信息', type: 'text',
      aliases: ['邮政编码', '邮编'],
      placeholder: '如：210000'
    },

    /* ============================ 联系方式 ============================ */
    {
      key: 'phone', label: '手机号码', group: '联系方式', type: 'tel', required: true,
      aliases: ['手机号码', '手机号', '联系电话', '移动电话', '手机', '电话'],
      weakAliases: ['phone', 'mobile', 'mobilephone', 'phonenumber', 'telephone', 'contactnumber', 'cellphone'],
      avoid: ['紧急联系', '紧急联络', '座机', '固定电话', '区号', '父', '母', '监护'],
      placeholder: '11 位手机号'
    },
    {
      key: 'email', label: '电子邮箱', group: '联系方式', type: 'email', required: true,
      aliases: ['电子邮箱', '电子邮件', '常用邮箱', '邮箱地址', '邮箱', 'E-mail', 'Email'],
      placeholder: '如：your-name@example.com'
    },
    {
      key: 'wechat', label: '微信号', group: '联系方式', type: 'text',
      aliases: ['微信号', '微信'],
      placeholder: '微信号'
    },
    {
      key: 'qq', label: 'QQ', group: '联系方式', type: 'text',
      aliases: ['QQ号码', 'QQ号', 'QQ'],
      placeholder: 'QQ 号'
    },
    {
      key: 'blog', label: '个人主页 / GitHub', group: '联系方式', type: 'url',
      aliases: ['个人主页', '个人网站', 'github', 'gitee', '博客地址', '技术博客', '作品集', '个人链接'],
      placeholder: '如：https://github.com/xxx'
    },
    {
      key: 'emergencyContactName', label: '紧急联系人姓名', group: '联系方式', type: 'text',
      aliases: ['紧急联系人姓名', '紧急联络人姓名', '紧急联系人', '紧急联络人', '联系人姓名'],
      avoid: ['关系', '电话', '手机'],
      placeholder: '紧急联系人姓名'
    },
    {
      key: 'emergencyContactPhone', label: '紧急联系人电话', group: '联系方式', type: 'tel',
      aliases: ['紧急联系人电话', '紧急联系人手机', '紧急联系电话', '紧急联络电话', '联系人电话', '联系人手机'],
      placeholder: '紧急联系人电话'
    },
    {
      key: 'emergencyContactRelation', label: '与紧急联系人关系', group: '联系方式', type: 'text',
      aliases: ['与紧急联系人关系', '与本人关系', '紧急联系人关系', '亲属关系'],
      placeholder: '如：父子'
    },

    /* ============================ 教育背景 ============================ */
    {
      key: 'school', label: '学校名称', group: '教育背景', type: 'text', required: true,
      aliases: ['毕业院校', '就读院校', '学校名称', '毕业学校', '院校名称', '学校', '院校'],
      weakAliases: ['school', 'schoolname', 'university', 'college', 'institution'],
      avoid: ['公司', '单位', '中学', '高中'],
      placeholder: '如：某某大学'
    },
    {
      key: 'college', label: '学院 / 院系', group: '教育背景', type: 'text',
      aliases: ['所在学院', '学院名称', '院系名称', '学院', '院系', '系别'],
      placeholder: '如：计算机学院'
    },
    {
      key: 'major', label: '专业', group: '教育背景', type: 'text', required: true,
      aliases: ['所学专业', '专业名称', '专业方向', '专业', '主修专业'],
      weakAliases: ['major', 'specialty', 'fieldofstudy', 'programme'],
      placeholder: '如：软件工程'
    },
    {
      key: 'degree', label: '学历', group: '教育背景', type: 'select', required: true,
      aliases: ['最高学历', '学历层次', '培养层次', '学历'],
      weakAliases: ['degree', 'education', 'educationlevel', 'highestdegree', 'qualification'],
      avoid: ['学位'],
      options: ['大专', '本科', '硕士研究生', '博士研究生', 'MBA', '其他']
    },
    {
      key: 'academicDegree', label: '学位', group: '教育背景', type: 'select',
      aliases: ['最高学位', '学位类型', '学位'],
      options: ['学士', '硕士', '博士', '无']
    },
    {
      key: 'eduStart', label: '入学时间', group: '教育背景', type: 'month', section: 'edu',
      aliases: ['入学时间', '入学年月', '入学日期', '教育开始时间', '就读开始时间', '开始时间', '起始时间'],
      // 裸的"开始时间"离开分区就无法判断属于哪段经历，因此标为歧义：
      // 只有推断出"教育背景"分区时才会用它，否则宁可不填。
      ambiguousAliases: ['开始时间', '起始时间'],
      placeholder: '如：2023-09'
    },
    {
      key: 'eduEnd', label: '毕业时间', group: '教育背景', type: 'month', section: 'edu',
      aliases: ['预计毕业时间', '毕业时间', '毕业年月', '毕业日期', '离校时间', '教育结束时间', '就读结束时间', '结束时间', '截止时间'],
      ambiguousAliases: ['结束时间', '截止时间'],
      placeholder: '如：2027-06'
    },
    {
      key: 'gpa', label: 'GPA / 平均绩点', group: '教育背景', type: 'text',
      aliases: ['平均绩点', 'GPA', '绩点', '平均成绩', '加权平均分', '平均分'],
      placeholder: '如：3.5/4.0'
    },
    {
      key: 'eduRank', label: '专业排名', group: '教育背景', type: 'text',
      aliases: ['专业排名', '年级排名', '班级排名', '综合排名', '排名'],
      placeholder: '如：5/120'
    },
    {
      key: 'englishLevel', label: '英语等级', group: '教育背景', type: 'select',
      aliases: ['英语等级', '英语水平', '外语水平', '英语能力', 'CET', '四六级'],
      options: ['CET-4', 'CET-6', '专业四级', '专业八级', '雅思', '托福', '无']
    },
    {
      key: 'englishScore', label: '英语分数', group: '教育背景', type: 'text',
      aliases: ['英语分数', '四级成绩', '六级成绩', 'CET成绩'],
      placeholder: '如：480'
    },
    {
      key: 'computerLevel', label: '计算机等级', group: '教育背景', type: 'text',
      aliases: ['计算机等级', '计算机水平', '计算机能力'],
      placeholder: '如：二级'
    },

    /* ============================ 求职意向 ============================ */
    {
      key: 'jobType', label: '求职类型', group: '求职意向', type: 'select',
      aliases: ['求职类型', '工作性质', '应聘类型', '职位类型', '求职性质'],
      options: ['实习', '全职', '兼职', '校园招聘', '社会招聘']
    },
    {
      key: 'expectedPosition', label: '期望职位', group: '求职意向', type: 'text', required: true,
      aliases: ['应聘职位', '期望职位', '意向岗位', '期望岗位', '申请职位', '目标职位', '应聘岗位', '职位名称', '岗位名称', '应聘方向'],
      weakAliases: ['position', 'jobtitle', 'appliedposition', 'expectedposition', 'appliedfor'],
      placeholder: '如：后端开发实习生'
    },
    {
      key: 'expectedCity', label: '期望城市', group: '求职意向', type: 'text',
      aliases: ['期望工作地点', '期望工作地', '期望城市', '意向城市', '期望地区', '意向工作地', '工作地点', '期望地点'],
      weakAliases: ['city', 'expectedcity', 'preferredcity', 'worklocation', 'preferredlocation'],
      placeholder: '如：南京'
    },
    {
      key: 'expectedSalary', label: '期望薪资', group: '求职意向', type: 'text',
      aliases: ['期望月薪', '期望薪资', '薪资要求', '期望薪水', '期望年薪', '薪资'],
      placeholder: '如：面议 / 200-300元/天'
    },
    {
      key: 'availableDate', label: '到岗时间', group: '求职意向', type: 'text',
      aliases: ['最快到岗时间', '可到岗时间', '到岗时间', '入职时间', '可实习时间', '可实习时长', '实习时长', '可开始实习时间'],
      placeholder: '如：随时到岗'
    },
    {
      key: 'jobSource', label: '招聘信息来源', group: '求职意向', type: 'text',
      aliases: ['招聘信息来源', '信息来源', '获知渠道', '了解渠道', '得知渠道'],
      placeholder: '如：校园招聘官网'
    },
    {
      key: 'acceptAdjust', label: '是否服从调剂 / 接受出差', group: '求职意向', type: 'select',
      aliases: ['是否服从调剂', '服从调剂', '是否接受出差', '接受出差', '是否接受调剂'],
      options: ['是', '否']
    },

    /* ========================== 实习 / 工作经历 ========================== */
    {
      key: 'intern1Company', label: '实习公司（最近一段）', group: '实习经历', type: 'text',
      aliases: ['实习公司名称', '实习单位名称', '公司名称', '单位名称', '实习公司', '实习单位', '公司'],
      avoid: ['学校', '项目'],
      placeholder: '如：某某科技有限公司'
    },
    {
      key: 'intern1Position', label: '实习职位（最近一段）', group: '实习经历', type: 'text',
      aliases: ['实习职位', '实习岗位', '担任职位', '职位名称', '岗位名称', '职务'],
      placeholder: '如：后端开发实习生'
    },
    {
      key: 'intern1Start', label: '实习开始时间', group: '实习经历', type: 'month', section: 'exp',
      aliases: ['实习开始时间', '实习起始时间', '入职时间', '开始时间', '起始时间'],
      ambiguousAliases: ['开始时间', '起始时间'],
      placeholder: '如：2026-08'
    },
    {
      key: 'intern1End', label: '实习结束时间', group: '实习经历', type: 'month', section: 'exp',
      aliases: ['实习结束时间', '实习离职时间', '离职时间', '结束时间', '截止时间'],
      ambiguousAliases: ['结束时间', '截止时间'],
      placeholder: '如：2026-09'
    },
    {
      key: 'internSummary', label: '实习 / 工作经历（整段文字）', group: '实习经历', type: 'textarea', multiline: true,
      aliases: ['实习及工作经历', '实习工作经历', '工作经历', '实习经历', '实践经历', '工作经验'],
      placeholder: '粘贴完整实习经历描述'
    },
    {
      key: 'internDuty', label: '实习工作内容 / 岗位职责', group: '实习经历', type: 'textarea', multiline: true,
      aliases: ['工作内容', '岗位职责', '主要职责', '实习内容', '工作描述', '职责描述', '主要工作'],
      placeholder: '粘贴岗位职责描述'
    },

    /* ============================ 项目经历 ============================ */
    {
      key: 'projectName', label: '项目名称', group: '项目经历', type: 'text',
      aliases: ['项目名称', '项目课题'],
      placeholder: '如：某某数据可视化平台'
    },
    {
      key: 'projectRole', label: '项目角色', group: '项目经历', type: 'text',
      aliases: ['项目角色', '担任角色', '项目职务'],
      placeholder: '如：独立开发'
    },
    {
      key: 'projectSummary', label: '项目经历（整段文字）', group: '项目经历', type: 'textarea', multiline: true,
      aliases: ['项目经历', '项目经验', '项目描述', '项目内容', '项目介绍', '主要项目'],
      placeholder: '粘贴完整项目经历描述'
    },

    /* ======================== 自我评价与技能 ======================== */
    {
      key: 'selfEvaluation', label: '自我评价', group: '自我评价', type: 'textarea', multiline: true,
      aliases: ['自我评价', '自我介绍', '个人评价', '个人简介', '个人优势', '自我描述', '个人特长', '自我认知'],
      weakAliases: ['selfevaluation', 'selfintroduction', 'aboutme', 'personalstatement', 'summary'],
      placeholder: '粘贴自我评价'
    },
    {
      key: 'skills', label: '专业技能', group: '自我评价', type: 'textarea', multiline: true,
      aliases: ['专业技能', '技能特长', '掌握技能', '技术栈', '技能', '专业能力'],
      weakAliases: ['skills', 'skill', 'technicalskills', 'competencies'],
      placeholder: '如：Java / MySQL / Redis / Hadoop / Flink'
    },
    {
      key: 'awards', label: '获奖情况', group: '自我评价', type: 'textarea', multiline: true,
      aliases: ['获奖情况', '获奖经历', '所获奖励', '荣誉奖项', '奖励情况', '奖项'],
      placeholder: '如：校级一等奖学金'
    },
    {
      key: 'campusExperience', label: '校园经历 / 学生工作', group: '自我评价', type: 'textarea', multiline: true,
      aliases: ['校园经历', '社团经历', '学生工作', '在校经历', '校园实践'],
      placeholder: '粘贴校园经历'
    },
    {
      key: 'certificate', label: '证书', group: '自我评价', type: 'textarea', multiline: true,
      aliases: ['资格证书', '已获证书', '证书', '职业资格'],
      placeholder: '如：软件设计师'
    },
    {
      key: 'languageSkill', label: '语言能力', group: '自我评价', type: 'text',
      aliases: ['语言能力', '外语能力', '语言水平'],
      placeholder: '如：英语（CET-6）'
    },
    {
      key: 'hobby', label: '兴趣爱好', group: '自我评价', type: 'textarea', multiline: true,
      aliases: ['兴趣爱好', '兴趣特长', '爱好'],
      placeholder: '如：跑步、开源'
    },

    /* ============================== 附件 ============================== */
    {
      key: 'resumeFile', label: '简历附件（自动上传）', group: '附件', type: 'file',
      aliases: ['简历附件', '上传简历', '简历文件', '上传附件', '附件上传', '选择文件', '上传文件', '附件'],
      placeholder: '在设置页选择本地简历文件'
    }
  ];

  const FIELD_MAP = {};
  FIELD_DEFS.forEach(function (d) { FIELD_MAP[d.key] = d; });

  const GROUPS = [];
  FIELD_DEFS.forEach(function (d) {
    if (GROUPS.indexOf(d.group) === -1) GROUPS.push(d.group);
  });

  /**
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

  /** 默认全局设置 */
  const DEFAULT_SETTINGS = {
    activeProfileId: 'default',
    fabMode: 'auto',            // auto | always | never
    autoFillOnLoad: false,      // 进页面自动填（默认关闭，避免误填）
    highlightFilled: true,      // 填充后高亮
    fillEmptyOnly: true,        // 只填空白字段，不覆盖已填内容
    triggerEvents: true,        // 派发 input/change/blur，兼容 React/Vue
    fillFileInput: true,        // 自动把简历挂到 file 控件
    matchThreshold: 66,         // 匹配分数阈值
    customFields: [],           // [{key,label,aliases:[],type,value}]
    siteRules: {},              // { "hostname": [{selector, fieldKey}] }
    lastFillAt: 0
  };

  return {
    FIELD_DEFS: FIELD_DEFS,
    FIELD_MAP: FIELD_MAP,
    GROUPS: GROUPS,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS
  };
});
