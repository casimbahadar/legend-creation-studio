import { describe, expect, it } from 'vitest';
import { shortClassLabel } from './labels';

describe('shortClassLabel', () => {
  it('shortens the gender in a class label and leaves other labels alone', () => {
    expect(shortClassLabel('Myrmidon (male)')).toBe('Myrmidon (M)');
    expect(shortClassLabel('Cavalier (female)')).toBe('Cavalier (F)');
    expect(shortClassLabel('Lord (Eirika)')).toBe('Lord (Eirika)');
  });
});
