import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const testRoot = path.join(root, 'test-results');
async function fixture(t, aiFetch) {
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(path.join(testRoot, 'ai-'));
  let server, base;
  const start = async () => {
    server = await createApp({ dataDir: dir, aiFetch });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start();
  t.after(async () => { await stop(); assert.equal(path.dirname(dir), testRoot); await rm(dir, { recursive: true, force: true }); });
  const request = async (url, method = 'GET', body) => {
    const result = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: result.status, body: await result.json() };
  };
  return { request, dir, restart: async () => { await stop(); await start(); } };
}
const tasks = [{ title: '核对官方学校名录', stage: '资料准备', estimatedHours: 2, deliverable: '记录官方来源及更新时间' }, { title: '访谈学生需求', stage: '需求验证', estimatedHours: 3, deliverable: '整理五次访谈的问题清单' }];

test('AI config remains private; preview does not mutate tasks; import is atomic and idempotent', async t => {
  let calls = 0;
  const app = await fixture(t, async (url, options) => {
    calls++;
    assert.equal(url, 'https://models.example.test/v1/chat/completions');
    const payload = JSON.parse(options.body);
    assert.equal(payload.stream, false);
    assert.equal(payload.model, 'provider/model-test');
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(payload.messages[1].content).name, '学校指导网站');
    assert.ok(!JSON.stringify(payload).includes('transactions'));
    assert.equal(options.headers.Authorization, 'Bearer test-key-never-return-this');
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '先验证需求，再核对资料', tasks }) } }] });
  });
  assert.equal((await app.request('/api/ai/config')).body.configured, false);
  const p = (await app.request('/api/projects', 'POST', { name: '学校指导网站' })).body.projects[0];
  await app.request(`/api/projects/${p.id}/tasks`, 'POST', { title: '已有任务' });
  assert.equal((await app.request(`/api/projects/${p.id}/ai-plan`, 'POST', {})).status, 409);
  const secret = 'test-key-never-return-this';
  const config = await app.request('/api/ai/config', 'POST', { apiKey: secret, model: 'provider/model-test', baseUrl: 'https://models.example.test/v1/' });
  assert.equal(config.status, 200);
  assert.ok(!JSON.stringify(config.body).includes(secret));
  const plan = await app.request(`/api/projects/${p.id}/ai-plan`, 'POST', { requirements: '30 天完成，先做需求验证' });
  assert.equal(plan.status, 200);
  assert.equal(calls, 1);
  assert.equal((await app.request('/api/state')).body.projects[0].tasks.length, 1);
  const added = await app.request(`/api/projects/${p.id}/tasks/batch`, 'POST', plan.body);
  assert.equal(added.body.projects[0].tasks.length, 3);
  const again = await app.request(`/api/projects/${p.id}/tasks/batch`, 'POST', plan.body);
  assert.equal(again.body.projects[0].tasks.length, 3);
  const backup = (await app.request('/api/backup')).body;
  assert.ok(!JSON.stringify(backup).includes(secret));
  assert.equal(backup.projects[0].tasks[1].estimatedHours, 2);
  await app.restart();
  assert.equal((await app.request('/api/ai/config')).body.configured, true);
  assert.equal((await app.request('/api/state')).body.projects[0].tasks[1].stage, '资料准备');
  assert.equal((await app.request('/api/restore', 'POST', backup)).status, 200);
  assert.ok((await readFile(path.join(app.dir, 'ai-config.json'), 'utf8')).includes(secret));
});

test('upstream failures and invalid plans never write tasks or disclose API secrets', async t => {
  let kind = 'auth';
  const app = await fixture(t, async () => kind === 'auth' ? Response.json({ error: 'secret-api-key' }, { status: 401 }) : Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'invalid-json' } }] }));
  const p = (await app.request('/api/projects', 'POST', { name: '异常测试' })).body.projects[0];
  await app.request('/api/ai/config', 'POST', { apiKey: 'secret-api-key', model: 'provider/model-test', baseUrl: 'https://models.example.test/v1/' });
  let result = await app.request(`/api/projects/${p.id}/ai-plan`, 'POST', {});
  assert.equal(result.status, 502);
  assert.ok(!JSON.stringify(result).includes('secret-api-key'));
  kind = 'invalid';
  result = await app.request(`/api/projects/${p.id}/ai-plan`, 'POST', {});
  assert.equal(result.status, 502);
  result = await app.request(`/api/projects/${p.id}/tasks/batch`, 'POST', { planId: 'bad-plan', tasks: [tasks[0], { ...tasks[1], estimatedHours: -1 }] });
  assert.equal(result.status, 400);
  assert.equal((await app.request('/api/state')).body.projects[0].tasks.length, 0);
});

