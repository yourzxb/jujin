import {readFile,writeFile} from 'node:fs/promises';
const base=JSON.parse(await readFile('catalog/domestic.json','utf8')).resources;
const catalog=JSON.parse(await readFile('catalog/extra-inspirations.json','utf8'));
const extra=catalog.resources;
const items=[...base,...extra].sort((a,b)=>(b.addedAt||'').localeCompare(a.addedAt||''));
let report='# 国内项目灵感与来源说明\n\n目录更新：'+catalog.reviewedAt+'。共 '+items.length+' 个待验证方向。真实源码和平台入口请查看 [国内副业资源分类目录](/source/resource-directory.md)。方案由工作台依据公开源码能力推导，产品效果和收入尚待实测。\n\n';
for(const item of items){report+='## '+item.name+'\n\n'+item.description+'\n\n- 分类：'+item.category+'\n'+(item.addedAt?'- 新增日期：'+item.addedAt.slice(0,10)+'\n':'')+'- 可尝试的收入方式：'+item.monetization+'\n- 交付：'+item.deliverable+'\n- 持续维护：'+item.maintenance+'\n- 起步：'+item.firstSteps.join('；')+'\n'+(item.existingBusinessFit?'- 业务衔接：'+item.existingBusinessFit+'\n':'')+'- 成本：'+item.costNotes+'\n- 条件：'+item.requirements+'\n\n'+item.sources.map(s=>'资料：['+s.name+']('+s.url+')。'+s.note).join('\n\n')+'\n\n';}
await writeFile('国内项目资源说明.md',report);
console.log(JSON.stringify({inspirations:items.length}));
