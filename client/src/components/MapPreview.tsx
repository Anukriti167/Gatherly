import { googleMapsEmbedUrl, googleMapsUrl } from '@gatherly/shared';
import { useDebounced } from '../lib/use-debounced';

/**
 * Free, keyless Google map preview for a location (no API key, no billing). Updates shortly
 * after the user stops typing so we don't reload the map on every keystroke.
 */
export function MapPreview({ location, venueName, height = 220 }: { location: string; venueName?: string; height?: number }) {
  const query = useDebounced(location.trim(), 700);
  const embed = googleMapsEmbedUrl({ venueAddress: query, venueName });
  const link = googleMapsUrl({ venueAddress: query, venueName });

  if (!embed) {
    return (
      <div className="flex items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500" style={{ height }}>
        Type a location above to see it on the map
      </div>
    );
  }

  return (
    <div>
      <iframe
        key={embed}
        title={`Map of ${query || venueName}`}
        src={embed}
        width="100%"
        height={height}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="w-full rounded-xl border-0 ring-1 ring-slate-200"
      />
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline">
          Open in Google Maps ↗
        </a>
      )}
    </div>
  );
}
