import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiErrorBody, GalleryView, PhotoView } from '@gatherly/shared';
import { api, ApiError } from '../../lib/api';
import { live } from '../../lib/live';
import type { PreparedPhoto } from './resize';

/** Where a gallery lives: an organiser's event, or the signed-in guest's event. */
export type GalleryScope = { kind: 'organiser'; eventId: string } | { kind: 'guest' };

const keyOf = (s: GalleryScope) => (s.kind === 'organiser' ? (['events', s.eventId, 'photos'] as const) : (['guest', 'photos'] as const));
const baseOf = (s: GalleryScope) => (s.kind === 'organiser' ? `/events/${encodeURIComponent(s.eventId)}/photos` : '/guest/photos');

export function useGallery(scope: GalleryScope) {
  return useQuery({ queryKey: keyOf(scope), queryFn: () => api.get<GalleryView>(baseOf(scope)), ...live });
}

/** Multipart upload of a prepared photo (display version + thumbnail). */
async function uploadOne(scope: GalleryScope, photo: PreparedPhoto, meta: { caption?: string; activityId?: string }): Promise<PhotoView> {
  const form = new FormData();
  form.append('full', photo.full, 'photo.jpg');
  form.append('thumb', photo.thumb, 'thumb.jpg');
  if (meta.caption) form.append('caption', meta.caption);
  if (meta.activityId) form.append('activityId', meta.activityId);
  const res = await fetch(`/api/v1${baseOf(scope)}`, { method: 'POST', body: form, credentials: 'same-origin' });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, err?.code ?? 'UPLOAD', err?.message ?? 'Upload failed.');
  }
  return (data as { photo: PhotoView }).photo;
}

export function useUploadPhoto(scope: GalleryScope) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { photo: PreparedPhoto; caption?: string; activityId?: string }) => uploadOne(scope, v.photo, v),
    onSettled: () => qc.invalidateQueries({ queryKey: keyOf(scope) }),
  });
}

export function useReviewPhotos(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { photoIds: string[]; decision: 'APPROVE' | 'REJECT'; reason?: string }) =>
      api.post<{ updated: number }>(`/events/${encodeURIComponent(eventId)}/photos/review`, v),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['events', eventId, 'photos'] }), qc.invalidateQueries({ queryKey: ['action-items'] })]),
  });
}

export function useDeletePhoto(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => api.delete<void>(`/events/${encodeURIComponent(eventId)}/photos/${encodeURIComponent(photoId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', eventId, 'photos'] }),
  });
}

export function useGuestUploadsSetting(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api.put<void>(`/events/${encodeURIComponent(eventId)}/photos/settings`, { guestUploadsEnabled: enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events', eventId] }),
  });
}
