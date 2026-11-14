import { useState } from 'react';
import { Alert, Button, SelectField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { preparePhoto, type PreparedPhoto } from './resize';
import { useUploadPhoto, type GalleryScope } from './use-photos';

type Item = { key: string; name: string; photo?: PreparedPhoto; caption: string; state: 'preparing' | 'ready' | 'uploading' | 'done' | 'error'; error?: string };

/**
 * Pick several photos, add captions, choose an activity, upload (FR-162, FR-163, FR-169).
 * Photos are resized in the browser first; uploads run one at a time with per-photo status.
 */
export function PhotoUploader({
  scope,
  activities,
  remaining,
  note,
  onDone,
}: {
  scope: GalleryScope;
  activities: { id: string; name: string }[];
  /** Guests: how many more photos they may share. */
  remaining?: number | null;
  note?: string;
  onDone?: (uploaded: number) => void;
}) {
  const upload = useUploadPhoto(scope);
  const [items, setItems] = useState<Item[]>([]);
  const [activityId, setActivityId] = useState('');
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const patch = (key: string, p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const choose = async (files: FileList | null) => {
    setWarning(null);
    let picked = [...(files ?? [])];
    const room = remaining == null ? Infinity : remaining - items.length;
    if (picked.length > room) {
      setWarning(`You can share ${Math.max(0, room)} more photo${room === 1 ? '' : 's'}; only the first ${Math.max(0, room)} were added.`);
      picked = picked.slice(0, Math.max(0, room));
    }
    const fresh: Item[] = picked.map((f) => ({ key: crypto.randomUUID(), name: f.name, caption: '', state: 'preparing' }));
    setItems((list) => [...list, ...fresh]);
    await Promise.all(
      picked.map(async (f, i) => {
        try {
          patch(fresh[i]!.key, { photo: await preparePhoto(f), state: 'ready' });
        } catch (e) {
          patch(fresh[i]!.key, { state: 'error', error: e instanceof Error ? e.message : 'Could not read this file.' });
        }
      }),
    );
  };

  const start = async () => {
    setBusy(true);
    let ok = 0;
    for (const item of items.filter((i) => i.state === 'ready')) {
      patch(item.key, { state: 'uploading' });
      try {
        await upload.mutateAsync({ photo: item.photo!, caption: item.caption.trim() || undefined, activityId: activityId || undefined });
        patch(item.key, { state: 'done' });
        ok += 1;
      } catch (e) {
        patch(item.key, { state: 'error', error: e instanceof ApiError ? e.message : 'Upload failed.' });
      }
    }
    setBusy(false);
    setItems((list) => list.filter((i) => i.state !== 'done'));
    onDone?.(ok);
  };

  const ready = items.filter((i) => i.state === 'ready').length;

  return (
    <div className="space-y-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      {note && <p className="text-sm text-slate-600">{note}</p>}
      <label className="block">
        <span className="sr-only">Choose photos</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          disabled={busy || remaining === 0}
          onChange={(e) => {
            void choose(e.target.files);
            e.target.value = '';
          }}
          className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-600 file:px-4 file:py-2 file:font-semibold file:text-white hover:file:bg-brand-700 disabled:opacity-50"
        />
      </label>
      {remaining != null && <p className="text-xs text-slate-500">You can share {remaining} more photo{remaining === 1 ? '' : 's'}.</p>}
      {warning && <Alert tone="info">{warning}</Alert>}

      {items.length > 0 && (
        <>
          <ul className="grid gap-2 sm:grid-cols-2">
            {items.map((i) => (
              <li key={i.key} className="flex gap-3 rounded-lg bg-white p-2 ring-1 ring-slate-200">
                <div className="size-16 shrink-0 overflow-hidden rounded-md bg-slate-100">
                  {i.photo && <img src={i.photo.previewUrl} alt="" className="size-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <input
                    aria-label={`Caption for ${i.name}`}
                    placeholder="Caption (optional)"
                    value={i.caption}
                    maxLength={300}
                    disabled={i.state !== 'ready'}
                    onChange={(e) => patch(i.key, { caption: e.target.value })}
                    className="w-full rounded-md border border-slate-300 px-2 py-1 text-sm"
                  />
                  <p className={`mt-1 text-xs ${i.state === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                    {{ preparing: 'Preparing…', ready: 'Ready', uploading: 'Uploading…', done: 'Uploaded', error: i.error }[i.state]}
                  </p>
                </div>
                {!busy && (
                  <button type="button" aria-label={`Remove ${i.name}`} onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))} className="self-start px-1 text-slate-400 hover:text-red-600">
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
          {activities.length > 0 && (
            <SelectField
              label="Which activity are these from? (optional)"
              name="activityId"
              value={activityId}
              onChange={(e) => setActivityId(e.target.value)}
              options={[{ value: '', label: 'The event in general' }, ...activities.map((a) => ({ value: a.id, label: a.name }))]}
            />
          )}
          <Button loading={busy} disabled={ready === 0} onClick={() => void start()}>
            Upload {ready} photo{ready === 1 ? '' : 's'}
          </Button>
        </>
      )}
    </div>
  );
}
