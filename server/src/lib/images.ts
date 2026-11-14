/**
 * Image checks without native dependencies (no compile step on the host):
 *  - detect the real type from the file's first bytes (FR-044, FR-175) — never trust names/headers;
 *  - read width/height;
 *  - strip metadata (EXIF incl. GPS location, XMP, comments) as defence in depth — the browser
 *    already re-encodes uploads, but a hand-crafted request could skip that.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageType(buf: Buffer): ImageType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export const EXTENSION: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function imageSize(buf: Buffer, type: ImageType): { width: number; height: number } | null {
  try {
    if (type === 'image/png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (type === 'image/webp') {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      return null;
    }
    // JPEG: walk segments until a Start-Of-Frame marker.
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  } catch {
    /* malformed */
  }
  return null;
}

/** JPEG: drop APP1 (EXIF/XMP), APP12/APP13 (Photoshop/IPTC) and COM segments. */
function stripJpeg(buf: Buffer): Buffer {
  const out: Buffer[] = [buf.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) return buf; // unexpected layout — leave untouched rather than corrupt
    const marker = buf[i + 1]!;
    if (marker === 0xda) {
      out.push(buf.subarray(i)); // start of scan: the rest is image data
      return Buffer.concat(out);
    }
    const len = buf.readUInt16BE(i + 2);
    const segment = buf.subarray(i, i + 2 + len);
    if (!(marker === 0xe1 || marker === 0xec || marker === 0xed || marker === 0xfe)) out.push(segment);
    i += 2 + len;
  }
  return buf;
}

/** PNG: drop text and EXIF chunks (tEXt, zTXt, iTXt, eXIf). */
function stripPng(buf: Buffer): Buffer {
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf']);
  const out: Buffer[] = [buf.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= buf.length) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString('ascii', i + 4, i + 8);
    const end = i + 12 + len;
    if (!drop.has(type)) out.push(buf.subarray(i, end));
    i = end;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}

/** WebP: drop EXIF/XMP chunks, clear their VP8X flags, fix the RIFF size. */
function stripWebp(buf: Buffer): Buffer {
  const out: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.toString('ascii', i, i + 4);
    const len = buf.readUInt32LE(i + 4);
    const end = i + 8 + len + (len % 2);
    if (type !== 'EXIF' && type !== 'XMP ') {
      const chunk = Buffer.from(buf.subarray(i, end));
      if (type === 'VP8X') chunk[8] = chunk[8]! & ~0x0c; // clear EXIF (0x08) and XMP (0x04) flags
      out.push(chunk);
    }
    i = end;
  }
  const body = Buffer.concat(out);
  const header = Buffer.alloc(12);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + body.length, 4);
  header.write('WEBP', 8, 'ascii');
  return Buffer.concat([header, body]);
}

export function stripMetadata(buf: Buffer, type: ImageType): Buffer {
  if (type === 'image/jpeg') return stripJpeg(buf);
  if (type === 'image/png') return stripPng(buf);
  return stripWebp(buf);
}
