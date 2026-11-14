import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { detectImageType, imageSize, stripMetadata } from '../../src/lib/images.ts';
import { LocalDiskStorage } from '../../src/lib/storage.ts';
import { fakeJpeg, fakePng, fakeWebp } from '../fixtures/images.ts';

describe('image type detection (FR-044, FR-175)', () => {
  it('recognises JPEG, PNG and WebP by content', () => {
    expect(detectImageType(fakeJpeg())).toBe('image/jpeg');
    expect(detectImageType(fakePng())).toBe('image/png');
    expect(detectImageType(fakeWebp())).toBe('image/webp');
  });

  it('rejects anything else, whatever it is called', () => {
    expect(detectImageType(Buffer.from('%PDF-1.7 …'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('image size', () => {
  it('reads dimensions from each format', () => {
    expect(imageSize(fakeJpeg(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 });
    expect(imageSize(fakePng(300, 200), 'image/png')).toEqual({ width: 300, height: 200 });
    expect(imageSize(fakeWebp(800, 600), 'image/webp')).toEqual({ width: 800, height: 600 });
  });
});

describe('metadata stripping (privacy: GPS location)', () => {
  it.each([
    ['JPEG', fakeJpeg(), 'image/jpeg' as const],
    ['PNG', fakePng(), 'image/png' as const],
    ['WebP', fakeWebp(), 'image/webp' as const],
  ])('removes embedded location data from %s and keeps it a valid image', (_n, input, type) => {
    expect(input.toString('latin1')).toContain('GPS');
    const out = stripMetadata(input, type);
    expect(out.toString('latin1')).not.toContain('GPS');
    expect(detectImageType(out)).toBe(type);
    expect(imageSize(out, type)).toEqual(imageSize(input, type));
  });

  it('keeps the JPEG image data intact', () => {
    expect(stripMetadata(fakeJpeg(), 'image/jpeg').toString('latin1')).toContain('IMAGEDATA');
  });
});

describe('LocalDiskStorage', () => {
  let dir = '';
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('stores, reads and deletes; never overwrites', async () => {
    dir = await mkdtemp(join(tmpdir(), 'gatherly-storage-'));
    const s = new LocalDiskStorage(dir);
    await s.put('events/e1/a-full.jpg', Buffer.from('one'));
    expect((await s.read('events/e1/a-full.jpg')).toString()).toBe('one');
    await expect(s.put('events/e1/a-full.jpg', Buffer.from('two'))).rejects.toThrow();
    await s.delete('events/e1/a-full.jpg');
    await expect(s.read('events/e1/a-full.jpg')).rejects.toThrow();
  });

  it('refuses keys that could escape the storage folder', async () => {
    const s = new LocalDiskStorage(dir || tmpdir());
    for (const key of ['../secret.jpg', 'events/../../x.jpg', '/etc/passwd.jpg', 'a.exe', 'C:\\x.jpg']) {
      await expect(s.put(key, Buffer.from('x'))).rejects.toThrow(/Unsafe|escapes/);
    }
  });
});
