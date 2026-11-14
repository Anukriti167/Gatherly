import {
  EVENT_TYPE_LABELS,
  type GuestActivity,
  type GuestEventView,
  type GuestItineraryEntry,
} from '@gatherly/shared';
import type { CookieOptions, Response } from 'express';
import type { AppConfig } from '../../config/env.ts';
import { generateToken, hashToken } from '../../lib/crypto.ts';
import { AppError } from '../../lib/errors.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import { toActivityDetail } from '../activities/activities.service.ts';

const invalidLink = () =>
  new AppError(404, 'INVALID_INVITATION', 'This invitation link isn’t valid any more. It may have been replaced by a newer invitation or withdrawn by the organisers.');

const activityInclude = {
  itinerary: { orderBy: [{ startsAt: 'asc' }, { position: 'asc' }] },
  menuCategories: { orderBy: { position: 'asc' }, include: { items: { orderBy: { position: 'asc' } } } },
  people: { orderBy: { sortOrder: 'asc' } },
} satisfies db.Prisma.ActivityInclude;

export interface GuestContext {
  sessionId: string;
  invitationId: string;
  guestId: string;
  eventId: string;
}

/**
 * Guest access without an account (FR-087 – FR-093, FR-202, FR-203):
 * an invitation link (single random token, stored hashed) is exchanged for a separate guest
 * session cookie. Every request re-checks that the invitation is active and the guest is still on
 * the list, so revocation and removal take effect immediately.
 */
