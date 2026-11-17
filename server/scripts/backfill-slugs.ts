import { loadConfig, loadDotEnv } from '../src/config/env.ts';
import { createPrisma } from '../src/lib/prisma.ts';
import { slugify } from '../src/lib/slug.ts';

/** Keep the first occurrence readable and suffix later collisions deterministically. */
function nextAvailableSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let suffix = 2; ; suffix += 1) {
    const ending = `-${suffix}`;
    const candidate = `${base.slice(0, 191 - ending.length).replace(/-+$/g, '')}${ending}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const config = loadConfig();
  const prisma = createPrisma(config.databaseUrl);

  try {
    const events = await prisma.event.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { activities: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });

    // Reserve already-populated values first so the backfill never overwrites or collides with them.
    const usedEventSlugs = new Set(events.flatMap((event) => (event.slug ? [event.slug] : [])));
    let eventsUpdated = 0;
    let activitiesUpdated = 0;

    for (const event of events) {
      const eventSlug = event.slug ?? nextAvailableSlug(slugify(event.name, 'event'), usedEventSlugs);
      if (!event.slug) {
        await prisma.event.update({ where: { id: event.id }, data: { slug: eventSlug } });
        eventsUpdated += 1;
      }

      const usedActivitySlugs = new Set(event.activities.flatMap((activity) => (activity.slug ? [activity.slug] : [])));
      for (const activity of event.activities) {
        if (activity.slug) continue;
        const activitySlug = nextAvailableSlug(slugify(activity.name, 'activity'), usedActivitySlugs);
        await prisma.activity.update({ where: { id: activity.id }, data: { slug: activitySlug } });
        activitiesUpdated += 1;
      }
    }

    console.log(`Slug backfill complete. Events updated: ${eventsUpdated}; activities updated: ${activitiesUpdated}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('Slug backfill failed:', error);
  process.exitCode = 1;
});
