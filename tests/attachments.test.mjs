import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createApp } from '../server.mjs';
import { writeZip } from '../lib/archive.mjs';

const testRoot = fileURLToPath(new URL('../test-results/', import.meta.url));
async function fixture(t) {
  await mkdir(testRoot, { recursive: true });
  const dir = await mkdtemp(path.join(testRoot, 'files-'));
  let server, base;
  const start = async () => { server = await createApp({ dataDir: dir }); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; };
  const stop = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  await start();
  t.after(async () => { await stop(); assert.equal(path.dirname(path.resolve(dir)), path.resolve(testRoot)); await rm(dir, { recursive: true, force: true }); });
  const request = async (url, method = 'GET', body, binary = false, headers = {}) => {
    const response = await fetch(base + url, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: binary ? body : JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  };
  return { request, dir, fetch: (url, options) => fetch(base + url, options), base: () => base, restart: async () => { await stop(); await start(); } };
}
const row = { type: 'expense', amountCents: 12345, date: '2026-10-31', projectId: '', note: '附件测试\n第二行' };
async function addRow(app, fields = {}) {
  const result = await app.request('/api/transactions', 'POST', { ...row, ...fields });
  assert.equal(result.status, 201);
  return result.body.transactions.find(item => item.id === result.body.savedTransactionId);
}
async function addFile(app, transactionId, name, bytes) {
  return app.request(`/api/transactions/${transactionId}/attachments?name=${encodeURIComponent(name)}`, 'POST', bytes, true);
}
async function zipBuffer(entries, dir) {
  const filename = path.join(dir, 'fixture.zip');
  const stream = createWriteStream(filename);
  const finished = once(stream, 'finish');
  await writeZip(stream, entries.map(([name, buffer]) => ({ name, buffer, size: buffer.length })));
  await finished;
  return readFile(filename);
}

test('opaque documents, images and archives download unchanged and remain attached after editing and restart', async t => {
  const app = await fixture(t);
  const note = ('长备注：保留换行和内容。\n').repeat(300);
  const transaction = await addRow(app, { note });
  const samples = [['付款凭证.png', Buffer.from([137, 80, 78, 71, 0, 255])], ['交付文档.docx', Buffer.from('文档内容\u0000')], ['源文件压缩包.zip', Buffer.from([80, 75, 3, 4, 255, 0])]];
  for (const [name, bytes] of samples) assert.equal((await addFile(app, transaction.id, name, bytes)).status, 201);
  let current = (await app.request('/api/state')).body.transactions[0];
  assert.equal(current.attachments.length, 3);
  for (let index = 0; index < samples.length; index++) {
    const file = current.attachments[index];
    const response = await app.fetch(`/api/transactions/${transaction.id}/attachments/${file.id}`);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.ok(response.headers.get('content-disposition').includes('attachment;'));
    assert.ok(response.headers.get('content-disposition').includes(encodeURIComponent(file.name)));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), samples[index][1]);
  }
  assert.equal((await app.request(`/api/transactions/${transaction.id}`, 'PATCH', { ...row, note, amountCents: 678 })).status, 200);
  await app.restart();
  current = (await app.request('/api/state')).body.transactions[0];
  assert.equal(current.note, note.trim()); assert.equal(current.amountCents, 678); assert.equal(current.attachments.length, 3);
  const first = current.attachments[0];
  assert.equal((await app.request(`/api/transactions/${transaction.id}/attachments/${first.id}`, 'DELETE')).status, 200);
  assert.equal((await app.fetch(`/api/transactions/${transaction.id}/attachments/${first.id}`)).status, 404);
  await assert.rejects(readFile(path.join(app.dir, 'attachments', first.id + '.bin')), { code: 'ENOENT' });
  assert.equal((await app.request(`/api/transactions/${transaction.id}`, 'DELETE')).status, 200);
  assert.equal((await readdir(path.join(app.dir, 'attachments'))).length, 0);
});

test('complete ZIP migrates records and binary attachments into another data directory; JSON stays compatible', async t => {
  const source = await fixture(t), target = await fixture(t);
  const transaction = await addRow(source);
  const bytes = Buffer.from('完整备份中的附件\u0000\u00ff');
  await addFile(source, transaction.id, '证明材料.rar', bytes);
  await target.request('/api/projects', 'POST', { name: '恢复前的记录' });
  const metadata = (await source.request('/api/backup')).body;
  assert.equal((await target.request('/api/restore', 'POST', metadata)).status, 400);
  assert.equal((await target.request('/api/state')).body.projects.length, 1);
  const response = await source.fetch('/api/backup.zip');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/zip');
  const archive = Buffer.from(await response.arrayBuffer());
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  const preview = await target.request('/api/restore-archive/preview', 'POST', archive, true, { 'Content-Type': 'application/zip' });
  assert.equal(preview.status, 200); assert.equal(preview.body.attachments, 1); assert.equal(preview.body.transactions, 1);
  assert.equal((await target.request('/api/state')).body.projects.length, 1);
  assert.equal((await target.request('/api/restore-archive', 'POST', archive, true, { 'Content-Type': 'application/zip' })).status, 200);
  await target.restart();
  const restored = (await target.request('/api/state')).body;
  assert.equal(restored.projects.length, 0); assert.equal(restored.transactions[0].note, row.note);
  const file = restored.transactions[0].attachments[0];
  const downloaded = await target.fetch(`/api/transactions/${transaction.id}/attachments/${file.id}`);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  const tampered = structuredClone(metadata); tampered.transactions[0].attachments[0].sha256 = '0'.repeat(64);
  assert.equal((await target.request('/api/restore', 'POST', tampered)).status, 400);
  assert.equal((await target.request('/api/restore', 'POST', metadata)).status, 200);
  assert.equal((await readdir(path.join(target.dir, 'temporary'))).length, 0);
  const legacy = { schemaVersion: 1, favorites: [], projects: [], transactions: [{ id: 'legacy-row', ...row }] };
  assert.equal((await target.request('/api/restore', 'POST', legacy)).status, 200);
});

