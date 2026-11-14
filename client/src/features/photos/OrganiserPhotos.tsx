import { useState } from 'react';
import type { EventDetail, PhotoView } from '@gatherly/shared';
import { Alert, Button, Card, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useActivities } from '../activities/use-activities';
import { Gallery } from './Gallery';
import { PhotoUploader } from './PhotoUploader';
import { useDeletePhoto, useGallery, useGuestUploadsSetting, useReviewPhotos } from './use-photos';

function PendingReview({ eventId, pending }: { eventId: string; pending: PhotoView[] }) {
  const review = useReviewPhotos(eventId);
  const [reason, setReason] = useState('');
  const act = (photoIds: string[], decision: 'APPROVE' | 'REJECT') => review.mutate({ photoIds, decision, reason: decision === 'REJECT' ? reason || undefined : undefined });

  return (
    <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-amber-900">Waiting for approval ({pending.length})</h3>
        {pending.length > 1 && (
          <Button loading={review.isPending} onClick={() => act(pending.map((p) => p.id), 'APPROVE')}>
            ✓ Approve all
          </Button>
        )}
      </div>
      <p className="text-sm text-amber-900/80">Guest photos appear in the gallery only after an organiser approves them. Guests are emailed either way.</p>
      {review.error && <div className="mt-2"><Alert>{review.error instanceof ApiError ? review.error.message : 'Could not save.'}</Alert></div>}
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {pending.map((p) => (
          <li key={p.id} className="overflow-hidden rounded-xl bg-white ring-1 ring-amber-200">
            <a href={p.fullUrl} target="_blank" rel="noopener noreferrer" className="block aspect-video bg-slate-100">
              <img src={p.thumbUrl} alt={p.caption ?? ''} className="size-full object-cover" />
            </a>
            <div className="space-y-2 p-3">
              <p className="text-sm">
                <span className="font-medium text-slate-900">{p.uploaderName}</span>
                {p.activityName && <span className="text-slate-500"> · {p.activityName}</span>}
              </p>
              {p.caption && <p className="text-sm text-slate-600">“{p.caption}”</p>}
              <div className="flex gap-2">
                <Button className="flex-1" loading={review.isPending && review.variables?.photoIds.includes(p.id) && review.variables.decision === 'APPROVE'} onClick={() => act([p.id], 'APPROVE')}>
                  Approve
                </Button>
                <Button className="flex-1" variant="secondary" onClick={() => act([p.id], 'REJECT')}>
                  Reject
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
      <label className="mt-3 block text-sm text-amber-900">
        Note sent to guests when you reject (optional)
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. A bit blurry — please share another!" className="mt-1 block w-full rounded-lg border border-amber-200 px-3 py-2 text-sm" />
      </label>
    </div>
  );
}

/** Photos tab for organisers (FR-161 – FR-178). */
export function OrganiserPhotos({ event }: { event: EventDetail }) {
  const { data, isPending } = useGallery({ kind: 'organiser', eventId: event.id });
  const { data: activities = [] } = useActivities(event.id);
  const setting = useGuestUploadsSetting(event.id);
  const del = useDeletePhoto(event.id);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const canUpload = event.allowedActions.includes('photos.upload');
  const canModerate = event.allowedActions.includes('photos.moderate');
  const canSettings = event.allowedActions.includes('gallery.settings');

  if (isPending || !data) return <Spinner label="Loading photos" />;
  const pending = data.photos.filter((p) => p.status === 'PENDING_APPROVAL');
  const approved = data.photos.filter((p) => p.status === 'APPROVED');

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Photos {approved.length > 0 && <span className="font-normal text-slate-500">({approved.length})</span>}</h2>
          <p className="text-sm text-slate-500">Every invited guest can see and download the gallery — including photos from activities they didn't attend.</p>
        </div>
        {canUpload && !uploading && <Button onClick={() => setUploading(true)}>+ Add photos</Button>}
      </div>

      {canSettings && (
        <label className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200">
          <input
            type="checkbox"
            className="mt-0.5 size-5 accent-brand-600"
            checked={data.guestUploadsEnabled}
            disabled={setting.isPending}
            onChange={(e) => setting.mutate(e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900">Let guests share photos</span>
            <span className="block text-slate-500">Up to 20 each. They appear in the gallery only after an organiser approves them.</span>
          </span>
        </label>
      )}

      {notice && <div className="mt-4"><Alert tone="success">{notice}</Alert></div>}

      {uploading && (
        <div className="mt-4">
          <PhotoUploader
            scope={{ kind: 'organiser', eventId: event.id }}
            activities={activities}
            note="Photos are resized and cleaned of location data in your browser before uploading."
            onDone={(n) => {
              setUploading(false);
              if (n) setNotice(`${n} photo${n === 1 ? '' : 's'} added to the gallery.`);
            }}
          />
          <Button variant="ghost" className="mt-2" onClick={() => setUploading(false)}>
            Close
          </Button>
        </div>
      )}

      {canModerate && pending.length > 0 && (
        <div className="mt-5">
          <PendingReview eventId={event.id} pending={pending} />
        </div>
      )}

      <div className="mt-5">
        <Gallery
          photos={approved}
          emptyText={canUpload ? 'No photos yet. Add some, or let guests share theirs.' : 'No photos yet.'}
          actions={
            canUpload
              ? (p) => (
                  <button
                    type="button"
                    onClick={() => window.confirm('Remove this photo from the gallery? It will be deleted.') && del.mutate(p.id)}
                    className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                    aria-label="Remove photo"
                  >
                    Remove
                  </button>
                )
              : undefined
          }
        />
      </div>
    </Card>
  );
}
