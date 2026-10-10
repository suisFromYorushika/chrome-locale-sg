import { deflateSync } from 'node:zlib';
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function png(width, height, rgba) {
  const chunk = (type, data) => {
    const name = Buffer.from(type), length = Buffer.alloc(4), check = Buffer.alloc(4);
    length.writeUInt32BE(data.length); check.writeUInt32BE(crc32(Buffer.concat([name, data])));
    return Buffer.concat([length, name, data, check]);
  };
  const header = Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height, 4);
  header[8] = 8;header[9] = 6;
  const rows = Buffer.alloc(height * (width * 4 + 1));
  for (let y=0;y<height;y++) Buffer.from(rgba).copy(rows, y*(width*4+1)+1, y*width*4, (y+1)*width*4);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
