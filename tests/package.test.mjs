import test from 'node:test';
import assert from 'node:assert/strict';
import { makeZip } from '../tools/zip.mjs';
import { crc32,png } from '../tools/png.mjs';
test('标准 CRC32 与确定性跨平台 ZIP',()=>{
 assert.equal(crc32(Buffer.from('123456789')),0xcbf43926);
 const entries=[{name:'extension/manifest.json',data:Buffer.from('{"manifest_version":3}')}];
 const zip=makeZip(entries);assert.equal(zip.readUInt32LE(0),0x04034b50);assert.equal(zip.readUInt32LE(zip.length-22),0x06054b50);
 assert.equal(zip.readUInt16LE(zip.length-14),1);assert.deepEqual(zip,makeZip(entries));
 assert.throws(()=>makeZip([{name:'../evil',data:Buffer.alloc(0)}]));
});
test('状态图标 PNG 为带透明度的规范图像',()=>{
 const bytes=png(1,1,new Uint8Array([1,2,3,255]));
 assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(bytes.readUInt32BE(16),1);assert.equal(bytes[25],6);
});
