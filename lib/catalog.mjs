import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
export async function loadResources(sourceDir = path.join(ROOT, 'catalog')) {
  const catalog = JSON.parse(await readFile(path.join(sourceDir, 'resource-directory.json'), 'utf8'));
  const ids = new Set();
  for (const item of catalog.resources) {
    let address; try { address = new URL(item.url); } catch { throw new Error('资源地址不正确'); }
    if (!item.id?.startsWith('cn-') || ids.has(item.id) || item.region !== '中国大陆' || !item.name || !item.description || !item.category || !item.sources?.length || address.protocol !== 'https:' || address.username || address.password || !['repository', 'platform', 'documentation'].includes(item.resourceKind)) throw new Error('资源分类目录格式不正确');
    if (item.resourceKind === 'repository' && (!item.repository || address.hostname !== 'github.com')) throw new Error('源码资源格式不正确');
    ids.add(item.id);
  }
  return catalog.resources;
}
export async function loadInspirations(sourceDir = path.join(ROOT, 'catalog')) {
  const base = JSON.parse(await readFile(path.join(sourceDir, 'domestic.json'), 'utf8'));
  const extra = JSON.parse(await readFile(path.join(sourceDir, 'extra-inspirations.json'), 'utf8'));
  const items = [...base.resources, ...extra.resources];
  if (new Set(items.map(r => r.id)).size !== items.length) throw new Error('项目灵感编号重复');
  for (const item of items) {
    let url; try { url = new URL(item.url); } catch { throw Error('项目灵感链接不正确'); }
    if (!item.id?.startsWith('cn-') || item.region !== '中国大陆' || !item.name || !item.description || !item.category || !item.monetization || !item.deliverable || !item.maintenance || !Array.isArray(item.firstSteps) || !item.firstSteps.length || !item.sources?.length || url.protocol !== 'https:' || url.username || url.password) throw Error('项目灵感资料不完整');
  }
  return items;
}
export async function sourceMeta(sourceDir, resources, inspirations) {
  const catalog = JSON.parse(await readFile(path.join(sourceDir, 'resource-directory.json'), 'utf8'));
  return { sourceUrl: '/source/resource-directory.md', sourceCommit: '', resourceCount: resources.length, repositoryCount: resources.filter(r => r.repository).length, platformCount: resources.filter(r => !r.repository).length, directionCount: inspirations.length, sourceYear: 2026, catalogName: '国内副业资源分类目录', catalogVersion: catalog.version, reviewedAt: catalog.reviewedAt, notice: catalog.notice };
}

