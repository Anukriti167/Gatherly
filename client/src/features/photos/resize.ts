import { PHOTO_MAX_DIMENSION, THUMB_MAX_DIMENSION } from '@gatherly/shared';

export interface PreparedPhoto {
  full: Blob;
  thumb: Blob;
  previewUrl: string;
}

async function toJpeg(bitmap: ImageBitmap, maxDim: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process this image.');
  ctx.fillStyle = '#ffffff'; // transparent PNGs get a white background in JPEG
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the image.'))), 'image/jpeg', quality),
  );
}

/**
 * Prepares a photo in the browser before upload: honours the camera's rotation, scales it down to
 * a display version (≤ 2048 px) and a thumbnail (≤ 480 px), and re-encodes as JPEG — which also
 * drops hidden metadata such as GPS location. Phone photos shrink ~10× (faster on mobile data).
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)
        ? 'HEIC photos can’t be read by this browser. On iPhone, choose “Most Compatible” in Camera settings or share the photo as JPEG.'
        : 'This file isn’t an image we can read. Please choose a JPEG, PNG or WebP photo.',
    );
  }
  try {
    const full = await toJpeg(bitmap, PHOTO_MAX_DIMENSION, 0.85);
    const thumb = await toJpeg(bitmap, THUMB_MAX_DIMENSION, 0.75);
    return { full, thumb, previewUrl: URL.createObjectURL(thumb) };
  } finally {
    bitmap.close();
  }
}
