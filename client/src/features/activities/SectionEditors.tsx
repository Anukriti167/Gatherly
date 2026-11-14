import { useState } from 'react';
import { DIETARY_TAG_LABELS, DIETARY_TAGS, STANDARD_MENU_CATEGORIES } from '@gatherly/shared';
import { Button, SelectField, TextField } from '../../components/ui';

/** Client-only stable key for list rows (stripped before saving). */
export const rowKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()));

type Errors = Record<string, string | undefined>;

export type ItineraryRow = { _key: string; title: string; description: string; startsAt: string; endsAt: string };
export type MenuItemRow = { _key: string; name: string; description: string; dietaryTags: string[] };
export type MenuCategoryRow = { _key: string; name: string; items: MenuItemRow[] };
export type PersonRow = { _key: string; role: 'SPEAKER' | 'PERFORMER' | 'PARTICIPANT'; name: string; title: string; bio: string };

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

function IconButton({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function addMinutes(local: string, minutes: number): string {
  const d = new Date(`${local}:00Z`);
  d.setUTCMinutes(d.getUTCMinutes() + minutes);
  return d.toISOString().slice(0, 16);
}

// ─── Itinerary (FR-024 – FR-028) ─────────────────────────────────────────────

export function ItineraryEditor({
  rows,
  onChange,
  errors,
  activityStart,
  activityEnd,
}: {
  rows: ItineraryRow[];
  onChange: (rows: ItineraryRow[]) => void;
  errors: Errors;
  activityStart: string;
  activityEnd: string;
}) {
  // Display chronologically (FR-028); rows at the same time keep their relative order.
  const order = rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.startsAt === b.r.startsAt ? a.i - b.i : a.r.startsAt < b.r.startsAt ? -1 : 1));
  const update = (index: number, patch: Partial<ItineraryRow>) => onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const add = () => {
    const last = [...rows].sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1)).at(-1);
    onChange([...rows, { _key: rowKey(), title: '', description: '', startsAt: last?.startsAt ? addMinutes(last.startsAt, 30) : activityStart, endsAt: '' }]);
  };

  return (
    <div className="space-y-3">
      {order.length === 0 && <p className="text-sm text-slate-500">No itinerary yet. Add entries like “Guests arrive”, “Dinner”, “Speeches”.</p>}
      {order.map(({ r, i }, pos) => {
        const prev = order[pos - 1];
        const next = order[pos + 1];
        const outside = (r.startsAt && (r.startsAt < activityStart || r.startsAt > activityEnd)) || false;
        return (
          <div key={r._key} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
            <div className="grid gap-3 sm:grid-cols-[11rem_11rem_1fr_auto]">
              <TextField label="Time" type="datetime-local" name={`itinerary.${i}.startsAt`} value={r.startsAt} error={errors[`itinerary.${i}.startsAt`]} onChange={(e) => update(i, { startsAt: e.target.value })} />
              <TextField label="Until (optional)" type="datetime-local" name={`itinerary.${i}.endsAt`} value={r.endsAt} error={errors[`itinerary.${i}.endsAt`]} onChange={(e) => update(i, { endsAt: e.target.value })} />
              <TextField label="What happens" name={`itinerary.${i}.title`} value={r.title} error={errors[`itinerary.${i}.title`]} placeholder="e.g. Guests arrive" onChange={(e) => update(i, { title: e.target.value })} />
              <div className="flex items-end gap-1 pb-1">
                {/* Reorder only matters for entries at the same time (FR-027). */}
                {prev?.r.startsAt === r.startsAt && <IconButton label="Move up" onClick={() => onChange(move(rows, i, prev.i))}>↑</IconButton>}
                {next?.r.startsAt === r.startsAt && <IconButton label="Move down" onClick={() => onChange(move(rows, i, next.i))}>↓</IconButton>}
                <IconButton label="Remove entry" onClick={() => onChange(rows.filter((_, j) => j !== i))}>✕</IconButton>
              </div>
            </div>
            <TextField className="mt-2" label="Notes (optional)" name={`itinerary.${i}.description`} value={r.description} error={errors[`itinerary.${i}.description`]} onChange={(e) => update(i, { description: e.target.value })} />
            {outside && <p className="mt-2 text-xs text-amber-700">Heads-up: this is outside the activity's start and end time.</p>}
          </div>
        );
      })}
      <Button type="button" variant="secondary" onClick={add}>
        + Add itinerary entry
      </Button>
    </div>
  );
}

