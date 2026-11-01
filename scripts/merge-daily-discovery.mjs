import {readFile,writeFile,rename,mkdir,copyFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=async p=>JSON.parse(await readFile(path.join(root,p),'utf8'));
const file=process.argv[2];if(!file)throw Error('用法：node scripts/merge-daily-discovery.mjs <已核验批次.json>');
const batch=JSON.parse(await readFile(file,'utf8'));
const current=await read('catalog/daily-discovery.json').catch(e=>{if(e.code==='ENOENT')return {resources:[],inspirations:[]};throw e;});
const fullResources=(await read('catalog/resource-directory.json')).resources;
const fullIdeas=[...(await read('catalog/domestic.json')).resources,...(await read('catalog/extra-inspirations.json')).resources];
const https=value=>{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)throw Error('必须使用无凭据的 HTTPS 链接');return u;};
const canonical=value=>https(value).href.replace(/\/$/,'').toLowerCase();
let addedResources=0,addedIdeas=0;
for(const [key,all] of [['resources',fullResources],['inspirations',fullIdeas]]){
 if(!Array.isArray(batch[key]))throw Error('缺少 '+key);
 const names=new Set(all.map(r=>r.name.trim().toLowerCase()));
 for(const r of batch[key]){
  for(const field of ['id','name','description','category','checkedAt','addedAt','existingBusinessFit'])if(typeof r[field]!=='string'||!r[field].trim())throw Error('缺少 '+field);
  if(!/^cn-[a-z0-9-]+$/.test(r.id)||r.id.length>100||r.region!=='中国大陆'||!Array.isArray(r.relatedBusinesses)||!r.relatedBusinesses.length||!r.sources?.length)throw Error('业务关联或编号不完整');
  https(r.url);for(const source of r.sources)https(source.url);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(r.checkedAt)||Number.isNaN(Date.parse(r.addedAt)))throw Error('日期不正确');
  if(key==='resources'){
   if(r.resourceKind!=='repository'||!r.repository||canonical(r.url)!==canonical('https://github.com/'+r.repository)||!r.licenseNote||!r.upstreamCommit||!r.documentationUrl||!Number.isSafeInteger(r.stars)||r.stars<0)throw Error('仓库核验信息不完整');
  }else if(!r.sourceRepository||!r.monetization||!r.deliverable||!r.maintenance||!r.costNotes||!r.requirements||r.firstSteps?.length!==3)throw Error('灵感交付信息不完整');
  const identity=x=>key==='resources'?canonical(x.url):x.name.trim().toLowerCase();
  const found=current[key].find(x=>identity(x)===identity(r));
  if(found){const id=found.id,addedAt=found.addedAt;Object.assign(found,r,{id,addedAt});continue;}
  const collision=all.find(x=>x.id===r.id);if(collision&&identity(collision)!==identity(r))throw Error('编号冲突 '+r.id);
  if(all.some(x=>identity(x)===identity(r))||names.has(r.name.trim().toLowerCase()))continue;
  current[key].push(r);all.push(r);names.add(r.name.trim().toLowerCase());if(key==='resources')addedResources++;else addedIdeas++;
 }
}
const resources=[...fullResources,...current.resources];
for(const idea of current.inspirations)if(!resources.some(r=>r.repository?.toLowerCase()===idea.sourceRepository.toLowerCase()&&canonical(r.url)===canonical(idea.url)))throw Error('灵感未关联真实资源 '+idea.id);
const ids=[...current.resources,...current.inspirations].map(r=>r.id);if(new Set(ids).size!==ids.length)throw Error('每日目录编号重复');
current.reviewedAt=batch.reviewedAt;current.updatedAt=new Date().toISOString();
const target=path.join(root,'catalog/daily-discovery.json');
await mkdir(path.join(root,'data/catalog-history'),{recursive:true});
try{await copyFile(target,path.join(root,'data/catalog-history/daily-'+Date.now()+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
const tmp=target+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(current,null,2));await rename(tmp,target);
console.log(JSON.stringify({addedResources,addedIdeas,totalDailyResources:current.resources.length,totalDailyIdeas:current.inspirations.length}));
