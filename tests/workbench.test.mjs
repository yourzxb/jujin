import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.resolve(root, 'test-results');
const daily = JSON.parse(await readFile(path.join(root, 'catalog/daily-discovery.json'), 'utf8'));
const expectedResources = 42 + daily.resources.length;
const expectedIdeas = 54 + daily.inspirations.length;
const expectedRepos = 33 + daily.resources.length;

async function fixture(t, initialData) {
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(path.join(testRoot, 'api-'));
  if (initialData) await writeFile(path.join(dir, 'state.json'), JSON.stringify(initialData));
  let server;
  let base;
  const start = async () => {
    server = await createApp({ dataDir: dir, sourceDir: path.join(root, 'catalog'), publicDir: path.join(root, 'public') });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => {
    if (server?.listening) {
      server.closeAllConnections?.();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  };
  await start();
  t.after(async () => {
    await stop();
    // Only remove this test's generated temporary directory.
    assert.equal(path.dirname(path.resolve(dir)), testRoot);
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (url, method = 'GET', body, extraHeaders = {}) => {
    const response = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    return { status: response.status, body: await response.json() };
  };
  const ok = async (...args) => {
    const response = await request(...args);
    assert.ok(response.status >= 200 && response.status < 300, JSON.stringify(response));
    return response.body;
  };
  return { ok, request, restart: async () => { await stop(); await start(); }, text: async url => (await fetch(base + url)).text(), dir };
}

test('resources contain real repositories, official platforms and documents; inspirations remain separate', async t => {
  const app = await fixture(t);
  const state = await app.ok('/api/state');
  assert.equal(state.resources.length, expectedResources);
  assert.equal(state.projects.length, 0);
  assert.equal(state.transactions.length, 0);
  assert.equal(new Set(state.resources.map(r => r.id)).size, state.resources.length);
  assert.ok(state.resources.every(r => r.region === '中国大陆' && r.id.startsWith('cn-')));
  assert.equal(state.inspirations.length, expectedIdeas);
  assert.equal(state.inspirations.filter(r => r.category === '人工智能产品').length, 7);
  assert.ok(state.resources.every(r => r.documentationUrl && r.resourceDescription && r.resourceKind));
  assert.ok(state.inspirations.every(r => !r.repository && !state.resources.some(resource => resource.id === r.id)));
  assert.equal(state.meta.resourceCount, expectedResources);
  assert.equal(state.meta.directionCount, expectedIdeas);
  const repositories = state.resources.filter(r => r.repository);
  assert.equal(repositories.length, expectedRepos);
  assert.ok(repositories.every(r => r.url.startsWith('https://github.com/') && r.upstreamCommitDate && r.licenseNote && r.upstreamCommit));
  assert.ok(repositories.some(r => r.repository === 'gongfuxiang/shopxo'));
  assert.ok(repositories.find(r => r.repository === 'labring/FastGPT').licenseNote.includes('多租户'));
  assert.equal(state.meta.repositoryCount, expectedRepos);
  assert.ok(!state.resources.some(r => /WordPress|Shopify|Amazon|Coinbase/.test(r.name)));
  assert.ok(state.resources.every(r => r.sources.length));
  assert.equal(state.meta.platformCount, 9);
  const additions = state.inspirations.filter(r => r.addedAt?.startsWith('2026-10-31'));
  assert.equal(additions.length, 20);
  assert.equal(additions.filter(r => r.batch === 'workflow-2026-10-31').length, 10);
  assert.ok(additions.every(r => r.firstSteps.length === 3 && r.existingBusinessFit && r.deliverable && r.maintenance && r.costNotes && r.sources.length >= 2));
  assert.ok(additions.every(r => state.resources.some(resource => resource.repository === r.sourceRepository && resource.url === r.url)));
  assert.equal(new Set(state.inspirations.map(r => r.id)).size, state.inspirations.length);
  assert.ok((await app.text('/source/resource-directory.md')).includes('doocs/md'));
  assert.ok(state.resources.every(r => /^https?:\/\//.test(r.url) && r.category && r.categoryLabel));
  assert.ok(!state.resources.some(r => r.url.startsWith('#')));
  assert.equal((await app.ok('/api/health')).app, 'passive-income-workbench');
});

test('project, tasks and precise RMB ledger persist through restart and project deletion', async t => {
  const app = await fixture(t);
  let state = await app.ok('/api/projects', 'POST', { name: '数字模板', description: '测试数据', status: 'active', resourceId: '' });
  const project = state.projects[0];
  state = await app.ok(`/api/projects/${project.id}/tasks`, 'POST', { title: '制作第一版模板' });
  const task = state.projects[0].tasks[0];
  state = await app.ok(`/api/projects/${project.id}/tasks/${task.id}`, 'PATCH', { done: true });
  assert.equal(state.projects[0].tasks[0].done, true);
  state = await app.ok(`/api/projects/${project.id}`, 'PATCH', { name: '模板产品', status: 'paused' });
  assert.equal(state.projects[0].name, '模板产品');
  await app.ok('/api/transactions', 'POST', { type: 'income', amountCents: 1234, date: '2026-10-31', projectId: project.id, note: '测试销售' });
  state = await app.ok('/api/transactions', 'POST', { type: 'expense', amountCents: 199, date: '2026-10-31', projectId: project.id, note: '测试成本' });
  assert.equal(state.transactions.reduce((s, row) => s + (row.type === 'income' ? row.amountCents : -row.amountCents), 0), 1035);
  await app.restart();
  state = await app.ok('/api/state');
  assert.equal(state.projects[0].tasks[0].done, true);
  assert.equal(state.transactions.length, 2);
  state = await app.ok(`/api/projects/${project.id}/tasks/${task.id}`, 'DELETE');
  assert.equal(state.projects[0].tasks.length, 0);
  state = await app.ok(`/api/projects/${project.id}`, 'DELETE');
  assert.equal(state.projects.length, 0);
  assert.equal(state.transactions.length, 2);
  assert.ok(state.transactions.every(row => row.projectId === ''));
  const transactionId = state.transactions[0].id;
  state = await app.ok(`/api/transactions/${transactionId}`, 'DELETE');
  assert.equal(state.transactions.length, 1);
});

test('concurrent saves preserve favorites and atomic state on disk', async t => {
  const app = await fixture(t);
  const stateBefore = await app.ok('/api/state');
  const resources = [...stateBefore.resources.slice(0, 6), ...stateBefore.inspirations.slice(0, 6)];
  await Promise.all(resources.slice(0, 12).map(resource => app.ok('/api/favorites', 'POST', { resourceId: resource.id })));
  let state = await app.ok('/api/state');
  assert.equal(state.favorites.length, 12);
  await app.restart();
  state = await app.ok('/api/state');
  assert.equal(state.favorites.length, 12);
  state = await app.ok('/api/favorites', 'POST', { resourceId: resources[0].id });
  assert.equal(state.favorites.length, 11);
  const disk = JSON.parse(await readFile(path.join(app.dir, 'state.json'), 'utf8'));
  assert.equal(disk.favorites.length, 11);
});

test('rejects invalid amounts, dates, references and foreign-origin writes', async t => {
  const app = await fixture(t);
  const row = { type: 'income', amountCents: 100, date: '2026-10-31', projectId: '', note: '' };
  for (const patch of [{ amountCents: -1 }, { amountCents: 1.25 }, { date: '2026-02-30' }, { projectId: 'missing' }, { type: 'other' }]) {
    const response = await app.request('/api/transactions', 'POST', { ...row, ...patch });
    assert.equal(response.status, 400, JSON.stringify(patch));
  }
  assert.equal((await app.request('/api/projects', 'POST', { name: '  ' })).status, 400);
  assert.equal((await app.request('/api/favorites', 'POST', { resourceId: 'missing' })).status, 400);
  assert.equal((await app.request('/api/projects', 'POST', { name: '攻击测试' }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await app.ok('/api/state')).transactions.length, 0);
});

test('backup can be restored, and invalid restore cannot partially overwrite state', async t => {
  const app = await fixture(t);
  await app.ok('/api/projects', 'POST', { name: '备份测试', status: 'idea' });
  const backup = await app.ok('/api/backup');
  assert.equal(backup.schemaVersion, 1);
  await app.ok('/api/projects', 'POST', { name: '临时项目', status: 'active' });
  let state = await app.ok('/api/restore', 'POST', backup);
  assert.equal(state.projects.length, 1);
  const invalid = structuredClone(backup);
  invalid.transactions.push({ id: 'bad', type: 'income', amountCents: -100, date: '2026-10-31', projectId: '', note: '' });
  assert.equal((await app.request('/api/restore', 'POST', invalid)).status, 400);
  state = await app.ok('/api/state');
  assert.equal(state.projects[0].name, '备份测试');
  assert.equal(state.transactions.length, 0);
  await app.restart();
  assert.equal((await app.ok('/api/state')).projects.length, 1);
});

test('CSV is Chinese Excel-compatible and neutralizes spreadsheet formulas', async t => {
  const app = await fixture(t);
  await app.ok('/api/transactions', 'POST', { type: 'income', amountCents: 1234, date: '2026-10-31', projectId: '', note: '=HYPERLINK("https://example.com")' });
  const csv = await app.text('/api/transactions.csv');
  assert.match(csv, /12\.34/);
  assert.match(csv, /收入/);
  assert.match(csv, /'=HYPERLINK/);
  const html = await app.text('/');
  assert.match(html, /<html[^>]*lang="zh/);
});

test('domestic catalogue migration preserves projects, tasks and ledger while retiring foreign references', async t => {
  const retired = 'fd9ed851e56a57781a20';
  const previous = { schemaVersion: 1, favorites: [retired], projects: [{ id: 'existing-project', name: '原有项目', description: '保留内容', status: 'active', resourceId: retired, createdAt: '2026-10-31T00:00:00.000Z', tasks: [{ id: 'existing-task', title: '已完成任务', done: true }] }], transactions: [{ id: 'existing-record', type: 'income', amountCents: 321, date: '2026-10-31', projectId: 'existing-project', note: '原有收支' }], updatedAt: '2026-10-31T00:00:00.000Z' };
  const app = await fixture(t, previous);
  let state = await app.ok('/api/state');
  assert.equal(state.resources.length, expectedResources);
  assert.deepEqual(state.favorites, []);
  assert.equal(state.projects[0].resourceId, '');
  assert.equal(state.projects[0].description, '保留内容');
  assert.deepEqual(state.projects[0].tasks, previous.projects[0].tasks);
  assert.deepEqual(state.transactions, previous.transactions);
  assert.deepEqual(JSON.parse(await readFile(path.join(app.dir, 'state.before-domestic-2026-10-31.json'), 'utf8')), previous);
  state = await app.ok('/api/restore', 'POST', previous);
  assert.deepEqual(state.favorites, []);
  assert.equal(state.projects[0].resourceId, '');
  await app.restart();
  assert.equal((await app.ok('/api/state')).projects[0].tasks[0].done, true);
  assert.match(await app.text('/source/china-resources.md'), /国内项目灵感与来源说明/);
  assert.equal((await app.request('/source/LICENSE')).status, 404);
});

test('moving inspiration cards preserves saved projects, task progress and favorites on restore', async t => {
  const app = await fixture(t);
  const initial = await app.ok('/api/state');
  const inspiration = initial.inspirations.find(r => r.id === 'cn-college-guide');
  const repository = initial.resources[0];
  await app.ok('/api/favorites', 'POST', { resourceId: inspiration.id });
  await app.ok('/api/favorites', 'POST', { resourceId: repository.id });
  const created = await app.ok('/api/projects', 'POST', { name: '已有灵感项目', resourceId: inspiration.id });
  const project = created.projects[0];
  const tasked = await app.ok(`/api/projects/${project.id}/tasks`, 'POST', { title: '已完成的资料核对' });
  const task = tasked.projects[0].tasks[0];
  await app.ok(`/api/projects/${project.id}/tasks/${task.id}`, 'PATCH', { done: true });
  const backup = await app.ok('/api/backup');
  await app.restart();
  let state = await app.ok('/api/state');
  assert.equal(state.resources.length, expectedResources);
  assert.equal(state.inspirations.length, expectedIdeas);
  assert.equal(state.projects[0].resourceId, inspiration.id);
  assert.equal(state.projects[0].tasks[0].done, true);
  assert.deepEqual(state.favorites, [inspiration.id, repository.id]);
  state = await app.ok('/api/restore', 'POST', backup);
  assert.equal(state.projects[0].resourceId, inspiration.id);
  assert.equal(state.projects[0].tasks[0].done, true);
  assert.deepEqual(state.favorites, [inspiration.id, repository.id]);
});
