import { useMemo, type ReactNode } from 'react';
import { createActivitySchema, type ActivityDetail, type CreateActivityInput } from '@gatherly/shared';
import { MapPreview } from '../../components/MapPreview';
import { Alert, Button, SelectField, TextAreaField, TextField } from '../../components/ui';
import { timeZoneOptions } from '../../lib/format';
import { useForm } from '../../lib/use-form';
import {
  ItineraryEditor,
  MenuEditor,
  PeopleEditor,
  type ItineraryRow,
  type MenuCategoryRow,
  type PersonRow,
} from './SectionEditors';

export type ActivityFormValues = {
  name: string;
  description: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  venueName: string;
  venueAddress: string;
  virtualMeetingUrl: string;
  capacity: string;
  rsvpDeadline: string;
  dressCode: string;
  themeDescription: string;
  themeColors: string[];
  instructions: string;
  showPeople: boolean;
  showItinerary: boolean;
  showMenu: boolean;
  showDressCode: boolean;
  showTheme: boolean;
  showInstructions: boolean;
  itinerary: ItineraryRow[];
  menu: MenuCategoryRow[];
  people: PersonRow[];
};

export function emptyActivity(timezone: string, startsAt: string, endsAt: string): ActivityFormValues {
  return {
    name: '',
    description: '',
    timezone,
    startsAt,
    endsAt,
    venueName: '',
    venueAddress: '',
    virtualMeetingUrl: '',
    capacity: '',
    rsvpDeadline: '',
    dressCode: '',
    themeDescription: '',
    themeColors: [],
    instructions: '',
    showPeople: true,
    showItinerary: true,
    showMenu: true,
    showDressCode: true,
    showTheme: true,
    showInstructions: true,
    itinerary: [],
    menu: [],
    people: [],
  };
}

export function activityToFormValues(a: ActivityDetail): ActivityFormValues {
  return {
    name: a.name,
    description: a.description,
    timezone: a.timezone,
    startsAt: a.startsAtLocal,
    endsAt: a.endsAtLocal,
    venueName: a.venueName ?? '',
    venueAddress: a.venueAddress ?? '',
    virtualMeetingUrl: a.virtualMeetingUrl ?? '',
    capacity: a.capacity?.toString() ?? '',
    rsvpDeadline: a.rsvpDeadlineLocal ?? '',
    dressCode: a.dressCode ?? '',
    themeDescription: a.themeDescription ?? '',
    themeColors: a.themeColors,
    instructions: a.instructions ?? '',
    showPeople: a.showPeople,
    showItinerary: a.showItinerary,
    showMenu: a.showMenu,
    showDressCode: a.showDressCode,
    showTheme: a.showTheme,
    showInstructions: a.showInstructions,
    itinerary: a.itinerary.map((i) => ({ _key: i.id, title: i.title, description: i.description ?? '', startsAt: i.startsAtLocal, endsAt: i.endsAtLocal ?? '' })),
    menu: a.menu.map((c) => ({
      _key: c.id,
      name: c.name,
      items: c.items.map((it) => ({ _key: it.id, name: it.name, description: it.description ?? '', dietaryTags: it.dietaryTags })),
    })),
    people: a.people.map((p) => ({ _key: p.id, role: p.role, name: p.name, title: p.title ?? '', bio: p.bio ?? '' })),
  };
}

/** Removes client-only row keys before sending. */
function toPayload(v: ActivityFormValues): CreateActivityInput {
  return {
    ...v,
    // Coordinates aren't edited in the UI; clear legacy values so the map follows the Location text.
    venueLatitude: null,
    venueLongitude: null,
    itinerary: v.itinerary.map(({ _key, ...r }) => r),
    menu: v.menu.map(({ _key, items, ...c }) => ({ ...c, items: items.map(({ _key: _k, ...i }) => i) })),
    people: v.people.map(({ _key, ...p }) => p),
  };
}

/** Another activity's location that can be copied into this one. */
export type LocationSource = { id: string; name: string; venueName: string | null; venueAddress: string | null };

function CopyLocation({ sources, onCopy }: { sources: LocationSource[]; onCopy: (s: LocationSource) => void }) {
  if (sources.length === 0) return null;
  return (
    <SelectField
      label="Copy location from another activity"
      name="copyLocationFrom"
      value=""
      options={[
        { value: '', label: 'Choose an activity…' },
        ...sources.map((s) => ({ value: s.id, label: `${s.name} — ${[s.venueName, s.venueAddress].filter(Boolean).join(', ')}` })),
      ]}
      onChange={(e) => {
        const s = sources.find((x) => x.id === e.target.value);
        if (s) onCopy(s);
      }}
    />
  );
}

function ShowToggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex shrink-0 items-center gap-2 text-sm text-slate-600">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-slate-300 accent-brand-600" />
      Show to guests
    </label>
  );
}

function Section({
  title,
  description,
  toggle,
  children,
}: {
  title: string;
  description?: string;
  toggle?: { checked: boolean; onChange: (v: boolean) => void };
  children: ReactNode;
}) {
  const hidden = toggle && !toggle.checked;
  return (
    <fieldset className="space-y-4 border-t border-slate-100 pt-5 first:border-t-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900" aria-hidden>
            {title}
          </h3>
          {description && <p className="text-sm text-slate-500">{description}</p>}
          {hidden && <p className="text-xs text-amber-700">Hidden from guests — you can still fill it in.</p>}
        </div>
        {toggle && <ShowToggle {...toggle} />}
      </div>
      {children}
    </fieldset>
  );
}

