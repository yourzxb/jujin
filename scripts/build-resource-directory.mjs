import { readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
const revision = randomUUID();
const daily = JSON.parse(await readFile('catalog/daily-discovery.json', 'utf8').catch(e => { if (e.code === 'ENOENT') return '{"resources":[],"inspirations":[]}'; throw e; }));
const reviewedAt = daily.reviewedAt || '2026-10-31';
async function atomicWrite(file, value) { const tmp = file + '.' + randomUUID() + '.tmp'; await writeFile(tmp, value); await rename(tmp, file); }

const base = JSON.parse(await readFile('catalog/github-projects.json', 'utf8')).resources;
const evidence = JSON.parse(await readFile('research/wechat-ai-resources-2026-10-31.json', 'utf8'));
const categories = { 'gongfuxiang/shopxo':'内容建站与交付','Qsnh/meedu':'知识付费与社群','halo-dev/halo':'内容建站与交付','labring/FastGPT':'人工智能应用','1Panel-dev/MaxKB':'人工智能应用','langbot-app/LangBot':'公众号与微信开发','jianchang512/pyvideotrans':'内容制作与写作','dcloudio/uni-app':'小程序开发' };
const resources = base.map(r => ({ ...r, resourceKind: 'repository', category: categories[r.repository], categoryLabel: categories[r.repository] }));
const specs = [
  ['doocs/md','公众号 Markdown 排版工具','公众号与微信开发','将 Markdown 内容排版为适合微信公众号的样式，支持主题及内容编辑。'],
  ['w7corp/easywechat','EasyWeChat 微信开发工具包','公众号与微信开发','PHP 微信开发工具包，可用于实现微信生态相关业务接口。'],
  ['binarywang/WxJava','WxJava 微信开发工具包','公众号与微信开发','Java 微信开发工具包，覆盖公众号、小程序、企业微信等接口。'],
  ['wechat-miniprogram/miniprogram-demo','微信小程序官方示例','小程序开发','微信官方的小程序组件、接口和云开发示例，适合查阅和制作功能原型。'],
  ['wechat-miniprogram/weui-miniprogram','小程序 WeUI 组件库','小程序开发','微信小程序界面组件库，用于搭建符合微信视觉习惯的界面。'],
  ['Tencent/tdesign-miniprogram','腾讯 TDesign 小程序组件库','小程序开发','腾讯开源的小程序界面组件库，可用于表单、列表和交互界面。'],
  ['NervJS/taro','Taro 跨端开发框架','小程序开发','使用 React、Vue 等开发多端应用的框架，支持微信等小程序。'],
  ['binary-husky/gpt_academic','GPT Academic 文献与写作工具','内容制作与写作','提供文献阅读、总结、润色等交互工具，支持多种模型与插件。'],
  ['datawhalechina/llm-universe','大模型应用开发教程','人工智能学习','中文大模型应用开发教程，适合学习知识库和应用开发基础。'],
  ['datawhalechina/prompt-engineering-for-developers','大模型课程中文教程','人工智能学习','Datawhale 大模型入门课程资料；仓库现已迁移至 llm-cookbook。'],
  ['LHRUN/paint-board','开源电子画板','教育工具','提供多种画笔效果的网页画板，可用于研究教学白板和绘画交互。']
];
for (const [requested, name, category, description] of specs) {
  const facts = evidence.results.find(r => r.repo === requested);
  if (!facts || facts.error || facts.archived) continue;
  const repository = facts.url.replace('https://github.com/', '');
  const date = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(facts.latestCommitAt));
  resources.push({ id:'cn-dir-'+repository.toLowerCase().replaceAll('/','-'), name, repository, region:'中国大陆', resourceKind:'repository', category, categoryLabel:category, type:'开源仓库', url:facts.url, documentationUrl:facts.url+'/blob/'+facts.defaultBranch+'/README.md', description, resourceDescription:description, checkedAt:'2026-10-31', upstreamCommitAt:facts.latestCommitAt, upstreamCommitDate:date, upstreamCommit:facts.latestCommit,
    licenseNote: ['NOASSERTION','未标明'].includes(facts.license) ? '未识别到标准许可，请在原仓库核对具体许可与商用条件' : facts.license+'；组件、素材及第三方服务条件另查',
    sources:[{name:'原始仓库',url:facts.url,note:'已核对仓库资料及最近提交；没有安装或进行收入测试。'},{name:'最近提交',url:facts.url+'/commit/'+facts.latestCommit,note:'核验时的提交日期：'+date}] });
}
const platforms = [
  ['wechat-official','微信公众号后台','公众号与微信开发','https://mp.weixin.qq.com/','管理公众号内容、账号与相关运营功能；流量主条件和结算以自己的后台为准。','platform','官方后台，通常需要登录，未读取你的账号数据。'],
  ['miniapp-docs','微信小程序官方开发文档','小程序开发','https://developers.weixin.qq.com/miniprogram/dev/framework/','查阅小程序开发框架、组件和接口，具体功能及广告接入以官方文档为准。','documentation','官方文档入口；自动读取受限时可在浏览器打开。'],
  ['tencent-ads','腾讯广告官网','公众号与微信开发','https://e.qq.com/','腾讯广告官方信息入口，用于核对广告产品资料；不代表账号已取得流量主资格。','platform','官网入口，业务资格和收益请以官方后台为准。'],
  ['zsxq','知识星球官网','知识付费与社群','https://www.zsxq.com/','知识内容与付费社群工具，提供创作者、内容沉淀及社群运营入口。','platform','已读取官方网站介绍；未访问你的星球或账户。'],
  ['zsxq-help','知识星球官方知识库','知识付费与社群','https://help-docs.zsxq.com/','知识星球官方使用说明，包含内容组织、社群和用户常见问题。','documentation','官方使用文档，不将宣传或个别案例当作收益保证。'],
  ['deepseek','DeepSeek 接口文档','人工智能应用','https://api-docs.deepseek.com/zh-cn/','国内模型服务的官方接口说明，包含模型调用及使用方式。','documentation','调用需要自己的账户和密钥；模型标识与费用按当前文档核对。'],
  ['bailian','阿里云百炼文档','人工智能应用','https://help.aliyun.com/zh/model-studio/what-is-model-studio','大模型服务与应用构建官方说明，覆盖模型调用、智能体和知识库等能力。','documentation','不同地域的地址与服务条件可能不同，按自己的控制台配置。'],
  ['yuanqi','腾讯元器','人工智能应用','https://yuanqi.tencent.com/','腾讯智能体创建与分发平台，可用于了解公众号助手等应用场景。','platform','已读取官网场景介绍，实际功能与权限按平台账号确认。'],
  ['yuanbao','腾讯元宝','内容制作与写作','https://yuanbao.tencent.com/','腾讯人工智能助手，可用于选题、资料整理与副业灵感讨论。','platform','当前网页要求用户扫码登录；尚未取得本次元宝搜索结果。']
];
for (const [id,name,category,url,description,resourceKind,note] of platforms) resources.push({id:'cn-platform-'+id,name,category,categoryLabel:category,region:'中国大陆',resourceKind,type:resourceKind==='documentation'?'官方文档':'官方平台',url,documentationUrl:url,description,resourceDescription:description,checkedAt:'2026-10-31',licenseNote:'按官方平台服务协议、使用规则及具体业务条件使用',sources:[{name:'官方入口',url,note}]});
if(new Set(resources.map(r=>r.id)).size!==resources.length)throw Error('资源编号重复');
const extension = JSON.parse(await readFile('catalog/education-extension.json', 'utf8'));
const workflowExtension = JSON.parse(await readFile('catalog/workflow-extension.json', 'utf8'));
resources.push(...extension.resources, ...workflowExtension.resources, ...daily.resources);
if (new Set(resources.map(r => r.id)).size !== resources.length || new Set(resources.map(r => r.url.toLowerCase().replace(/\/$/, ''))).size !== resources.length) throw Error('资源编号或链接重复');

