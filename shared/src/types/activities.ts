import type { ActivityStatus } from '../domain/enums.js';

export interface ActivityDetail {
  id: string;
  eventId: string;
  /** Human-readable URL identifier; nullable only during the staged backfill. */
  slug: string | null;
  name: string;
  description: string;
  status: ActivityStatus;
  timezone: string;
  startsAt: string; // ISO (UTC)
  endsAt: string;
  startsAtLocal: string; // wall-clock in `timezone`
  endsAtLocal: string;
  sortOrder: number;

  venueName: string | null;
  venueAddress: string | null;
  venueLatitude: number | null;
  venueLongitude: number | null;
  virtualMeetingUrl: string | null;
  /** Google Maps directions link built from coordinates or address (FR-101, FR-189). */
  mapsUrl: string | null;

  capacity: number | null;
  rsvpDeadline: string | null; // ISO
  rsvpDeadlineLocal: string | null;

  dressCode: string | null;
  themeDescription: string | null;
  themeColors: string[];
  instructions: string | null;

  showPeople: boolean;
  showItinerary: boolean;
  showMenu: boolean;
  showDressCode: boolean;
  showTheme: boolean;
  showInstructions: boolean;

  /** Chronological (FR-028); `position` breaks ties for entries at the same time. */
  itinerary: ItineraryEntry[];
  menu: MenuCategory[];
  people: ActivityPerson[];
}

export interface ItineraryEntry {
  id: string;
  title: string;
  description: string | null;
  startsAt: string; // ISO
  endsAt: string | null;
  startsAtLocal: string; // wall-clock in the activity timezone
  endsAtLocal: string | null;
}

export interface MenuItem {
  id: string;
  name: string;
  description: string | null;
  dietaryTags: string[];
}

export interface MenuCategory {
  id: string;
  name: string;
  items: MenuItem[];
}

export interface ActivityPerson {
  id: string;
  role: 'SPEAKER' | 'PERFORMER' | 'PARTICIPANT';
  name: string;
  title: string | null;
  bio: string | null;
}

type VenueLike = {
  venueName?: string | null;
  venueAddress?: string | null;
  venueLatitude?: number | null;
  venueLongitude?: number | null;
};

/**
 * What to search for on Google Maps. The Location text (`venueAddress`) is the search; the venue
 * name is a friendly label ("Grandma's house") and is only used when no location was entered.
 * Exact coordinates, if ever stored, take precedence.
 */
export function mapsQuery(venue: VenueLike): string | null {
  if (venue.venueLatitude != null && venue.venueLongitude != null) return `${venue.venueLatitude},${venue.venueLongitude}`;
  const q = (venue.venueAddress?.trim() || venue.venueName?.trim()) ?? '';
  return q || null;
}

/** "Open in Google Maps" / directions link — needs no API key (FR-101, FR-189). */
export function googleMapsUrl(venue: VenueLike): string | null {
  const q = mapsQuery(venue);
  return q ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}` : null;
}

/** Keyless embeddable map for previews (organiser form, guest activity page). */
export function googleMapsEmbedUrl(venue: VenueLike): string | null {
  const q = mapsQuery(venue);
  return q ? `https://www.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed` : null;
}
