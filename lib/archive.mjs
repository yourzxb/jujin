import { createReadStream, createWriteStream } from 'node:fs';
import { open, stat, unlink } from 'node:fs/promises';
import { Transform, Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { once } from 'node:events';
import { FileError, FILE_LIMIT, ARCHIVE_LIMIT } from './files.mjs';

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
function crcUpdate(crc, bytes) {
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc >>> 0;
}
export function zipSize(entries) {
  return entries.reduce((sum, entry) => sum + 30 + Buffer.byteLength(entry.name) + entry.size + 16 + 46 + Buffer.byteLength(entry.name), 22);
}
// Store entries without recompression: archives, images and Office files are already compressed.
export async function writeZip(output, entries) {
  let offset = 0;
  const central = [];
  const write = async bytes => {
    if (output.destroyed) throw new Error('下载已断开');
    if (!output.write(bytes)) await once(output, 'drain');
    offset += bytes.length;
  };
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const start = offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x808, 6);
    header.writeUInt16LE(0x21, 12); header.writeUInt16LE(name.length, 26);
    await write(header); await write(name);
    let crc = 0xffffffff, size = 0;
    const input = entry.buffer ? Readable.from([entry.buffer]) : createReadStream(entry.file);
    for await (const chunk of input) { crc = crcUpdate(crc, chunk); size += chunk.length; await write(chunk); }
    if (size !== entry.size) throw new FileError(409, '备份期间文件发生变化，请重试');
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50); descriptor.writeUInt32LE(crc, 4); descriptor.writeUInt32LE(size, 8); descriptor.writeUInt32LE(size, 12);
    await write(descriptor);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x808, 8);
    record.writeUInt16LE(0x21, 14); record.writeUInt32LE(crc, 16); record.writeUInt32LE(size, 20); record.writeUInt32LE(size, 24);
    record.writeUInt16LE(name.length, 28); record.writeUInt32LE(start, 42);
    central.push(record, name);
  }
  const start = offset;
  for (const bytes of central) await write(bytes);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - start, 12); end.writeUInt32LE(start, 16);
  await write(end); output.end();
}
const bad = message => { throw new FileError(400, message || '不是受支持的完整 ZIP 备份'); };
async function bytesAt(handle, position, length) {
  const bytes = Buffer.alloc(length);
  const result = await handle.read(bytes, 0, length, position);
  if (result.bytesRead !== length) bad('ZIP 文件不完整');
  return bytes;
}
export async function readZip(filename) {
  const info = await stat(filename);
  if (info.size < 22 || info.size > ARCHIVE_LIMIT) bad('ZIP 备份大小不正确（最大 512 MB）');
  const handle = await open(filename, 'r');
  try {
    const tailSize = Math.min(info.size, 65557);
    const tail = await bytesAt(handle, info.size - tailSize, tailSize);
    let endIndex = -1;
    for (let index = tail.length - 22; index >= 0; index--) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) { endIndex = index; break; }
    }
    if (endIndex < 0) bad();
    const end = tail.subarray(endIndex);
    const count = end.readUInt16LE(10), directorySize = end.readUInt32LE(12), directoryStart = end.readUInt32LE(16);
    if (end.readUInt16LE(4) || end.readUInt16LE(6) || end.readUInt16LE(8) !== count || count > 10001 || directorySize > 8 * 1024 * 1024 || directoryStart + directorySize !== info.size - tailSize + endIndex) bad('ZIP 目录格式不受支持');
    const directory = await bytesAt(handle, directoryStart, directorySize);
    const entries = new Map();
    const ranges = [];
    let at = 0, expandedSize = 0;
    for (let index = 0; index < count; index++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50) bad();
      const flags = directory.readUInt16LE(at + 8), method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16), compressedSize = directory.readUInt32LE(at + 20), size = directory.readUInt32LE(at + 24);
      const nameSize = directory.readUInt16LE(at + 28), extra = directory.readUInt16LE(at + 30), comment = directory.readUInt16LE(at + 32), localOffset = directory.readUInt32LE(at + 42);
      if (flags & 1 || ![0, 8].includes(method) || at + 46 + nameSize + extra + comment > directory.length || directory.readUInt16LE(at + 34)) bad('不支持加密或特殊格式的 ZIP');
      const nameBytes = directory.subarray(at + 46, at + 46 + nameSize);
      const name = nameBytes.toString('utf8');
      if (!(name === 'state.json' || /^attachments\/[0-9a-f-]{36}\.bin$/.test(name)) || entries.has(name)) bad('ZIP 包含不允许的路径或重复文件');
      if (size > (name === 'state.json' ? 5 * 1024 * 1024 : FILE_LIMIT) || (method === 0 && compressedSize !== size)) bad('ZIP 内文件超过大小上限或尺寸不正确');
      expandedSize += size;
      if (expandedSize > ARCHIVE_LIMIT) bad('ZIP 解压后超过 512 MB 上限');
      const local = await bytesAt(handle, localOffset, 30);
      const localNameSize = local.readUInt16LE(26), localExtra = local.readUInt16LE(28);
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || localNameSize !== nameSize || !(await bytesAt(handle, localOffset + 30, localNameSize)).equals(nameBytes)) bad('ZIP 文件头不一致');
      const dataOffset = localOffset + 30 + localNameSize + localExtra;
      if (dataOffset + compressedSize > directoryStart) bad('ZIP 文件内容越界');
      ranges.push([localOffset, dataOffset + compressedSize]);
      entries.set(name, { filename, name, method, crc, compressedSize, size, dataOffset });
      at += 46 + nameSize + extra + comment;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    if (ranges.some((range, index) => index && range[0] < ranges[index - 1][1]) || at !== directory.length || !entries.has('state.json')) bad();
    return entries;
  } finally { await handle.close(); }
}
export async function extractZipEntry(entry, destination) {
  let size = 0, crc = 0xffffffff;
  const check = new Transform({ transform(chunk, encoding, callback) {
    size += chunk.length;
    if (size > entry.size) return callback(new FileError(400, 'ZIP 解压尺寸超出声明'));
    crc = crcUpdate(crc, chunk); callback(null, chunk);
  } });
  const input = entry.compressedSize ? createReadStream(entry.filename, { start: entry.dataOffset, end: entry.dataOffset + entry.compressedSize - 1 }) : Readable.from([]);
  try {
    await pipeline(...[input, ...(entry.method === 8 ? [createInflateRaw()] : []), check, createWriteStream(destination, { flags: 'wx', mode: 0o600 })]);
    if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) bad('ZIP 文件校验失败，未恢复数据');
  } catch (error) { await unlink(destination).catch(() => {}); if (error instanceof FileError) throw error; bad('ZIP 文件内容损坏'); }
}