const byRepo = name => resources.find(r=>r.repository===name);
const ideaSpecs = [
 ['wechat-education-column','AI 教育案例公众号栏目','公众号内容产品','围绕一个教师群体发布原创 AI 教学案例和使用评测，建立稳定栏目。','公众号流量主收入与自有资料产品；资格和收益以后台为准','doocs/md','一组经实测的原创案例与统一排版','持续选题、实测、校对和维护读者反馈'],
 ['wechat-layout-pack','公众号原创排版与版式包','公众号内容产品','基于排版工具制作面向教育作者的原创版式、样例和使用教程。','原创版式包或教程销售','doocs/md','原创样式、预览和使用文档','跟随编辑器更新并处理兼容性'],
 ['wechat-content-process','教育公众号内容流程工具','公众号内容产品','把选题、稿件审核、排版和复盘串成个人使用流程，再验证是否有标准化工具需求。','自用提效；可尝试标准模板或工具授权','binarywang/WxJava','授权范围内的后台工具和流程文档','接口兼容、内容审核和真实使用反馈'],
 ['mini-class-timer','课堂计时与活动安排小程序','小程序工具','面向老师制作简洁的课堂计时、分组与活动安排功能。','流量主广告需符合平台条件，先验证使用与留存','wechat-miniprogram/miniprogram-demo','可使用的小程序原型和功能说明','兼容、审核和用户反馈'],
 ['mini-grouping','课堂随机分组小程序','小程序工具','围绕分组、抽签和座位安排提供单一场景工具，不必一开始做完整教学平台。','符合平台条件后的广告或付费功能','Tencent/tdesign-miniprogram','分组原型、测试样例与说明','界面兼容、异常处理和真实使用'],
 ['mini-study-log','读书与学习记录小程序','小程序工具','为一类学习者提供轻量记录、复习提醒和统计工具。','验证留存后再考虑符合条件的广告或增值功能','NervJS/taro','记录与统计原型','发布审核、版本兼容和用户支持'],
 ['mini-college-filter','专科院校信息筛选小程序','小程序工具','与你已有选校网站衔接，先制作单省份的官方院校信息查询与筛选。','原创资料包或符合平台条件的广告，需验证需求','wechat-miniprogram/miniprogram-demo','带官方来源和更新时间的查询原型','招生季资料核查与持续更新'],
 ['planet-ai-exercises','AI 教育实践 实操练习资源库','教育知识社群','在现有星球中沉淀原创练习、示例和教学改进记录，而非直接转售上游教程。','知识星球会员与原创专题资料','datawhalechina/llm-universe','原创练习、操作示例和更新目录','持续更新与会员反馈'],
 ['planet-prompt-cases','教师提示词与评测案例库','教育知识社群','围绕具体教学任务，记录提示词、输出对照与人工评测，形成可检索资料。','知识星球会员或原创案例专题','datawhalechina/llm-cookbook','原创任务卡和评测记录','模型变化后的复测与纠错'],
 ['planet-qa-index','教育社群问答与资料索引','教育知识社群','将已获授权的社群常见问题与资料整理成分层索引，先改善自己星球的交付体验。','提升已有会员服务；进一步工具化需另验证','halo-dev/halo','可检索的资料索引和更新流程','授权、资料更新与答疑整理'],
 ['education-whiteboard','课堂电子白板与练习模板','教育工具','参考开源画板能力制作自己的教学白板原型和原创课堂练习模板。','原创模板包或工具授权','LHRUN/paint-board','白板原型与原创模板','设备兼容、素材许可和用户反馈'],
 ['paper-reading-helper','文献阅读与格式检查助手','写作与资料工具','围绕用户有权使用的资料提供摘要、格式检查和阅读辅助，结果需人工查证。','标准工具使用服务或人工审核服务，需验证需求','binary-husky/gpt_academic','带来源的资料摘要与检查报告','人工核对、隐私授权和模型费用']
];
const inspirations=[];
for (const [id,name,category,description,monetization,repo,deliverable,maintenance] of ideaSpecs) {
 const resource=byRepo(repo); if(!resource)continue;
 inspirations.push({id:'cn-idea-'+id,name,region:'中国大陆',category,categoryLabel:category,type:'GitHub启发的项目方案',description,monetization,deliverable,maintenance,firstSteps:['选择一个具体目标用户，收集三个真实问题','用所列源码做小范围原型或原创样例','验证真实使用与付费意愿，再决定投入'],requirements:'灵感由工作台根据仓库能力推导，非原作者收益承诺；按源码、素材和平台条件实施。',costNotes:'核算开发、维护、模型调用和内容生产时间。',url:resource.url,checkedAt:'2026-10-31',sourceRepository:repo,sources:[{name:repo+' 原始仓库',url:resource.url,note:'本方向由工作台推导；资源本身不代表已实现收入。'}]});
}
inspirations.unshift(...daily.inspirations, ...workflowExtension.inspirations, ...extension.inspirations);
if (new Set(inspirations.map(r => r.id)).size !== inspirations.length) throw Error('灵感编号重复');
await atomicWrite('catalog/resource-directory.json',JSON.stringify({revision,reviewedAt,resources},null,2));
await atomicWrite('catalog/extra-inspirations.json',JSON.stringify({revision,reviewedAt,resources:inspirations},null,2));
let report='# 国内副业资源分类目录\n\n目录更新：'+reviewedAt+'。条目核验日期以资源详情为准。\n\n';
for(const category of [...new Set(resources.map(r=>r.category))]){report+='## '+category+'\n\n';for(const r of resources.filter(r=>r.category===category))report+='- ['+r.name+']('+r.url+') — '+r.description+'\n';report+='\n';}
report+='## GitHub 新增核验说明\n\n基础目录曾查询十三个仓库，两个因 GitHub 接口限额未取得元数据，未将其纳入本次新增目录。基础记录见 research/wechat-ai-resources-2026-10-31.json；后续两批各七个仓库记录见 research/education-ideas-2026-10-31.json 和 research/workflow-ideas-2026-10-31.json。教程、社区源码和商业平台应分别核对许可与使用条件。\n\n## 元宝查询状态\n\n已打开腾讯元宝，但其网页要求用户扫码登录；用户选择先完成其他部分。本次没有取得或冒称元宝生成的副业结果。\n';
await writeFile('国内副业资源分类目录.md',report);
console.log(JSON.stringify({resources:resources.length,repositories:resources.filter(r=>r.repository).length,platforms:resources.filter(r=>!r.repository).length,githubInspirations:inspirations.length}));
