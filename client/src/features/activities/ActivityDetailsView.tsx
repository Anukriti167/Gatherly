import { DIETARY_TAG_LABELS, type ActivityDetail } from '@gatherly/shared';
import type { ReactNode } from 'react';

const tagLabel = (t: string) => (DIETARY_TAG_LABELS as Record<string, string>)[t] ?? t;

const time = (local: string) => {
  const [h = '0', m = '00'] = local.slice(11, 16).split(':');
  const hour = Number(h);
  return `${hour % 12 || 12}:${m} ${hour < 12 ? 'am' : 'pm'}`;
};

function Block({ title, hiddenFromGuests, children }: { title: string; hiddenFromGuests?: boolean; children: ReactNode }) {
  return (
    <section>
      <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
        {title}
        {hiddenFromGuests && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-800">hidden from guests</span>}
      </h4>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * Read-only itinerary, menu, people, dress code, theme and instructions.
 * `audience="guest"` omits sections the organisers chose to hide (FR-035, FR-099);
 * `audience="organiser"` shows everything, marking hidden sections.
 */
export function ActivityDetailsView({ activity: a, audience }: { activity: ActivityDetail; audience: 'guest' | 'organiser' }) {
  const visible = (flag: boolean) => audience === 'organiser' || flag;
  const multiDay = a.itinerary.some((i) => i.startsAtLocal.slice(0, 10) !== a.startsAtLocal.slice(0, 10));

  const blocks: ReactNode[] = [];

  if (a.itinerary.length && visible(a.showItinerary)) {
    blocks.push(
      <Block key="it" title="Itinerary" hiddenFromGuests={!a.showItinerary}>
        <ol className="space-y-2 border-l-2 border-brand-100 pl-4">
          {a.itinerary.map((i) => (
            <li key={i.id} className="relative">
              <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-brand-500" aria-hidden />
              <p className="text-sm">
                <span className="font-medium text-slate-900">
                  {multiDay && `${i.startsAtLocal.slice(5, 10)} · `}
                  {time(i.startsAtLocal)}
                  {i.endsAtLocal && ` – ${time(i.endsAtLocal)}`}
                </span>{' '}
                <span className="text-slate-700">{i.title}</span>
              </p>
              {i.description && <p className="text-xs text-slate-500">{i.description}</p>}
            </li>
          ))}
        </ol>
      </Block>,
    );
  }

  if (a.menu.length && visible(a.showMenu)) {
    blocks.push(
      <Block key="menu" title="Menu" hiddenFromGuests={!a.showMenu}>
        <div className="grid gap-4 sm:grid-cols-2">
          {a.menu.map((c) => (
            <div key={c.id}>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{c.name}</p>
              <ul className="mt-1 space-y-1.5">
                {c.items.map((it) => (
                  <li key={it.id} className="text-sm">
                    <span className="text-slate-900">{it.name}</span>
                    {it.description && <span className="text-slate-500"> — {it.description}</span>}
                    {it.dietaryTags.length > 0 && (
                      <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                        {it.dietaryTags.map((t) => (
                          <span key={t} className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800">
                            {tagLabel(t)}
                          </span>
                        ))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Block>,
    );
  }

  if (a.people.length && visible(a.showPeople)) {
    blocks.push(
      <Block key="people" title="Speakers & performers" hiddenFromGuests={!a.showPeople}>
        <ul className="flex flex-wrap gap-2">
          {a.people.map((p) => (
            <li key={p.id} className="rounded-lg bg-slate-50 px-3 py-1.5 text-sm ring-1 ring-slate-200">
              <span className="font-medium text-slate-900">{p.name}</span>
              {p.title && <span className="text-slate-500"> · {p.title}</span>}
            </li>
          ))}
        </ul>
      </Block>,
    );
  }

  if ((a.dressCode || a.themeDescription || a.themeColors.length) && (visible(a.showDressCode) || visible(a.showTheme))) {
    blocks.push(
      <Block key="dress" title="Dress code & theme" hiddenFromGuests={!a.showDressCode && !a.showTheme}>
        {a.dressCode && visible(a.showDressCode) && <p className="text-sm text-slate-700">👗 {a.dressCode}</p>}
        {a.themeDescription && visible(a.showTheme) && <p className="mt-1 text-sm text-slate-700">{a.themeDescription}</p>}
        {a.themeColors.length > 0 && visible(a.showTheme) && (
          <div className="mt-2 flex gap-1">
            {a.themeColors.map((c) => (
              <span key={c} title={c} className="size-6 rounded-full ring-1 ring-slate-200" style={{ backgroundColor: c }} />
            ))}
          </div>
        )}
      </Block>,
    );
  }

  if (a.instructions && visible(a.showInstructions)) {
    blocks.push(
      <Block key="ins" title="Instructions" hiddenFromGuests={!a.showInstructions}>
        <p className="whitespace-pre-line text-sm text-slate-700">{a.instructions}</p>
      </Block>,
    );
  }

  if (blocks.length === 0) return <p className="text-sm text-slate-500">No itinerary, menu or other details yet.</p>;
  return <div className="space-y-5">{blocks}</div>;
}
