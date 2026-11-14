import { Router, type Request, type RequestHandler } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { gallerySettingsSchema, PHOTO_MAX_BYTES, photoMetaSchema, reviewPhotosSchema } from '@gatherly/shared';
import { badRequest } from '../../lib/errors.ts';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { GuestAccessService } from '../guest-portal/guest-access.service.ts';
import type { PhotosService, UploadedImage } from './photos.service.ts';

const id = z.string().min(1).max(64);
const param = (req: Request, name: string): string => id.parse((req.params as Record<string, string | undefined>)[name]);

/** Multipart upload: `full` (display version) + `thumb`, plus caption / activityId fields. In memory only. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PHOTO_MAX_BYTES, files: 2, fields: 4, fieldSize: 2_000 },
}).fields([
  { name: 'full', maxCount: 1 },
  { name: 'thumb', maxCount: 1 },
]);

function filesOf(req: Request): UploadedImage {
  const files = req.files as Record<string, Express.Multer.File[] | undefined> | undefined;
  const full = files?.['full']?.[0];
  const thumb = files?.['thumb']?.[0];
  if (!full || !thumb) throw badRequest('Choose an image to upload.');
  return { full: full.buffer, thumb: thumb.buffer };
}

/** Mounted at /events/:eventId/photos — organisers. */
export function organiserPhotosRoutes(photos: PhotosService, uploadLimit: RequestHandler): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json(await photos.organiserGallery(param(req, 'eventId'), authOf(req).user.id));
  });

  router.post('/', uploadLimit, upload, async (req, res) => {
    const meta = photoMetaSchema.parse(req.body ?? {});
    res.status(201).json({ photo: await photos.organiserUpload(param(req, 'eventId'), authOf(req).user.id, filesOf(req), meta) });
  });

  router.post('/review', validateBody(reviewPhotosSchema), async (req, res) => {
    const { photoIds, decision, reason } = req.body as z.output<typeof reviewPhotosSchema>;
    res.json(await photos.review(param(req, 'eventId'), authOf(req).user.id, photoIds, decision, reason));
  });

  router.put('/settings', validateBody(gallerySettingsSchema), async (req, res) => {
    await photos.setGuestUploads(param(req, 'eventId'), authOf(req).user.id, (req.body as { guestUploadsEnabled: boolean }).guestUploadsEnabled);
    res.status(204).end();
  });

  router.delete('/:photoId', async (req, res) => {
    await photos.remove(param(req, 'eventId'), authOf(req).user.id, param(req, 'photoId'));
    res.status(204).end();
  });

  return router;
}

/** Mounted at /guest/photos — the guest's gallery and uploads. */
export function guestPhotosRoutes(photos: PhotosService, requireGuest: RequestHandler, uploadLimit: RequestHandler): Router {
  const router = Router();
  router.use(requireGuest);
  router.get('/', async (req, res) => {
    res.json(await photos.guestGallery(req.guest!));
  });
  router.post('/', uploadLimit, upload, async (req, res) => {
    const meta = photoMetaSchema.parse(req.body ?? {});
    res.status(201).json({ photo: await photos.guestUpload(req.guest!, filesOf(req), meta) });
  });
  return router;
}

/**
 * Mounted at /photos — image files. Works for organisers (account session) and guests (invitation
 * session); access is checked per request (FR-205). `?download=1` saves the file (FR-217).
 */
export function photoFilesRoutes(photos: PhotosService, access: GuestAccessService, guestCookieName: string): Router {
  const router = Router();
  router.get('/:photoId/:variant', async (req, res) => {
    const variant = z.enum(['full', 'thumb']).parse(req.params['variant']);
    const guest = req.auth ? null : await access.validate(req.cookies?.[guestCookieName] as string | undefined);
    const file = await photos.file(param(req, 'photoId'), variant, { userId: req.auth?.user.id, guest });
    res.set('Content-Type', file.mimeType);
    // Private: may be cached by the browser, never by shared caches.
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('Content-Disposition', `${req.query['download'] === '1' ? 'attachment' : 'inline'}; filename="${file.filename}"`);
    res.send(file.data);
  });
  return router;
}
