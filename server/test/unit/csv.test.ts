import { describe, expect, it } from 'vitest';
import { parseCsv } from '@gatherly/shared';

describe('parseCsv', () => {
  it('parses simple rows and trims cells', () => {
    expect(parseCsv('Name,Email\n Asha , asha@example.com \n')).toEqual([
      ['Name', 'Email'],
      ['Asha', 'asha@example.com'],
    ]);
  });

  it('handles quoted commas, escaped quotes and line breaks inside quotes', () => {
    expect(parseCsv('name,note\n"Rao, Asha","She said ""hi""\nthen left"')).toEqual([
      ['name', 'note'],
      ['Rao, Asha', 'She said "hi"\nthen left'],
    ]);
  });

  it('accepts Windows line endings and an Excel UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿Name,Email\r\nA,a@x.co\r\n')).toEqual([
      ['Name', 'Email'],
      ['A', 'a@x.co'],
    ]);
  });

  it('drops blank lines and keeps a last row without a newline', () => {
    expect(parseCsv('a,b\n\n,\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps Unicode names intact', () => {
    expect(parseCsv('Name\nअनुकृति बनर्जी\nJosé Müller')).toEqual([['Name'], ['अनुकृति बनर्जी'], ['José Müller']]);
  });
});
