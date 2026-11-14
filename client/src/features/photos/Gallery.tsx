import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { PhotoView } from '@gatherly/shared';
import { Badge } from '../../components/ui';

const dateOf = (iso: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** Full-screen viewer (FR-176): ←/→ to browse, Esc to close, download (FR-217). */
export function Lightbox({ photos, index, onIndex, onClose }: { photos: PhotoView[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const photo = photos[index];
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [index, photos.length, onIndex, onClose]);

  if (!photo) return null;
  const nav = 'absolute top-1/2 -translate-y-1/2 rounded-full bg-white/15 p-3 text-2xl text-white hover:bg-white/30 disabled:opacity-30';

  return (
    <div role="dialog" aria-modal="true" aria-label="Photo viewer" className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center justify-between gap-3 p-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
        <span className="opacity-80">
          {index + 1} / {photos.length}
        </span>
        <span className="flex gap-2">
          <a href={photo.downloadUrl} className="rounded-lg bg-white/15 px-3 py-1.5 font-medium hover:bg-white/30">
            ⬇ Download
          </a>
          <button ref={closeRef} type="button" onClick={onClose} className="rounded-lg bg-white/15 px-3 py-1.5 font-medium hover:bg-white/30" aria-label="Close">
            ✕
          </button>
        </span>
      </div>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-12" onClick={(e) => e.stopPropagation()}>
        <img src={photo.fullUrl} alt={photo.caption ?? `Photo ${index + 1}`} className="max-h-full max-w-full object-contain" />
        <button type="button" aria-label="Previous photo" disabled={index === 0} onClick={() => onIndex(index - 1)} className={`${nav} left-2`}>
          ‹
        </button>
        <button type="button" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => onIndex(index + 1)} className={`${nav} right-2`}>
          ›
        </button>
      </div>
      <div className="p-4 text-center text-sm text-white" onClick={(e) => e.stopPropagation()}>
        {photo.caption && <p className="text-base font-medium">{photo.caption}</p>}
        <p className="opacity-75">
          {photo.uploaderName} · {dateOf(photo.createdAt)}
          {photo.activityName && <> · {photo.activityName}</>}
        </p>
      </div>
    </div>
  );
}

/**
 * Photo grid with an activity filter (FR-165) and lightbox. `actions` renders extra controls on
 * each tile (e.g. delete for organisers).
 */
export function Gallery({ photos, emptyText, actions }: { photos: PhotoView[]; emptyText: string; actions?: (p: PhotoView) => ReactNode }) {
  const [filter, setFilter] = useState<string>('all');
  const [open, setOpen] = useState<number | null>(null);
  const activities = [...new Map(photos.filter((p) => p.activityId).map((p) => [p.activityId!, p.activityName ?? 'Activity'])).entries()];
  const visible = filter === 'all' ? photos : filter === 'event' ? photos.filter((p) => !p.activityId) : photos.filter((p) => p.activityId === filter);
  const chip = (key: string, label: string, n: number) => (
    <button
      key={key}
      type="button"
      aria-pressed={filter === key}
      onClick={() => setFilter(key)}
      className={`rounded-full px-3 py-1 text-sm ring-1 ${filter === key ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
    >
      {label} <span className="opacity-70">{n}</span>
    </button>
  );

  if (photos.length === 0) return <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{emptyText}</p>;

  return (
    <div>
      {activities.length > 0 && (
        <div role="group" aria-label="Filter photos by activity" className="mb-4 flex flex-wrap gap-1.5">
          {chip('all', 'All', photos.length)}
          {activities.map(([id, name]) => chip(id, name, photos.filter((p) => p.activityId === id).length))}
          {photos.some((p) => !p.activityId) && chip('event', 'General', photos.filter((p) => !p.activityId).length)}
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {visible.map((p, i) => (
          <li key={p.id} className="group relative overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
            <button type="button" onClick={() => setOpen(i)} className="block aspect-square w-full" aria-label={`Open ${p.caption ?? 'photo'}`}>
              <img src={p.thumbUrl} alt={p.caption ?? ''} loading="lazy" className="size-full object-cover transition group-hover:scale-105" />
            </button>
            {p.status !== 'APPROVED' && (
              <span className="absolute left-2 top-2">
                <Badge tone={p.status === 'REJECTED' ? 'red' : 'amber'}>{p.status === 'REJECTED' ? 'Not approved' : 'Awaiting approval'}</Badge>
              </span>
            )}
            {(p.caption || actions) && (
              <div className="flex items-center justify-between gap-1 bg-white px-2 py-1.5">
                <span className="truncate text-xs text-slate-600">{p.caption ?? p.uploaderName}</span>
                {actions?.(p)}
              </div>
            )}
          </li>
        ))}
      </ul>
      {open !== null && <Lightbox photos={visible} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}
