import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

export class FileError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const FILE_LIMIT = 50 * 1024 * 1024;
export const RECORD_FILE_LIMIT = 200 * 1024 * 1024;
export const ARCHIVE_LIMIT = 512 * 1024 * 1024;
export const FILE_COUNT = 10;
export const attachmentPath = (dir, id) => path.join(dir, 'attachments', `${id}.bin`);
export function attachmentList(value = []) {
  if (!Array.isArray(value) || value.length > FILE_COUNT) throw new FileError(400, '每笔收支最多保存 10 个附件');
  const items = value.map(item => {
    if (!item || !/^[0-9a-f-]{36}$/.test(item.id) || typeof item.name !== 'string' || !item.name.trim() || item.name.length > 240 || /[\x00-\x1f\x7f/\\]/.test(item.name) || !Number.isSafeInteger(item.size) || item.size < 0 || item.size > FILE_LIMIT || !/^[0-9a-f]{64}$/.test(item.sha256) || !Number.isFinite(Date.parse(item.createdAt))) throw new FileError(400, '附件信息格式不正确');
    return { id: item.id, name: item.name, size: item.size, sha256: item.sha256, createdAt: item.createdAt };
  });
  if (new Set(items.map(item => item.id)).size !== items.length) throw new FileError(400, '附件编号重复');
  if (items.reduce((sum, item) => sum + item.size, 0) > RECORD_FILE_LIMIT) throw new FileError(400, '每笔收支附件合计不能超过 200 MB');
  return items;
}
export function uploadName(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 240 || /[\x00-\x1f\x7f/\\]/.test(value) || value === '.' || value === '..') throw new FileError(400, '附件名称不正确');
  return value;
}
export async function receiveFile(req, destination, maxSize) {
  const announced = Number(req.headers['content-length']);
  if (Number.isFinite(announced) && announced > maxSize) throw new FileError(413, `文件超过 ${Math.round(maxSize / 1024 / 1024)} MB 上限`);
  let size = 0;
  const hash = createHash('sha256');
  const counter = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > maxSize) return callback(new FileError(413, '上传文件超过大小上限'));
    hash.update(chunk); callback(null, chunk);
  } });
  try { await pipeline(req, counter, createWriteStream(destination, { flags: 'wx', mode: 0o600 })); }
  catch (error) { await unlink(destination).catch(() => {}); throw error; }
  return { size, sha256: hash.digest('hex') };
}
export async function uploadAttachment(req, dir, name) {
  uploadName(name);
  await mkdir(path.join(dir, 'attachments'), { recursive: true });
  const id = randomUUID();
  const destination = attachmentPath(dir, id);
  const temporary = destination + '.part';
  const result = await receiveFile(req, temporary, FILE_LIMIT);
  try { await rename(temporary, destination); } catch (error) { await unlink(temporary).catch(() => {}); throw error; }
  return { id, name, ...result, createdAt: new Date().toISOString() };
}
export async function verifyFiles(dir, records) {
  for (const file of records.flatMap(row => row.attachments || [])) {
    try {
      const info = await stat(attachmentPath(dir, file.id));
      if (!info.isFile() || info.size !== file.size) throw new Error('size');
      if (await hashFile(attachmentPath(dir, file.id)) !== file.sha256) throw new Error('hash');
    } catch { throw new FileError(400, '备份中的附件文件不在本机，请选择包含附件的完整 ZIP 备份'); }
  }
}
export async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
