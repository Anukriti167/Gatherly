import type { db } from './prisma.ts';

type SlugClient = Pick<db.Prisma.TransactionClient, 'event' | 'activity'>;

const MAX_SLUG_LENGTH = 191;

/** Convert a display name into a URL-safe, lowercase slug. */
export function slugify(value: string, fallback = 'item'): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');

  return normalized || fallback;
}

function candidateWithSuffix(base: string, suffix: number): string {
  if (suffix === 1) return base;
  const ending = `-${suffix}`;
  return `${base.slice(0, MAX_SLUG_LENGTH - ending.length).replace(/-+$/g, '')}${ending}`;
}

/**
 * Find an unused event slug. The database unique index remains the final concurrency guard.
 * Call inside the same transaction as the event insert.
 */
export async function uniqueEventSlug(client: SlugClient, name: string): Promise<string> {
  const base = slugify(name, 'event');
  for (let suffix = 1; ; suffix += 1) {
    const candidate = candidateWithSuffix(base, suffix);
    const existing = await client.event.findFirst({ where: { slug: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
}

/** Find an unused activity slug within one event. */
export async function uniqueActivitySlug(client: SlugClient, eventId: string, name: string): Promise<string> {
  const base = slugify(name, 'activity');
  for (let suffix = 1; ; suffix += 1) {
    const candidate = candidateWithSuffix(base, suffix);
    const existing = await client.activity.findFirst({
      where: { eventId, slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
}
