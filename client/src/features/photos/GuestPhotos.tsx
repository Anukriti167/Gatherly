import { useState } from 'react';
import { Alert, Button } from '../../components/ui';
import { Gallery } from './Gallery';
import { PhotoUploader } from './PhotoUploader';
import { useGallery } from './use-photos';

/** The event gallery on the guest's page (FR-164 – FR-177, FR-217). */
export function GuestPhotos({ activities }: { activities: { id: string; name: string }[] }) {
  const { data } = useGallery({ kind: 'guest' });
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (!data) return null;

  const mineWaiting = data.photos.filter((p) => p.mine && p.status === 'PENDING_APPROVAL').length;

  return (
    <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">📸 Photos</h2>
        {data.guestUploadsEnabled && !sharing && (data.remainingUploads ?? 0) > 0 && (
          <Button variant="secondary" onClick={() => setSharing(true)}>
            Share your photos
          </Button>
        )}
      </div>
      {notice && <div className="mt-3"><Alert tone="success">{notice}</Alert></div>}
      {mineWaiting > 0 && !notice && (
        <p className="mt-2 text-sm text-amber-700">
          {mineWaiting} of your photo{mineWaiting === 1 ? ' is' : 's are'} waiting for the organisers to approve.
        </p>
      )}
      {sharing && (
        <div className="mt-4">
          <PhotoUploader
            scope={{ kind: 'guest' }}
            activities={activities}
            remaining={data.remainingUploads}
            note="Your photos will appear for everyone once the organisers approve them. They're resized and cleaned of location data before uploading."
            onDone={(n) => {
              setSharing(false);
              if (n) setNotice(`Thanks! ${n} photo${n === 1 ? '' : 's'} sent to the organisers for approval.`);
            }}
          />
          <Button variant="ghost" className="mt-2" onClick={() => setSharing(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div className="mt-4">
        <Gallery photos={data.photos} emptyText="No photos yet — check back after the event!" />
      </div>
    </section>
  );
}
