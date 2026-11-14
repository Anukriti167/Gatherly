import { randomUUID } from 'node:crypto';
import {
  GUEST_PHOTO_LIMIT,
  PHOTO_MAX_BYTES,
  PHOTO_MAX_DIMENSION,
  THUMB_MAX_BYTES,
  THUMB_MAX_DIMENSION,
  type GalleryView,
  type PhotoView,
} from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.ts';
import { detectImageType, EXTENSION, imageSize, stripMetadata, type ImageType } from '../../lib/images.ts';
import { emailLayout } from '../../lib/mailer.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { FileStorage } from '../../lib/storage.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { EventsService } from '../events/events.service.ts';
import type { GuestContext } from '../guest-portal/guest-access.service.ts';
import type { OutboxService } from '../outbox/outbox.service.ts';

export interface UploadedImage {
  full: Buffer;
  thumb: Buffer;
}

type PhotoRow = db.Prisma.PhotoGetPayload<{
  include: { activity: { select: { name: true } }; uploadedByUser: { select: { name: true } }; uploadedByGuest: { select: { name: true } } };
}>;
const photoInclude = {
  activity: { select: { name: true } },
  uploadedByUser: { select: { name: true } },
  uploadedByGuest: { select: { name: true } },
} as const;

/** "Priya Shah" → "Priya S." — guests see only short names of other guests. */
const shortName = (name: string) => {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : (first ?? 'Guest');
};

/** Validates one image buffer: real type by content, size and dimension limits; strips metadata. */
function checkImage(buf: Buffer, kind: 'photo' | 'thumbnail'): { data: Buffer; type: ImageType; width: number | null; height: number | null } {
  const maxBytes = kind === 'photo' ? PHOTO_MAX_BYTES : THUMB_MAX_BYTES;
  const maxDim = (kind === 'photo' ? PHOTO_MAX_DIMENSION : THUMB_MAX_DIMENSION) + 64; // small tolerance for rounding
  const type = detectImageType(buf);
  if (!type) throw badRequest('Only JPEG, PNG or WebP images can be uploaded.');
  if (buf.length > maxBytes) throw new AppError(413, 'TOO_LARGE', `The ${kind} is too large.`);
  const size = imageSize(buf, type);
  if (size && (size.width > maxDim || size.height > maxDim)) throw badRequest(`The ${kind} is too large in pixels — please upload it through the Gatherly page.`);
  return { data: stripMetadata(buf, type), type, width: size?.width ?? null, height: size?.height ?? null };
}

/**
 * Event photo gallery (FR-161 – FR-178, FR-217). Organisers upload directly; guests upload only
 * when allowed, up to 20 each, and their photos wait for approval. Files are only ever served
 * through `file()`, which checks event access every time (FR-177, FR-205).
 */