function ThemeColours({ colours, onChange }: { colours: string[]; onChange: (c: string[]) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-medium text-slate-800">Theme colours (optional)</p>
      <div className="flex flex-wrap items-center gap-2">
        {colours.map((c, i) => (
          <div key={i} className="flex items-center gap-1 rounded-lg bg-white p-1 ring-1 ring-slate-200">
            <input
              type="color"
              aria-label={`Colour ${i + 1}`}
              value={c}
              onChange={(e) => onChange(colours.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
              className="size-8 cursor-pointer rounded border-0 bg-transparent"
            />
            <button type="button" aria-label={`Remove colour ${i + 1}`} onClick={() => onChange(colours.filter((_, j) => j !== i))} className="px-1 text-slate-400 hover:text-red-600">
              ×
            </button>
          </div>
        ))}
        {colours.length < 8 && (
          <Button type="button" variant="secondary" onClick={() => onChange([...colours, '#6366F1'])}>
            + Add colour
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Add / edit an activity on a single page — basics, location, RSVP, itinerary, menu, people,
 * dress code, theme and instructions — saved together with one click
 * (FR-019 – FR-036).
 */
export function ActivityForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  locationSources = [],
}: {
  initial: ActivityFormValues;
  submitLabel: string;
  onSubmit: (values: CreateActivityInput) => Promise<void>;
  onCancel: () => void;
  /** Other activities of the event that have a location, for "copy location from". */
  locationSources?: LocationSource[];
}) {
  const form = useForm(createActivitySchema, initial as unknown as CreateActivityInput);
  const v = form.values as unknown as ActivityFormValues;
  const set = <K extends keyof ActivityFormValues>(key: K, value: ActivityFormValues[K]) => form.setValues((prev) => ({ ...prev, [key]: value }));
  const zones = useMemo(() => {
    const opts = timeZoneOptions();
    return opts.some((o) => o.value === initial.timezone) ? opts : [{ value: initial.timezone, label: initial.timezone }, ...opts];
  }, [initial.timezone]);

  const submit = form.handleSubmit(async () => onSubmit(toPayload(v)));

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {form.formError && <Alert>{form.formError}</Alert>}

      <Section title="Basics">
        <TextField label="Activity name" required placeholder="e.g. Sangeet, Keynote, Dinner" {...form.field('name')} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Starts" type="datetime-local" required {...form.field('startsAt')} />
          <TextField label="Ends" type="datetime-local" required {...form.field('endsAt')} />
          <SelectField label="Timezone" options={zones} {...form.field('timezone')} />
        </div>
        <TextAreaField label="Description (optional)" rows={3} {...form.field('description')} />
      </Section>

      <Section title="Where" description="A physical venue, an online link, or both.">
        <CopyLocation
          sources={locationSources}
          onCopy={(s) => form.setValues((prev) => ({ ...prev, venueName: s.venueName ?? '', venueAddress: s.venueAddress ?? '' }))}
        />
        <TextField label="Venue name (optional)" placeholder="e.g. Grandma's house, Main Hall" hint="A friendly name guests will see." {...form.field('venueName')} />
        <TextField
          label="Location"
          placeholder="e.g. Taj Lands End, Bandra West, Mumbai"
          hint="Type it as you would search on Google Maps — the map below shows what guests will get directions to."
          {...form.field('venueAddress')}
        />
        <MapPreview location={v.venueAddress} venueName={v.venueName} />
        <TextField label="Online meeting link (optional)" type="url" placeholder="https://…" {...form.field('virtualMeetingUrl')} />
      </Section>

      <Section title="RSVP">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Capacity (optional)" type="number" min={1} inputMode="numeric" hint="Leave blank for no limit." {...form.field('capacity')} />
          <TextField label="RSVP deadline (optional)" type="datetime-local" hint="In the activity's timezone." {...form.field('rsvpDeadline')} />
        </div>
      </Section>

      <Section title="Itinerary" description="What happens when. Shown to guests in time order." toggle={{ checked: v.showItinerary, onChange: (x) => set('showItinerary', x) }}>
        <ItineraryEditor rows={v.itinerary} onChange={(r) => set('itinerary', r)} errors={form.errors} activityStart={v.startsAt} activityEnd={v.endsAt} />
      </Section>

      <Section title="Menu" description="Food and drinks, with dietary information." toggle={{ checked: v.showMenu, onChange: (x) => set('showMenu', x) }}>
        <MenuEditor categories={v.menu} onChange={(c) => set('menu', c)} errors={form.errors} />
      </Section>

      <Section title="Speakers & performers" toggle={{ checked: v.showPeople, onChange: (x) => set('showPeople', x) }}>
        <PeopleEditor people={v.people} onChange={(p) => set('people', p)} errors={form.errors} />
      </Section>

      <Section
        title="Dress code & theme"
        toggle={{
          checked: v.showDressCode || v.showTheme,
          onChange: (x) => form.setValues((prev) => ({ ...prev, showDressCode: x, showTheme: x })),
        }}
      >
        <TextField label="Dress code (optional)" placeholder="e.g. Indo-western, pastel shades" {...form.field('dressCode')} />
        <TextAreaField label="Theme & decor (optional)" rows={2} placeholder="Colours, décor ideas, mood…" {...form.field('themeDescription')} />
        <ThemeColours colours={v.themeColors} onChange={(c) => set('themeColors', c)} />
      </Section>

      <Section title="Instructions for guests" toggle={{ checked: v.showInstructions, onChange: (x) => set('showInstructions', x) }}>
        <TextAreaField label="Instructions (optional)" rows={3} placeholder="Parking, entry, what to bring…" {...form.field('instructions')} />
      </Section>

      <div className="sticky bottom-0 -mx-6 flex flex-wrap gap-3 border-t border-slate-200 bg-white/95 px-6 py-4 backdrop-blur">
        <Button type="submit" loading={form.submitting}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

