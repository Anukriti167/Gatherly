import type { ActivityDetail } from '@gatherly/shared';

/** Choose "all activities" (incl. future ones) or specific activities (FR-076, FR-077). */
export function AssignmentPicker({
  activities,
  allActivities,
  activityIds,
  onChange,
  error,
}: {
  activities: ActivityDetail[];
  allActivities: boolean;
  activityIds: string[];
  onChange: (v: { allActivities: boolean; activityIds: string[] }) => void;
  error?: string;
}) {
  const toggle = (id: string) =>
    onChange({ allActivities: false, activityIds: activityIds.includes(id) ? activityIds.filter((x) => x !== id) : [...activityIds, id] });

  return (
    <fieldset>
      <legend className="mb-1.5 text-sm font-medium text-slate-800">Invited to</legend>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={allActivities}
          onChange={(e) => onChange({ allActivities: e.target.checked, activityIds: e.target.checked ? [] : activityIds })}
          className="size-4 accent-brand-600"
        />
        <span>
          <strong>All activities</strong> <span className="text-slate-500">— including ones added later</span>
        </span>
      </label>
      {!allActivities && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {activities.length === 0 && <p className="text-sm text-slate-500">Add activities to the event to assign guests to them.</p>}
          {activities.map((a) => {
            const on = activityIds.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(a.id)}
                className={`rounded-full px-3 py-1 text-sm ring-1 ${on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
              >
                {a.name}
              </button>
            );
          })}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </fieldset>
  );
}
