import { describe, expect, it } from 'vitest';
import { googleMapsEmbedUrl, googleMapsUrl, mapsQuery } from '@gatherly/shared';

describe('mapsQuery', () => {
  it('searches the Location text; the venue name is only a label', () => {
    expect(mapsQuery({ venueName: "Grandma's house", venueAddress: '12 MG Road, Pune' })).toBe('12 MG Road, Pune');
  });

  it('falls back to the venue name when no location was entered', () => {
    expect(mapsQuery({ venueName: 'Taj Lands End, Mumbai', venueAddress: '  ' })).toBe('Taj Lands End, Mumbai');
  });

  it('uses stored coordinates when present', () => {
    expect(mapsQuery({ venueAddress: 'x', venueLatitude: 19.04, venueLongitude: 72.82 })).toBe('19.04,72.82');
  });

  it('returns null when there is nothing to search', () => {
    expect(mapsQuery({})).toBeNull();
    expect(mapsQuery({ venueName: '', venueAddress: '' })).toBeNull();
  });
});

describe('Google Maps links (free, keyless)', () => {
  it('builds an "open in Maps" link with the query safely encoded', () => {
    expect(googleMapsUrl({ venueAddress: 'Café & Bar, Pune' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Caf%C3%A9%20%26%20Bar%2C%20Pune',
    );
  });

  it('builds an embeddable map URL that needs no API key', () => {
    const url = googleMapsEmbedUrl({ venueAddress: 'Taj Lands End, Mumbai' })!;
    expect(url).toBe('https://www.google.com/maps?q=Taj%20Lands%20End%2C%20Mumbai&z=15&output=embed');
    expect(url).not.toMatch(/key=/);
  });

  it('returns null without a location', () => {
    expect(googleMapsUrl({})).toBeNull();
    expect(googleMapsEmbedUrl({})).toBeNull();
  });
});