// ─── Menu (FR-029 – FR-031) ──────────────────────────────────────────────────

function TagPicker({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [custom, setCustom] = useState('');
  const toggle = (t: string) => onChange(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t]);
  const customTags = tags.filter((t) => !(DIETARY_TAGS as readonly string[]).includes(t));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {DIETARY_TAGS.map((t) => (
        <button
          key={t}
          type="button"
          aria-pressed={tags.includes(t)}
          onClick={() => toggle(t)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${tags.includes(t) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'}`}
        >
          {DIETARY_TAG_LABELS[t]}
        </button>
      ))}
      {customTags.map((t) => (
        <button key={t} type="button" onClick={() => toggle(t)} className="rounded-full bg-brand-600 px-2.5 py-0.5 text-xs font-medium text-white" aria-label={`Remove tag ${t}`}>
          {t} ✕
        </button>
      ))}
      <input
        aria-label="Add your own tag"
        placeholder="+ own tag"
        value={custom}
        maxLength={30}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const t = custom.trim().toLowerCase();
            if (t && !tags.includes(t)) onChange([...tags, t]);
            setCustom('');
          }
        }}
        className="w-24 rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/30"
      />
    </div>
  );
}

export function MenuEditor({ categories, onChange, errors }: { categories: MenuCategoryRow[]; onChange: (c: MenuCategoryRow[]) => void; errors: Errors }) {
  const updateCat = (ci: number, patch: Partial<MenuCategoryRow>) => onChange(categories.map((c, i) => (i === ci ? { ...c, ...patch } : c)));
  const updateItem = (ci: number, ii: number, patch: Partial<MenuItemRow>) =>
    updateCat(ci, { items: categories[ci]!.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) });
  const newItem = (): MenuItemRow => ({ _key: rowKey(), name: '', description: '', dietaryTags: [] });

  return (
    <div className="space-y-4">
      {categories.length === 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-slate-500">No menu yet.</p>
          <Button
            type="button"
            variant="secondary"
            onClick={() => onChange(STANDARD_MENU_CATEGORIES.map((name) => ({ _key: rowKey(), name, items: [] })))}
          >
            Start with Starters, Main Course, Desserts, Beverages
          </Button>
        </div>
      )}
      {categories.map((cat, ci) => (
        <div key={cat._key} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <div className="flex items-end gap-2">
            <TextField className="flex-1" label="Category" name={`menu.${ci}.name`} value={cat.name} error={errors[`menu.${ci}.name`]} onChange={(e) => updateCat(ci, { name: e.target.value })} />
            <div className="flex pb-1">
              <IconButton label="Move category up" disabled={ci === 0} onClick={() => onChange(move(categories, ci, ci - 1))}>↑</IconButton>
              <IconButton label="Move category down" disabled={ci === categories.length - 1} onClick={() => onChange(move(categories, ci, ci + 1))}>↓</IconButton>
              <IconButton label={`Remove category ${cat.name}`} onClick={() => onChange(categories.filter((_, j) => j !== ci))}>✕</IconButton>
            </div>
          </div>

          <ul className="mt-3 space-y-2">
            {cat.items.map((item, ii) => (
              <li key={item._key} className="rounded-lg bg-white p-3 ring-1 ring-slate-200">
                <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <TextField label="Dish" name={`menu.${ci}.items.${ii}.name`} value={item.name} error={errors[`menu.${ci}.items.${ii}.name`]} placeholder="e.g. Paneer tikka" onChange={(e) => updateItem(ci, ii, { name: e.target.value })} />
                  <TextField label="Description (optional)" name={`menu.${ci}.items.${ii}.description`} value={item.description} onChange={(e) => updateItem(ci, ii, { description: e.target.value })} />
                  <div className="flex items-end pb-1">
                    <IconButton label="Move dish up" disabled={ii === 0} onClick={() => updateCat(ci, { items: move(cat.items, ii, ii - 1) })}>↑</IconButton>
                    <IconButton label="Move dish down" disabled={ii === cat.items.length - 1} onClick={() => updateCat(ci, { items: move(cat.items, ii, ii + 1) })}>↓</IconButton>
                    <IconButton label={`Remove ${item.name || 'dish'}`} onClick={() => updateCat(ci, { items: cat.items.filter((_, j) => j !== ii) })}>✕</IconButton>
                  </div>
                </div>
                <div className="mt-2">
                  <TagPicker tags={item.dietaryTags} onChange={(t) => updateItem(ci, ii, { dietaryTags: t })} />
                  {Object.entries(errors).find(([k]) => k.startsWith(`menu.${ci}.items.${ii}.dietaryTags`))?.[1] && (
                    <p className="mt-1 text-xs font-medium text-red-600">{Object.entries(errors).find(([k]) => k.startsWith(`menu.${ci}.items.${ii}.dietaryTags`))?.[1]}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" className="mt-2" onClick={() => updateCat(ci, { items: [...cat.items, newItem()] })}>
            + Add dish
          </Button>
        </div>
      ))}
      {categories.length > 0 && (
        <Button type="button" variant="secondary" onClick={() => onChange([...categories, { _key: rowKey(), name: '', items: [newItem()] }])}>
          + Add category
        </Button>
      )}
    </div>
  );
}

// ─── Speakers, performers & participants (FR-023) ────────────────────────────

const roleOptions = [
  { value: 'SPEAKER', label: 'Speaker' },
  { value: 'PERFORMER', label: 'Performer' },
  { value: 'PARTICIPANT', label: 'Participant' },
];

export function PeopleEditor({ people, onChange, errors }: { people: PersonRow[]; onChange: (p: PersonRow[]) => void; errors: Errors }) {
  const update = (i: number, patch: Partial<PersonRow>) => onChange(people.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-3">
      {people.length === 0 && <p className="text-sm text-slate-500">Add speakers, performers or anyone taking part.</p>}
      {people.map((p, i) => (
        <div key={p._key} className="grid gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 sm:grid-cols-[9rem_1fr_1fr_auto]">
          <SelectField label="Role" name={`people.${i}.role`} options={roleOptions} value={p.role} onChange={(e) => update(i, { role: e.target.value as PersonRow['role'] })} />
          <TextField label="Name" name={`people.${i}.name`} value={p.name} error={errors[`people.${i}.name`]} onChange={(e) => update(i, { name: e.target.value })} />
          <TextField label="Title / act (optional)" name={`people.${i}.title`} value={p.title} placeholder="e.g. Keynote, DJ, Best man" onChange={(e) => update(i, { title: e.target.value })} />
          <div className="flex items-end pb-1">
            <IconButton label="Move up" disabled={i === 0} onClick={() => onChange(move(people, i, i - 1))}>↑</IconButton>
            <IconButton label="Move down" disabled={i === people.length - 1} onClick={() => onChange(move(people, i, i + 1))}>↓</IconButton>
            <IconButton label={`Remove ${p.name || 'person'}`} onClick={() => onChange(people.filter((_, j) => j !== i))}>✕</IconButton>
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={() => onChange([...people, { _key: rowKey(), role: 'PERFORMER', name: '', title: '', bio: '' }])}>
        + Add person
      </Button>
    </div>
  );
}