test('compatible endpoint normalization and provider changes protect the saved key', async t => {
  let called = 0;
  const app = await fixture(t, async () => { called++; return Response.json({}); });
  const initial = { baseUrl: 'https://third.example.test/api/v1/chat/completions', model: 'vendor/model:latest', apiKey: 'private-provider-key' };
  let result = await app.request('/api/ai/config', 'POST', initial);
  assert.equal(result.status, 200);
  assert.equal(result.body.baseUrl, 'https://third.example.test/api/v1');
  assert.equal(result.body.endpoint, 'https://third.example.test/api/v1/chat/completions');
  result = await app.request('/api/ai/config', 'POST', { ...initial, apiKey: '' });
  assert.equal(result.status, 200);
  assert.equal((await app.request('/api/ai/config', 'POST', { ...initial, baseUrl: 'https://another.example.test/v1', apiKey: '' })).status, 400);
  assert.equal((await app.request('/api/ai/config')).body.baseUrl, 'https://third.example.test/api/v1');
  for (const baseUrl of ['http://remote.example.test/v1', 'https://key@example.test/v1', 'https://example.test/v1?key=secret', 'https://example.test/v1#key']) {
    assert.equal((await app.request('/api/ai/config', 'POST', { ...initial, baseUrl })).status, 400);
  }
  assert.equal((await app.request('/api/ai/config', 'POST', { ...initial, baseUrl: 'http://127.0.0.1:8080/v1' })).status, 200);
  assert.equal(called, 0);
  assert.ok(!JSON.stringify((await app.request('/api/ai/config')).body).includes(initial.apiKey));
});

test('fenced JSON is accepted while incomplete or incompatible model responses cannot change tasks', async t => {
  let mode = 'fenced';
  const app = await fixture(t, async () => Response.json(mode === 'wrong' ? { output: [] } : { choices: [{ finish_reason: mode === 'length' ? 'length' : 'stop', message: { content: String.fromCharCode(96).repeat(3) + 'json\n' + JSON.stringify({summary: '计划', tasks}) + '\n' + String.fromCharCode(96).repeat(3) } }] }));
  const p = (await app.request('/api/projects', 'POST', { name: '兼容性测试' })).body.projects[0];
  await app.request('/api/ai/config', 'POST', { baseUrl: 'https://models.example.test/v1', model: 'provider/model-test', apiKey: 'private-key' });
  assert.equal((await app.request('/api/projects/' + p.id + '/ai-plan', 'POST', {})).status, 200);
  for (mode of ['length', 'wrong']) assert.equal((await app.request('/api/projects/' + p.id + '/ai-plan', 'POST', {})).status, 502);
  assert.equal((await app.request('/api/state')).body.projects[0].tasks.length, 0);
});

test('oversized model responses with and without content-length are bounded and allow subsequent requests', async t => {
  let kind = 'length';
  const app = await fixture(t, async () => kind === 'length'
    ? new Response('{}', {headers: {'content-length': String(2 * 1024 * 1024)}})
    : kind === 'stream' ? new Response('x'.repeat(1024 * 1024 + 1))
    : Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({summary:'有效计划',tasks})}}]}));
  const project = (await app.request('/api/projects', 'POST', {name:'响应限额测试'})).body.projects[0];
  await app.request('/api/ai/config', 'POST', {apiKey:'test-bounded-key',model:'test-model',baseUrl:'https://models.example.test/v1'});
  for (kind of ['length','stream']) {
    const result = await app.request('/api/projects/'+project.id+'/ai-plan','POST',{});
    assert.equal(result.status,502);assert.match(result.body.error,/1 MiB/);
  }
  kind='valid';assert.equal((await app.request('/api/projects/'+project.id+'/ai-plan','POST',{})).status,200);
  assert.equal((await app.request('/api/state')).body.projects[0].tasks.length,0);
});
