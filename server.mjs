import http from 'node:http';
import { loadResources, loadInspirations, sourceMeta } from './lib/catalog.mjs';
export { loadResources, loadInspirations } from './lib/catalog.mjs';
import { createReadStream } from 'node:fs';
import { constants } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { readFile, writeFile, mkdir, rename, copyFile, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAi, AiError, taskDetails, validatePlan } from './lib/ai.mjs';
import { FileError, FILE_LIMIT, FILE_COUNT, RECORD_FILE_LIMIT, ARCHIVE_LIMIT, attachmentList, attachmentPath, uploadName, uploadAttachment, receiveFile, verifyFiles, hashFile } from './lib/files.mjs';
import { zipSize, writeZip, readZip, extractZipEntry } from './lib/archive.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const retiredIds = new Set(JSON.parse(await readFile(path.join(ROOT, 'catalog', 'retired-ids.json'), 'utf8')));
const STATUS = new Set(['idea', 'active', 'paused', 'done']);
const MAX_ITEMS = 10000;
const MAX_AMOUNT = 10_000_000_000;
const MAX_BODY = 5 * 1024 * 1024;
// Keep exported backups below the restore upload limit, including metadata.
const MAX_STATE = MAX_BODY - 1024;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

class AppError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const invalid = message => { throw new AppError(400, message); };
function object(value, label = '数据') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label}格式不正确`);
  return value;
}
function string(value, label, max, { required = false } = {}) {
  if (typeof value !== 'string' || value.length > max) invalid(`${label}应为不超过 ${max} 字的文本`);
  const result = value.trim();
  if (required && !result) invalid(`${label}不能为空`);
  return result;
}
function identifier(value, label = 'ID') {
  const id = string(value, label, 100, { required: true });
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) invalid(`${label}格式不正确`);
  return id;
}
function array(value, label) {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) invalid(`${label}应为不超过 ${MAX_ITEMS} 条的列表`);
  return value;
}
function unique(items, label) {
  const ids = items.map(item => typeof item === 'string' ? item : item.id);
  if (new Set(ids).size !== ids.length) invalid(`${label}包含重复 ID`);
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('日期格式应为 YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid('日期不存在');
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) invalid('创建时间格式不正确');
  return value;
}

function projectFields(input, resourceIds, partial = false) {
  object(input);
  const output = {};
  if (!partial || own(input, 'name')) output.name = string(input.name, '项目名称', 120, { required: true });
  if (!partial || own(input, 'description')) output.description = string(input.description ?? '', '项目说明', 4000);
  if (!partial || own(input, 'status')) {
    output.status = input.status ?? 'idea';
    if (!STATUS.has(output.status)) invalid('项目状态不正确');
  }
  if (!partial || own(input, 'resourceId')) {
    output.resourceId = string(input.resourceId ?? '', '资源 ID', 100);
    if (output.resourceId && !resourceIds.has(output.resourceId)) invalid('关联资源不存在');
  }
  return output;
}
function taskFields(input) {
  object(input, '任务');
  if (typeof input.done !== 'boolean') invalid('任务完成状态应为布尔值');
  return { id: identifier(input.id, '任务 ID'), title: string(input.title, '任务标题', 250, { required: true }), done: input.done, ...taskDetails(input) };
}
function transactionFields(input, projectIds) {
  object(input, '收支记录');
  if (input.type !== 'income' && input.type !== 'expense') invalid('收支类型不正确');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > MAX_AMOUNT) invalid('金额应为大于零且不超过一亿元的整数分');
  const projectId = string(input.projectId ?? '', '关联项目 ID', 100);
  if (projectId && !projectIds.has(projectId)) invalid('关联项目不存在');
  return { type: input.type, amountCents: input.amountCents, date: date(input.date), projectId,
    note: string(input.note ?? '', '收支备注', 10000) };
}
function validateData(input, resourceIds) {
  object(input);
  if (input.schemaVersion !== 1) invalid('备份版本不支持，应为 schemaVersion: 1');
  const favorites = array(input.favorites, '收藏').filter(value => !retiredIds.has(value)).map(value => {
    const id = identifier(value, '资源 ID');
    if (!resourceIds.has(id)) invalid('备份包含不存在的资源');
    return id;
  });
  unique(favorites, '收藏');
  const projects = array(input.projects, '项目').map(item => {
    object(item, '项目');
    const tasks = array(item.tasks, '任务').map(taskFields);
    unique(tasks, '项目任务');
    return { id: identifier(item.id, '项目 ID'), ...projectFields({ ...item, resourceId: retiredIds.has(item.resourceId) ? '' : item.resourceId }, resourceIds), createdAt: timestamp(item.createdAt), tasks };
  });
  unique(projects, '项目');
  const projectIds = new Set(projects.map(item => item.id));
  const transactions = array(input.transactions, '收支').map(item => {
    object(item, '收支记录');
    return { id: identifier(item.id, '收支 ID'), ...transactionFields(item, projectIds), ...(item.attachments === undefined ? {} : { attachments: attachmentList(item.attachments) }) };
  });
  unique(transactions, '收支');
  unique(transactions.flatMap(row => row.attachments || []), '全部附件');
  return { schemaVersion: 1, favorites, projects, transactions,
    updatedAt: typeof input.updatedAt === 'string' ? timestamp(input.updatedAt) : new Date().toISOString() };
}
function csvField(value) {
  let text = String(value ?? '');
  if (/^[\s\uFEFF]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function toCsv(data) {
  const names = new Map(data.projects.map(item => [item.id, item.name]));
  const rows = [['日期', '类型', '金额（人民币元）', '项目', '备注', '附件名称'],
    ...data.transactions.map(item => [item.date, item.type === 'income' ? '收入' : '支出',
      (item.amountCents / 100).toFixed(2), names.get(item.projectId) || '', item.note, (item.attachments || []).map(file => file.name).join('；')])];
  return '\uFEFF' + rows.map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

async function readJsonBody(req) {
  if (!(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw new AppError(415, '请使用 application/json 提交数据');
  let length = 0;
  const chunks = [];
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw new AppError(413, '提交内容不能超过 5 MiB');
    chunks.push(chunk);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) { if (error instanceof AppError) throw error; invalid('JSON 格式不正确'); }
}

export async function createApp({ dataDir = path.join(ROOT, 'data'), sourceDir = path.join(ROOT, 'catalog'), publicDir = path.join(ROOT, 'public'), aiFetch } = {}) {
  let resources = await loadResources(sourceDir);
  let inspirations = await loadInspirations(sourceDir);
  // Existing project references and favorites can point to either collection.
  let resourceIds = new Set([...resources, ...inspirations].map(item => item.id));
  let meta = await sourceMeta(sourceDir, resources, inspirations);
  await mkdir(dataDir, { recursive: true });
  const ai = await createAi({ dataDir, fetchImpl: aiFetch });
  const statePath = path.join(dataDir, 'state.json');
  let data;
  try {
    const previous = JSON.parse(await readFile(statePath, 'utf8'));
    data = validateData(previous, resourceIds);
    const changed = previous.favorites.some(id => retiredIds.has(id)) || previous.projects.some(p => retiredIds.has(p.resourceId));
    if (changed) {
      const backup = path.join(dataDir, 'state.before-domestic-2026-10-31.json');
      try { await writeFile(backup, JSON.stringify(previous, null, 2), { encoding: 'utf8', flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await copyFile(statePath, statePath + '.bak');
      const temporary = path.join(dataDir, 'domestic-migration-' + randomUUID() + '.tmp');
      await writeFile(temporary, JSON.stringify(data, null, 2), 'utf8');
      await rename(temporary, statePath);
    }
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`无法读取数据文件 ${statePath}；请先保留该文件并检查备份。${error.message}`, { cause: error });
    data = { schemaVersion: 1, favorites: [], projects: [], transactions: [], updatedAt: new Date().toISOString() };
    await writeFile(statePath, JSON.stringify(data, null, 2), { encoding: 'utf8', flag: 'wx' });
  }
  const state = () => ({ resources, inspirations, favorites: data.favorites, projects: data.projects, transactions: data.transactions, meta, updatedAt: data.updatedAt });
  // Reload only complete, valid catalog pairs. Business state is never written here.
  const catalogPaths = ['resource-directory.json', 'extra-inspirations.json'].map(file => path.join(sourceDir, file));
  const catalogStamp = async () => (await Promise.all(catalogPaths.map(file => stat(file)))).map(s => s.mtimeMs + ':' + s.size).join('|');
  let loadedStamp = await catalogStamp();
  let catalogRefresh;
  async function refreshCatalog() {
    if (catalogRefresh) return catalogRefresh;
    catalogRefresh = (async () => {
      try {
        const stamp = await catalogStamp();
        if (stamp === loadedStamp) return;
        const pair = await Promise.all(catalogPaths.map(async file => JSON.parse(await readFile(file, 'utf8'))));
        if (!pair[0].revision || pair[0].revision !== pair[1].revision) return;
        const nextResources = await loadResources(sourceDir);
        const nextInspirations = await loadInspirations(sourceDir);
        const nextIds = new Set([...nextResources, ...nextInspirations].map(r => r.id));
        if (nextIds.size !== nextResources.length + nextInspirations.length || [...resourceIds].some(id => !nextIds.has(id))) throw Error('目录更新不能移除旧编号或引入重复编号');
        validateData(data, nextIds);
        const nextMeta = await sourceMeta(sourceDir, nextResources, nextInspirations);
        if (await catalogStamp() !== stamp) return;
        resources = nextResources; inspirations = nextInspirations; resourceIds = nextIds; meta = nextMeta; loadedStamp = stamp;
      } catch (error) { console.error('目录更新未生效，继续使用上一版：', error.message); }
    })().finally(() => { catalogRefresh = undefined; });
    return catalogRefresh;
  }
  let queue = Promise.resolve();
  const mutate = (updater, afterSave) => {
    const next = queue.then(async () => {
      const draft = structuredClone(data);
      await updater(draft);
      draft.updatedAt = new Date().toISOString();
      const validated = validateData(draft, resourceIds);
      const serialized = JSON.stringify(validated, null, 2);
      if (Buffer.byteLength(serialized, 'utf8') > MAX_STATE) invalid('数据总量已接近 5 MiB 上限，请先导出备份并归档部分记录后再保存');
      const temporary = path.join(dataDir, `state-${randomUUID()}.tmp`);
      await writeFile(temporary, serialized, 'utf8');
      await copyFile(statePath, statePath + '.bak');
      await rename(temporary, statePath);
      data = validated;
      if (afterSave) await afterSave().catch(error => console.error('附件清理失败', error));
      return state();
    });
    queue = next.catch(() => {});
    return next;
  };
  const getProject = (draft, id) => {
    const project = draft.projects.find(item => item.id === id);
    if (!project) throw new AppError(404, '项目不存在');
    return project;
  };
  const getTask = (project, id) => {
    const task = project.tasks.find(item => item.id === id);
    if (!task) throw new AppError(404, '任务不存在');
    return task;
  };
  const getTransaction = (draft, id) => {
    const item = draft.transactions.find(row => row.id === id);
    if (!item) throw new AppError(404, '收支记录不存在');
    return item;
  };
  let fileOperations = 0;
  let archiveOperation = false;
  let backupReaders = 0;
  const cleanFiles = async files => {
    for (const file of files) await unlink(attachmentPath(dataDir, file.id)).catch(error => { if (error.code !== 'ENOENT') console.error(error); });
  };
  const staticFiles = new Map([
    ['/', [path.join(publicDir, 'index.html'), 'text/html; charset=utf-8']],
    ['/index.html', [path.join(publicDir, 'index.html'), 'text/html; charset=utf-8']],
    ['/app.js', [path.join(publicDir, 'app.js'), 'text/javascript; charset=utf-8']],
    ['/brand.svg', [path.join(publicDir, 'brand.svg'), 'image/svg+xml']],
    ['/source/project-review.md', [path.join(ROOT, '聚金项目改进评审.md'), 'text/plain; charset=utf-8']],
    ['/styles.css', [path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8']],
    ['/source/README.md', [path.join(ROOT, '国内项目资源说明.md'), 'text/plain; charset=utf-8']],
    ['/source/china-resources.md', [path.join(ROOT, '国内项目资源说明.md'), 'text/plain; charset=utf-8']],
    ['/source/resource-directory.md', [path.join(ROOT, '国内副业资源分类目录.md'), 'text/plain; charset=utf-8']],
    ['/source/github-projects.md', [path.join(ROOT, 'GitHub国内项目核验清单.md'), 'text/plain; charset=utf-8']],
  ]);
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const requestHost = req.headers.host || '';
      const boundPort = server.address()?.port;
      if (!new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`, `[::1]:${boundPort}`]).has(requestHost)) throw new AppError(403, '仅允许本机访问');
      const url = new URL(req.url, `http://${requestHost}`);
      const pathname = url.pathname;
      const method = req.method || 'GET';
      if (req.headers.origin) {
        let origin;
        try { origin = new URL(req.headers.origin); } catch { throw new AppError(403, '不允许该来源访问'); }
        if (origin.protocol !== 'http:' || origin.host !== requestHost) throw new AppError(403, '不允许跨来源访问');
      }
      if (req.headers['sec-fetch-site'] === 'cross-site') throw new AppError(403, '不允许跨网站访问');
      if (method === 'GET' && pathname === '/api/health') return json(200, { ok: true, app: 'passive-income-workbench' });
      if (method === 'GET' && pathname === '/api/ai/config') return json(200, ai.status());
      if (method === 'POST' && pathname === '/api/ai/config') return json(200, await ai.configure(await readJsonBody(req)));
      const aiMatch = /^\/api\/projects\/([a-zA-Z0-9_-]+)\/(ai-plan|tasks\/batch)$/.exec(pathname);
      if (aiMatch && method === 'POST') {
        const body = await readJsonBody(req);
        const project = getProject(data, aiMatch[1]);
        if (aiMatch[2] === 'ai-plan') return json(200, await ai.generate(structuredClone(project), body.requirements ?? ''));
        const planId = identifier(body.planId, '计划编号');
        const plan = validatePlan(body);
        return json(200, await mutate(draft => {
          const current = getProject(draft, project.id);
          if (current.tasks.some(t => t.planId === planId)) return;
          const existing = new Set(current.tasks.map(t => t.title.toLowerCase()));
          const tasks = plan.tasks.filter(t => !existing.has(t.title.toLowerCase()));
          if (current.tasks.length + tasks.length > MAX_ITEMS) invalid('任务数量已达上限');
          current.tasks.push(...tasks.map(t => ({ ...t, id: randomUUID(), done: false, planId })));
        }));
      }
      if (method === 'GET' && pathname === '/api/state') { await refreshCatalog(); return json(200, state()); }
      if (method === 'GET' && pathname === '/api/backup') return json(200, { ...data, exportedAt: new Date().toISOString() }, { 'Content-Disposition': 'attachment; filename="jujin-records-backup.json"' });
      if (method === 'GET' && pathname === '/api/backup.zip') {
        backupReaders++;
        try {
        const snapshot = structuredClone(data);
        const buffer = Buffer.from(JSON.stringify({ ...snapshot, exportedAt: new Date().toISOString() }, null, 2));
        const entries = [{ name: 'state.json', buffer, size: buffer.length }];
        for (const file of snapshot.transactions.flatMap(row => row.attachments || [])) {
          const filename = attachmentPath(dataDir, file.id);
          let info; try { info = await stat(filename); } catch { throw new AppError(409, '存在缺失附件，请检查后再导出完整备份'); }
          if (!info.isFile() || info.size !== file.size) throw new AppError(409, '附件尺寸发生变化，请检查本机文件');
          entries.push({ name: 'attachments/' + file.id + '.bin', file: filename, size: file.size });
        }
        const size = zipSize(entries);
        if (size > ARCHIVE_LIMIT || entries.length > 10001) throw new AppError(413, '完整备份超过 512 MB 或文件数量上限，请复制整个 data 文件夹备份');
        res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': size, 'Content-Disposition': 'attachment; filename="jujin-complete-backup.zip"' });
        await writeZip(res, entries); return;
        } finally { backupReaders--; }
      }
      if (method === 'POST' && ['/api/restore-archive/preview', '/api/restore-archive'].includes(pathname)) {
        if (fileOperations >= 1) throw new AppError(429, '已有文件操作正在进行，请稍后重试');
        if (!(req.headers['content-type'] || '').startsWith('application/zip')) throw new AppError(415, '请上传完整 ZIP 备份');
        fileOperations++;
        archiveOperation = true;
        const temporaryDir = path.join(dataDir, 'temporary');
        const temporaryFiles = [];
        const copied = [];
        let committed = false;
        try {
          await mkdir(temporaryDir, { recursive: true });
          const archive = path.join(temporaryDir, randomUUID() + '.zip'); temporaryFiles.push(archive);
          await receiveFile(req, archive, ARCHIVE_LIMIT);
          const entries = await readZip(archive);
          const manifest = path.join(temporaryDir, randomUUID() + '.json'); temporaryFiles.push(manifest);
          await extractZipEntry(entries.get('state.json'), manifest);
          let raw;
          try { raw = JSON.parse((await readFile(manifest, 'utf8')).replace(/^\uFEFF/, '')); } catch { invalid('ZIP 业务数据不是有效 JSON'); }
          const restored = validateData(raw, resourceIds);
          const files = restored.transactions.flatMap(row => row.attachments || []);
          if (entries.size !== files.length + 1) invalid('ZIP 的附件目录与业务记录不一致');
          if (Buffer.byteLength(JSON.stringify(restored, null, 2)) > MAX_STATE) invalid('业务记录超过 5 MiB 上限');
          const staged = new Map();
          for (const file of files) {
            const entry = entries.get('attachments/' + file.id + '.bin');
            if (!entry || entry.size !== file.size) invalid('ZIP 缺少附件或附件大小不匹配');
            const filename = path.join(temporaryDir, randomUUID() + '.bin'); temporaryFiles.push(filename);
            await extractZipEntry(entry, filename);
            if (await hashFile(filename) !== file.sha256) invalid('附件完整性校验失败，未恢复数据');
            staged.set(file.id, filename);
          }
          const summary = { projects: restored.projects.length, tasks: restored.projects.reduce((sum, p) => sum + p.tasks.length, 0), transactions: restored.transactions.length, favorites: restored.favorites.length, attachments: files.length, attachmentBytes: files.reduce((sum, file) => sum + file.size, 0) };
          if (pathname.endsWith('/preview')) { json(200, summary); return; }
          const saved = await mutate(async draft => {
            await mkdir(path.join(dataDir, 'attachments'), { recursive: true });
            for (const file of files) {
              const target = attachmentPath(dataDir, file.id);
              try { await copyFile(staged.get(file.id), target, constants.COPYFILE_EXCL); copied.push(file); }
              catch (error) {
                if (error.code !== 'EEXIST') throw error;
                if (await hashFile(target) !== file.sha256) throw new AppError(409, '本机存在同编号但内容不同的附件，未恢复数据');
              }
            }
            Object.assign(draft, restored);
          });
          committed = true;
          json(200, saved); return;
        } finally {
          if (!committed) await cleanFiles(copied);
          for (const filename of temporaryFiles) await unlink(filename).catch(() => {});
          fileOperations--;
          archiveOperation = false;
        }
      }
      const attachmentMatch = /^\/api\/transactions\/([a-zA-Z0-9_-]+)\/attachments(?:\/([0-9a-f-]{36}))?$/.exec(pathname);
      if (attachmentMatch) {
        const transaction = getTransaction(data, attachmentMatch[1]);
        if (!attachmentMatch[2] && method === 'POST') {
          if (!(req.headers['content-type'] || '').startsWith('application/octet-stream')) throw new AppError(415, '附件请使用二进制文件上传');
          if (archiveOperation || fileOperations >= 2) throw new AppError(429, '已有文件操作正在进行，请稍后重试');
          if ((transaction.attachments || []).length >= FILE_COUNT) invalid('每笔收支最多保存 10 个附件');
          const name = uploadName(url.searchParams.get('name'));
          fileOperations++;
          let file;
          try {
            file = await uploadAttachment(req, dataDir, name);
            const saved = await mutate(draft => {
              const current = getTransaction(draft, attachmentMatch[1]);
              current.attachments = attachmentList([...(current.attachments || []), file]);
            });
            json(201, saved); return;
          } catch (error) { if (file) await cleanFiles([file]); throw error; }
          finally { fileOperations--; }
        }
        const file = (transaction.attachments || []).find(item => item.id === attachmentMatch[2]);
        if (!file) throw new AppError(404, '附件不存在');
        if (method === 'GET' || method === 'HEAD') {
          const filename = attachmentPath(dataDir, file.id);
          let info; try { info = await stat(filename); } catch { throw new AppError(404, '附件文件缺失，请从完整 ZIP 备份恢复'); }
          if (info.size !== file.size) throw new AppError(409, '附件文件大小与记录不一致');
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': info.size, 'Content-Disposition': "attachment; filename=\"attachment\"; filename*=UTF-8''" + encodeURIComponent(file.name).replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16)) });
          if (method === 'HEAD') { res.end(); return; }
          await pipeline(createReadStream(filename), res); return;
        }
        if (method === 'DELETE') {
          return json(200, await mutate(draft => {
            if (backupReaders) throw new AppError(409, '完整备份正在下载，请下载完成后再移除附件');
            const current = getTransaction(draft, attachmentMatch[1]);
            current.attachments = (current.attachments || []).filter(item => item.id !== file.id);
          }, () => cleanFiles([file])));
        }
      }
      if (method === 'GET' && pathname === '/api/transactions.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="jujin-transactions.csv"' });
        return res.end(toCsv(data));
      }
      if (method === 'POST' && pathname === '/api/restore') {
        const restored = validateData(await readJsonBody(req), resourceIds);
        return json(200, await mutate(async draft => { await verifyFiles(dataDir, restored.transactions); Object.assign(draft, restored); }));
      }
      if (method === 'POST' && pathname === '/api/favorites') {
        const body = await readJsonBody(req);
        if (!resourceIds.has(body.resourceId)) invalid('资源不存在');
        return json(200, await mutate(draft => {
          const index = draft.favorites.indexOf(body.resourceId);
          if (index >= 0) draft.favorites.splice(index, 1); else draft.favorites.push(body.resourceId);
        }));
      }
      if (method === 'POST' && pathname === '/api/projects') {
        const fields = projectFields(await readJsonBody(req), resourceIds);
        return json(201, await mutate(draft => {
          if (draft.projects.length >= MAX_ITEMS) invalid('项目数量已达上限');
          draft.projects.push({ id: randomUUID(), ...fields, createdAt: new Date().toISOString(), tasks: [] });
        }));
      }
      let match = /^\/api\/projects\/([a-zA-Z0-9_-]+)$/.exec(pathname);
      if (match && method === 'PATCH') {
        const fields = projectFields(await readJsonBody(req), resourceIds, true);
        return json(200, await mutate(draft => Object.assign(getProject(draft, match[1]), fields)));
      }
      if (match && method === 'DELETE') return json(200, await mutate(draft => {
        getProject(draft, match[1]);
        draft.projects = draft.projects.filter(item => item.id !== match[1]);
        for (const transaction of draft.transactions) if (transaction.projectId === match[1]) transaction.projectId = '';
      }));
      match = /^\/api\/projects\/([a-zA-Z0-9_-]+)\/tasks$/.exec(pathname);
      if (match && method === 'POST') {
        const body = await readJsonBody(req);
        const title = string(body.title, '任务标题', 250, { required: true });
        return json(201, await mutate(draft => {
          const project = getProject(draft, match[1]);
          if (project.tasks.length >= MAX_ITEMS) invalid('任务数量已达上限');
          project.tasks.push({ id: randomUUID(), title, done: false });
        }));
      }
      match = /^\/api\/projects\/([a-zA-Z0-9_-]+)\/tasks\/([a-zA-Z0-9_-]+)$/.exec(pathname);
      if (match && method === 'PATCH') {
        const body = await readJsonBody(req);
        if (typeof body.done !== 'boolean') invalid('任务完成状态应为布尔值');
        return json(200, await mutate(draft => { getTask(getProject(draft, match[1]), match[2]).done = body.done; }));
      }
      if (match && method === 'DELETE') return json(200, await mutate(draft => {
        const project = getProject(draft, match[1]);
        getTask(project, match[2]);
        project.tasks = project.tasks.filter(item => item.id !== match[2]);
      }));
      if (method === 'POST' && pathname === '/api/transactions') {
        const body = await readJsonBody(req);
        const transactionId = randomUUID();
        const saved = await mutate(draft => {
          if (draft.transactions.length >= MAX_ITEMS) invalid('收支数量已达上限');
          draft.transactions.push({ id: transactionId, ...transactionFields(body, new Set(draft.projects.map(item => item.id))) });
        });
        return json(201, { ...saved, savedTransactionId: transactionId });
      }
      match = /^\/api\/transactions\/([a-zA-Z0-9_-]+)$/.exec(pathname);
      if (match && method === 'PATCH') {
        const body = await readJsonBody(req);
        return json(200, await mutate(draft => Object.assign(getTransaction(draft, match[1]), transactionFields(body, new Set(draft.projects.map(item => item.id))))));
      }
      if (match && method === 'DELETE') {
        let files = [];
        return json(200, await mutate(draft => {
          if (backupReaders) throw new AppError(409, '完整备份正在下载，请下载完成后再删除记录');
          files = getTransaction(draft, match[1]).attachments || [];
          draft.transactions = draft.transactions.filter(item => item.id !== match[1]);
        }, () => cleanFiles(files)));
      }
      if (method === 'GET' || method === 'HEAD') {
        const file = staticFiles.get(pathname);
        if (file) {
          let buffer;
          try { buffer = await readFile(file[0]); }
          catch (error) { if (error.code === 'ENOENT') throw new AppError(404, '页面文件不存在'); throw error; }
          res.writeHead(200, { 'Content-Type': file[1], 'Content-Length': buffer.length });
          return res.end(method === 'HEAD' ? undefined : buffer);
        }
      }
      throw new AppError(404, '请求的页面或接口不存在');
    } catch (error) {
      const expected = error instanceof AppError || error instanceof AiError || error instanceof FileError;
      if (!expected) console.error(error);
      if (!res.headersSent) json(expected ? error.status : 500, { error: expected ? error.message : '保存或读取失败，请查看服务器日志；数据未成功更新。' });
      else res.end();
    }
  });
  server.requestTimeout = 300000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8765);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT 必须为 1024–65535 的整数');
  try {
    const server = await createApp();
    server.on('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log(`聚金已启动：http://127.0.0.1:${port}\n仅本机访问；Ctrl+C 停止。`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  } catch (error) { console.error(`启动失败：${error.message}`); process.exitCode = 1; }
}
