import { describe, expect, it } from 'vitest';
import { slugify } from '../../src/lib/slug.ts';

describe('slugify', () => {
  it('creates lowercase hyphenated slugs', () => {
    expect(slugify("Kritika's Birthday Party!")).toBe('kritika-s-birthday-party');
  });

  it('normalizes accents and ampersands', () => {
    expect(slugify('Café & Déjà Vu')).toBe('cafe-and-deja-vu');
  });

  it('uses a fallback when the name has no URL-safe characters', () => {
    expect(slugify('🎉✨', 'event')).toBe('event');
  });

  it('limits the slug to the database column length', () => {
    expect(slugify('a'.repeat(250))).toHaveLength(191);
  });
});
