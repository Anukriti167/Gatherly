import { z } from 'zod';

export type PhotoStatus = 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'REMOVED';

/** A photo as shown in a gallery (FR-166). File URLs go through an authorised route (FR-205). */
export interface PhotoView {
  id: string;
  activityId: string | null;
  activityName: string | null;
  caption: string | null;
  status: PhotoStatus;
  /** "Asha Rao" for organisers; "Priya S." for guests (other guests see only a short name). */
  uploaderName: string;
  uploadedByGuest: boolean;
  /** True on the guest's own uploads (lets them see their pending/rejected photos). */
  mine: boolean;
  rejectionReason: string | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  thumbUrl: string;
  fullUrl: string;
  downloadUrl: string;
}

export interface GalleryView {
  photos: PhotoView[];
  guestUploadsEnabled: boolean;
  /** Guests only: how many more photos they may upload (FR-169). */
  remainingUploads: number | null;
}

/** Text fields sent alongside the image files (multipart). */
export const photoMetaSchema = z.object({
  caption: z
    .string()
    .trim()
    .max(300, 'Captions can be up to 300 characters')
    .optional()
    .transform((v) => v || null),
  activityId: z
    .string()
    .max(64)
    .optional()
    .transform((v) => v || null),
});

export const reviewPhotosSchema = z.object({
  photoIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().trim().max(300).optional(),
});
export type ReviewPhotosInput = z.input<typeof reviewPhotosSchema>;

export const gallerySettingsSchema = z.object({ guestUploadsEnabled: z.boolean() });

export const GUEST_PHOTO_LIMIT = 20; // FR-169
export const PHOTO_MAX_BYTES = 8 * 1024 * 1024; // display version after in-browser resizing
export const THUMB_MAX_BYTES = 1024 * 1024;
export const PHOTO_MAX_DIMENSION = 2048;
export const THUMB_MAX_DIMENSION = 480;