test('file limits, unsafe names, foreign origins and invalid edits cannot overwrite records', async t => {
  const app = await fixture(t);
  const transaction = await addRow(app);
  assert.equal((await addFile(app, transaction.id, '../escape.txt', Buffer.from('no'))).status, 400);
  const route = `/api/transactions/${transaction.id}/attachments?name=test.txt`;
  assert.equal((await app.request(route, 'POST', Buffer.from('no'), true, { Origin: 'https://other.example' })).status, 403);
  const tooBig = await new Promise((resolve, reject) => {
    const req = http.request(app.base() + route, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': 50 * 1024 * 1024 + 1 } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    req.on('error', reject); req.end();
  });
  assert.equal(tooBig, 413);
  for (let index = 0; index < 10; index++) assert.equal((await addFile(app, transaction.id, `file-${index}.zip`, Buffer.from([index]))).status, 201);
  assert.equal((await addFile(app, transaction.id, 'extra.zip', Buffer.from('no'))).status, 400);
  assert.equal((await app.request(`/api/transactions/${transaction.id}`, 'PATCH', { ...row, amountCents: -1 })).status, 400);
  assert.equal((await app.request('/api/state')).body.transactions[0].amountCents, row.amountCents);
  assert.equal((await readdir(path.join(app.dir, 'attachments'))).length, 10);
});

test('corrupt ZIP, traversal and mismatched attachment checksums fail before restoring business data', async t => {
  const app = await fixture(t);
  await app.request('/api/projects', 'POST', { name: '必须保留' });
  const legacy = { schemaVersion: 1, favorites: [], projects: [], transactions: [] };
  let archive = await zipBuffer([['state.json', Buffer.from(JSON.stringify(legacy))], ['../outside.txt', Buffer.from('bad')]], app.dir);
  assert.equal((await app.request('/api/restore-archive', 'POST', archive, true, { 'Content-Type': 'application/zip' })).status, 400);
  archive = await zipBuffer([['state.json', Buffer.from(JSON.stringify(legacy))]], app.dir);
  const corrupt = Buffer.from(archive); corrupt[30 + 'state.json'.length + 1] ^= 1;
  assert.equal((await app.request('/api/restore-archive/preview', 'POST', corrupt, true, { 'Content-Type': 'application/zip' })).status, 400);
  const id = '00000000-0000-4000-8000-000000000000';
  const invalid = { ...legacy, transactions: [{ id: 'row', ...row, attachments: [{ id, name: 'file.zip', size: 3, sha256: '0'.repeat(64), createdAt: '2026-10-31T00:00:00Z' }] }] };
  archive = await zipBuffer([['state.json', Buffer.from(JSON.stringify(invalid))], [`attachments/${id}.bin`, Buffer.from('abc')]], app.dir);
  assert.equal((await app.request('/api/restore-archive', 'POST', archive, true, { 'Content-Type': 'application/zip' })).status, 400);
  assert.equal((await app.request('/api/state')).body.projects[0].name, '必须保留');
  assert.equal((await readdir(path.join(app.dir, 'temporary'))).length, 0);
  await assert.rejects(readFile(path.join(testRoot, 'outside.txt')), { code: 'ENOENT' });
});

test('Windows standard ZIP reader opens exports and its deflated ZIP can be restored', { skip: process.platform !== 'win32' }, async t => {
  const source = await fixture(t), target = await fixture(t);
  const transaction = await addRow(source);
  const bytes = Buffer.from('independent ZIP implementation '.repeat(200));
  await addFile(source, transaction.id, 'standard-test.zip', bytes);
  const response = await source.fetch('/api/backup.zip');
  const archive = Buffer.from(await response.arrayBuffer());
  const input = path.join(source.dir, 'standard-input.zip');
  const output = path.join(source.dir, 'standard-deflated.zip');
  await writeFile(input, archive);
  const script = fileURLToPath(new URL('../scripts/check-zip-interop.ps1', import.meta.url));
  const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-InputArchive', input, '-OutputArchive', output], { windowsHide: true, timeout: 20000 });
  assert.match(result.stdout, /Validated entries: 2/);
  const restored = await target.request('/api/restore-archive', 'POST', await readFile(output), true, { 'Content-Type': 'application/zip' });
  assert.equal(restored.status, 200);
  const file = restored.body.transactions[0].attachments[0];
  const download = await target.fetch(`/api/transactions/${transaction.id}/attachments/${file.id}`);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
});

test('an archive preview holds an exclusive file-operation slot while its upload is incomplete',async t=>{
 const app=await fixture(t);const transaction=await addRow(app);
 const upload=http.request(app.base()+'/api/restore-archive/preview',{method:'POST',headers:{'Content-Type':'application/zip','Content-Length':'4',Expect:'100-continue'}});
 upload.on('error',()=>{});
 const continued=once(upload,'continue');upload.flushHeaders();await continued;
 const blocked=await app.request('/api/transactions/'+transaction.id+'/attachments?name=blocked.txt','POST',Buffer.from('test'),true);
 assert.equal(blocked.status,429);
 const complete=new Promise(resolve=>upload.on('response',response=>{response.resume();response.on('end',()=>resolve(response.statusCode));}));
 upload.end('bad!');assert.equal(await complete,400);
 const permitted=await app.request('/api/transactions/'+transaction.id+'/attachments?name=allowed.txt','POST',Buffer.from('test'),true);assert.equal(permitted.status,201);
});