export class PhotosService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly storage: FileStorage,
    private readonly config: AppConfig,
  ) {}

  private toView(p: PhotoRow, opts: { forGuestId?: string }): PhotoView {
    const fromGuest = Boolean(p.uploadedByGuestId);
    const name = p.uploadedByUser?.name ?? p.uploadedByGuest?.name ?? 'Someone';
    const base = `/api/v1/photos/${p.id}`;
    return {
      id: p.id,
      activityId: p.activityId,
      activityName: p.activity?.name ?? null,
      caption: p.caption,
      status: p.status,
      uploaderName: opts.forGuestId && fromGuest ? shortName(name) : name,
      uploadedByGuest: fromGuest,
      mine: Boolean(opts.forGuestId && p.uploadedByGuestId === opts.forGuestId),
      rejectionReason: p.rejectionReason,
      width: p.width,
      height: p.height,
      createdAt: p.createdAt.toISOString(),
      thumbUrl: `${base}/thumb`,
      fullUrl: `${base}/full`,
      downloadUrl: `${base}/full?download=1`,
    };
  }

  private async store(eventId: string, img: UploadedImage) {
    const full = checkImage(img.full, 'photo');
    const thumb = checkImage(img.thumb, 'thumbnail');
    const id = randomUUID();
    const fullKey = `events/${eventId}/${id}-full.${EXTENSION[full.type]}`;
    const thumbKey = `events/${eventId}/${id}-thumb.${EXTENSION[thumb.type]}`;
    await this.storage.put(fullKey, full.data);
    await this.storage.put(thumbKey, thumb.data);
    return { fullKey, thumbKey, mimeType: full.type, sizeBytes: full.data.length, width: full.width, height: full.height };
  }

  private async assertActivity(eventId: string, activityId: string | null) {
    if (!activityId) return;
    if (!(await this.prisma.activity.count({ where: { id: activityId, eventId } }))) throw badRequest('That activity is not part of this event.');
  }

  // ─── Organisers ─────────────────────────────────────────────────────────────

  async organiserGallery(eventId: string, userId: string): Promise<GalleryView> {
    const { event } = await this.events.authorize(eventId, userId, 'event.view');
    const photos = await this.prisma.photo.findMany({
      where: { eventId, status: { in: ['APPROVED', 'PENDING_APPROVAL'] } },
      include: photoInclude,
      orderBy: { createdAt: 'desc' },
    });
    return { photos: photos.map((p) => this.toView(p, {})), guestUploadsEnabled: event.guestUploadsEnabled, remainingUploads: null };
  }

  /** FR-162, FR-163 — organisers' photos are published straight away. */
  async organiserUpload(eventId: string, userId: string, img: UploadedImage, meta: { caption: string | null; activityId: string | null }): Promise<PhotoView> {
    await this.events.authorize(eventId, userId, 'photos.upload');
    await this.assertActivity(eventId, meta.activityId);
    const stored = await this.store(eventId, img);
    const photo = await this.prisma.photo.create({
      data: { eventId, ...meta, ...stored, status: 'APPROVED', uploadedByUserId: userId, reviewedById: userId, reviewedAt: new Date() },
      include: photoInclude,
    });
    await this.audit.record({ eventId, actor: { type: 'USER', userId }, action: 'photo.uploaded', entityType: 'Photo', entityId: photo.id });
    return this.toView(photo, {});
  }

  /** FR-168 — turn guest uploads on or off (day-to-day setting, no approval needed). */
  async setGuestUploads(eventId: string, userId: string, enabled: boolean): Promise<void> {
    await this.events.authorize(eventId, userId, 'gallery.settings');
    await this.prisma.event.update({ where: { id: eventId }, data: { guestUploadsEnabled: enabled } });
    await this.audit.record({ eventId, actor: { type: 'USER', userId }, action: 'gallery.settings', entityType: 'Event', entityId: eventId, after: { guestUploadsEnabled: enabled } });
  }

  /** FR-172, FR-173 — approve or reject pending guest photos; guests are told by email. */
  async review(eventId: string, userId: string, photoIds: string[], decision: 'APPROVE' | 'REJECT', reason?: string): Promise<{ updated: number }> {
    const { event } = await this.events.authorize(eventId, userId, 'photos.moderate');
    const pending = await this.prisma.photo.findMany({
      where: { eventId, id: { in: photoIds }, status: 'PENDING_APPROVAL' },
      include: { uploadedByGuest: { select: { id: true, name: true, email: true } } },
    });
    if (pending.length === 0) return { updated: 0 };
    const status = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    await this.prisma.$transaction(async (tx) => {
      await tx.photo.updateMany({
        where: { id: { in: pending.map((p) => p.id) }, status: 'PENDING_APPROVAL' },
        data: { status, reviewedById: userId, reviewedAt: new Date(), rejectionReason: decision === 'REJECT' ? reason || null : null },
      });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: decision === 'APPROVE' ? 'photos.approved' : 'photos.rejected', entityType: 'Event', entityId: eventId, metadata: { count: pending.length, reason } },
        tx,
      );
      // One email per guest summarising the decision.
      const byGuest = new Map<string, { guest: NonNullable<(typeof pending)[number]['uploadedByGuest']>; n: number }>();
      for (const p of pending) {
        if (!p.uploadedByGuest) continue;
        const entry = byGuest.get(p.uploadedByGuest.id) ?? { guest: p.uploadedByGuest, n: 0 };
        entry.n += 1;
        byGuest.set(p.uploadedByGuest.id, entry);
      }
      for (const { guest, n } of byGuest.values()) {
        const approved = decision === 'APPROVE';
        const paragraphs = [
          `Hi ${guest.name},`,
          approved
            ? `${n === 1 ? 'Your photo is' : `${n} of your photos are`} now in the “${event.name}” gallery for everyone at the event to enjoy. Thank you for sharing!`
            : `The organisers decided not to add ${n === 1 ? 'your photo' : `${n} of your photos`} to the “${event.name}” gallery.${reason ? ` Their note: “${reason}”` : ''}`,
        ];
        await this.outbox.enqueue(
          {
            to: guest.email,
            toName: guest.name,
            subject: approved ? `Your photos are in the gallery · ${event.name}` : `About your photos · ${event.name}`,
            text: paragraphs.join('\n\n'),
            html: emailLayout({ heading: approved ? 'Photos approved 📸' : 'About your photos', paragraphs }),
          },
          { kind: approved ? 'photos.approved' : 'photos.rejected', eventId },
          tx,
        );
      }
    });
    return { updated: pending.length };
  }

  /** FR-167, FR-178 — delete a photo (or take an approved one down); the files are deleted too. */
  async remove(eventId: string, userId: string, photoId: string): Promise<void> {
    await this.events.authorize(eventId, userId, 'photos.upload');
    const photo = await this.prisma.photo.findFirst({ where: { id: photoId, eventId, status: { not: 'REMOVED' } } });
    if (!photo) throw notFound('Photo not found');
    await this.prisma.photo.update({ where: { id: photoId }, data: { status: 'REMOVED', reviewedById: userId, reviewedAt: new Date() } });
    await this.audit.record({ eventId, actor: { type: 'USER', userId }, action: 'photo.removed', entityType: 'Photo', entityId: photoId, metadata: { previousStatus: photo.status } });
    await Promise.all([this.storage.delete(photo.fullKey), this.storage.delete(photo.thumbKey)]);
  }

  // ─── Guests ─────────────────────────────────────────────────────────────────

  private async guestEvent(ctx: GuestContext) {
    const guest = await this.prisma.guest.findUniqueOrThrow({ where: { id: ctx.guestId }, include: { event: true, assignments: true } });
    if (!['PUBLISHED', 'COMPLETED'].includes(guest.event.status)) throw forbidden('The gallery is not available right now.');
    return guest;
  }

  /** FR-164, FR-165, FR-177 — every approved photo of the event, plus the guest's own uploads. */
  async guestGallery(ctx: GuestContext): Promise<GalleryView> {
    const guest = await this.guestEvent(ctx);
    const photos = await this.prisma.photo.findMany({
      where: {
        eventId: guest.eventId,
        OR: [{ status: 'APPROVED' }, { uploadedByGuestId: guest.id, status: { in: ['PENDING_APPROVAL', 'REJECTED'] } }],
      },
      include: photoInclude,
      orderBy: { createdAt: 'desc' },
    });
    const used = photos.filter((p) => p.uploadedByGuestId === guest.id && p.status !== 'REJECTED').length;
    return {
      photos: photos.map((p) => this.toView(p, { forGuestId: guest.id })),
      guestUploadsEnabled: guest.event.guestUploadsEnabled,
      remainingUploads: Math.max(0, GUEST_PHOTO_LIMIT - used),
    };
  }

  /** FR-168 – FR-171 — guest uploads (when enabled), max 20 each, pending until approved. */
  async guestUpload(ctx: GuestContext, img: UploadedImage, meta: { caption: string | null; activityId: string | null }): Promise<PhotoView> {
    const guest = await this.guestEvent(ctx);
    if (!guest.event.guestUploadsEnabled) throw forbidden('The organisers have not turned on photo sharing for guests.');
    if (meta.activityId && !guest.allActivities && !guest.assignments.some((a) => a.activityId === meta.activityId)) {
      throw badRequest('You can only tag activities you are invited to.');
    }
    await this.assertActivity(guest.eventId, meta.activityId);
    const used = await this.prisma.photo.count({ where: { uploadedByGuestId: guest.id, status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } });
    if (used >= GUEST_PHOTO_LIMIT) throw new AppError(409, 'PHOTO_LIMIT', `You can share up to ${GUEST_PHOTO_LIMIT} photos for this event.`);

    const stored = await this.store(guest.eventId, img);
    const photo = await this.prisma.photo.create({
      data: { eventId: guest.eventId, ...meta, ...stored, status: 'PENDING_APPROVAL', uploadedByGuestId: guest.id },
      include: photoInclude,
    });
    await this.audit.record({
      eventId: guest.eventId,
      actor: { type: 'GUEST', guestId: guest.id },
      action: 'photo.submitted',
      entityType: 'Photo',
      entityId: photo.id,
      metadata: { guestName: guest.name },
    });
    return this.toView(photo, { forGuestId: guest.id });
  }

  // ─── Files (FR-177, FR-205, FR-217) ─────────────────────────────────────────

  /**
   * Returns the image only to someone allowed to see it: an active organiser of the event (any
   * status), or a guest of the same event (approved photos, plus their own uploads).
   * Everyone else gets "not found".
   */
  async file(photoId: string, variant: 'full' | 'thumb', who: { userId?: string; guest?: GuestContext | null }): Promise<{ data: Buffer; mimeType: string; filename: string }> {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId }, include: { event: { select: { name: true, status: true } } } });
    if (!photo || photo.status === 'REMOVED') throw notFound('Photo not found');

    let allowed = false;
    if (who.userId) {
      const m = await this.prisma.eventMembership.findUnique({ where: { eventId_userId: { eventId: photo.eventId, userId: who.userId } } });
      allowed = m?.status === 'ACTIVE';
    }
    if (!allowed && who.guest && who.guest.eventId === photo.eventId && ['PUBLISHED', 'COMPLETED'].includes(photo.event.status)) {
      allowed = photo.status === 'APPROVED' || photo.uploadedByGuestId === who.guest.guestId;
    }
    if (!allowed) throw notFound('Photo not found');

    const key = variant === 'full' ? photo.fullKey : photo.thumbKey;
    const ext = key.split('.').pop();
    const slug = photo.event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'photo';
    const data = await this.storage.read(key);
    return { data, mimeType: detectImageType(data) ?? photo.mimeType, filename: `${slug}-${photo.id.slice(-6)}.${ext}` };
  }
}
