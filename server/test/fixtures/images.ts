/** Tiny but structurally valid files carrying fake "GPS" metadata. */
export function fakeJpeg(width = 640, height = 480): Buffer {
  const exif = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('GPS 19.0436 72.8193')]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), u16(exif.length + 2), exif]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), u16(17), Buffer.from([8]), u16(height), u16(width), Buffer.alloc(10)]);
  const sos = Buffer.concat([Buffer.from([0xff, 0xda]), u16(8), Buffer.alloc(6), Buffer.from('IMAGEDATA'), Buffer.from([0xff, 0xd9])]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, sos]);
}
function u16(n: number) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
function pngChunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}
export function fakePng(width = 300, height = 200): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('tEXt', Buffer.from('Comment\0GPS 19.0436')),
    pngChunk('IDAT', Buffer.from('pixels')),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
export function fakeWebp(width = 800, height = 600): Buffer {
  const vp8x = Buffer.alloc(10);
  vp8x[0] = 0x08; // EXIF flag
  vp8x.writeUIntLE(width - 1, 4, 3);
  vp8x.writeUIntLE(height - 1, 7, 3);
  const chunk = (type: string, data: Buffer) => {
    const h = Buffer.alloc(8);
    h.write(type, 0, 'ascii');
    h.writeUInt32LE(data.length, 4);
    return Buffer.concat([h, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  };
  const body = Buffer.concat([chunk('VP8X', vp8x), chunk('EXIF', Buffer.from('GPS 19.0436 ')), chunk('VP8 ', Buffer.alloc(10))]);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}