export class GuestAccessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  /** FR-088, FR-092 — validates the link and starts a guest session. */
  async exchange(token: string): Promise<{ token: string; expiresAt: Date }> {
    const inv = await this.prisma.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { guest: { select: { removedAt: true } } } });
    if (!inv || inv.status !== 'ACTIVE' || inv.guest.removedAt || (inv.expiresAt && inv.expiresAt <= new Date())) throw invalidLink();

    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + this.config.session.guestTtlMs);
    await this.prisma.$transaction([
      this.prisma.guestSession.create({ data: { invitationId: inv.id, tokenHash: hashToken(sessionToken), expiresAt } }),
      this.prisma.invitation.update({ where: { id: inv.id }, data: { lastAccessedAt: new Date() } }),
    ]);
    return { token: sessionToken, expiresAt };
  }

  /**
   * FR-006 — a signed-in user whose VERIFIED email matches a guest of the event can open their
   * guest page from the dashboard, without the email link. Same checks as the link itself.
   */
  async openFromAccount(userId: string, eventId: string): Promise<{ token: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user.emailVerifiedAt) {
      throw new AppError(403, 'EMAIL_NOT_VERIFIED', 'Confirm your email address first, so we can match you to your invitations.');
    }
    const guest = await this.prisma.guest.findFirst({
      where: { eventId, email: user.email, removedAt: null },
      include: { invitation: true, event: { select: { status: true } } },
    });
    const inv = guest?.invitation;
    if (!guest || !inv || inv.status !== 'ACTIVE' || !inv.lastSentAt || (inv.expiresAt && inv.expiresAt <= new Date())) throw invalidLink();

    const sessionToken = generateToken();
    const expiresAt = new Date(Date.now() + this.config.session.guestTtlMs);
    await this.prisma.$transaction([
      this.prisma.guestSession.create({ data: { invitationId: inv.id, tokenHash: hashToken(sessionToken), expiresAt } }),
      this.prisma.invitation.update({ where: { id: inv.id }, data: { lastAccessedAt: new Date() } }),
    ]);
    return { token: sessionToken, expiresAt };
  }

  /** Resolves a guest cookie; null when missing, expired, revoked, or the guest was removed. */
  async validate(sessionToken: string | undefined): Promise<GuestContext | null> {
    if (!sessionToken || sessionToken.length > 128) return null;
    const s = await this.prisma.guestSession.findUnique({
      where: { tokenHash: hashToken(sessionToken) },
      include: { invitation: { include: { guest: { select: { id: true, eventId: true, removedAt: true } } } } },
    });
    const now = new Date();
    if (!s || s.revokedAt || s.expiresAt <= now) return null;
    if (s.invitation.status !== 'ACTIVE' || s.invitation.guest.removedAt) return null;
    if (now.getTime() - s.lastSeenAt.getTime() > 3_600_000) {
      await this.prisma.guestSession.update({ where: { id: s.id }, data: { lastSeenAt: now } });
    }
    return { sessionId: s.id, invitationId: s.invitationId, guestId: s.invitation.guest.id, eventId: s.invitation.guest.eventId };
  }

  async endSession(sessionId: string): Promise<void> {
    await this.prisma.guestSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private cookieOptions(expires?: Date): CookieOptions {
    return { httpOnly: true, secure: this.config.session.secureCookie, sameSite: 'lax', path: '/', expires };
  }
  setCookie(res: Response, token: string, expiresAt: Date) {
    res.cookie(this.config.session.guestCookieName, token, this.cookieOptions(expiresAt));
  }
  clearCookie(res: Response) {
    res.clearCookie(this.config.session.guestCookieName, this.cookieOptions());
  }

  /**
   * FR-094 – FR-108 — everything the guest website shows, limited to this guest: only their own
   * activities (FR-096, FR-114), only sections organisers chose to show (FR-035), and never any
   * other guest's details (FR-089, FR-201).
   */
  async view(ctx: GuestContext): Promise<GuestEventView> {
    const guest = await this.prisma.guest.findUniqueOrThrow({
      where: { id: ctx.guestId },
      include: { assignments: true, rsvps: true, event: true },
    });
    const e = guest.event;
    const base: Omit<GuestEventView, 'activities' | 'itinerary'> = {
      availability: e.status === 'PUBLISHED' || e.status === 'COMPLETED' || e.status === 'CANCELLED' ? 'AVAILABLE' : 'UPDATING',
      guest: { name: guest.name },
      event: {
        id: e.id,
        name: e.name,
        description: e.description,
        eventTypeLabel: e.eventType === 'OTHER' && e.customTypeLabel ? e.customTypeLabel : EVENT_TYPE_LABELS[e.eventType],
        status: e.status,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt.toISOString(),
        timezone: e.timezone,
        instructions: e.instructions,
        organiserContact:
          e.organiserContactName || e.organiserContactEmail || e.organiserContactPhone
            ? { name: e.organiserContactName, email: e.organiserContactEmail, phone: e.organiserContactPhone }
            : null,
      },
    };
    // While unpublished, guests see only that the event is being updated (no stale details).
    if (base.availability === 'UPDATING') return { ...base, activities: [], itinerary: [] };

    const rows = await this.prisma.activity.findMany({
      where: { eventId: e.id, ...(guest.allActivities ? {} : { id: { in: guest.assignments.map((a) => a.activityId) } }) },
      include: {
        ...activityInclude,
        rsvps: { where: { status: 'CONFIRMED' }, select: { guestId: true } },
      },
      orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }],
    });

    const now = new Date();
    const activities: GuestActivity[] = rows.map((row) => {
      const { rsvps, ...a } = row;
      const detail = toActivityDetail(a);
      const mine = guest.rsvps.find((r) => r.activityId === a.id)?.status ?? 'PENDING';
      const confirmed = rsvps.length;
      const full = a.capacity !== null && confirmed >= a.capacity && mine !== 'CONFIRMED';
      return {
        ...detail,
        // FR-035: hidden sections are removed entirely for guests, not just flagged.
        itinerary: a.showItinerary ? detail.itinerary : [],
        menu: a.showMenu ? detail.menu : [],
        people: a.showPeople ? detail.people : [],
        dressCode: a.showDressCode ? detail.dressCode : null,
        themeDescription: a.showTheme ? detail.themeDescription : null,
        themeColors: a.showTheme ? detail.themeColors : [],
        instructions: a.showInstructions ? detail.instructions : null,
        rsvp: mine,
        rsvpOpen: e.status === 'PUBLISHED' && a.status === 'SCHEDULED' && (!a.rsvpDeadline || a.rsvpDeadline > now) && a.startsAt > now,
        full,
      };
    });

    const itinerary: GuestItineraryEntry[] = activities
      .flatMap((a) =>
        a.itinerary.length
          ? a.itinerary.map((i) => ({ activityId: a.id, activityName: a.name, title: i.title, description: i.description, startsAt: i.startsAt, endsAt: i.endsAt, timezone: a.timezone }))
          : [{ activityId: a.id, activityName: a.name, title: a.name, description: null, startsAt: a.startsAt, endsAt: a.endsAt, timezone: a.timezone }],
      )
      .sort((x, y) => (x.startsAt < y.startsAt ? -1 : x.startsAt > y.startsAt ? 1 : 0));

    return { ...base, activities, itinerary };
  }
}
