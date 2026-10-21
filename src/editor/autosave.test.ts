import { describe, expect, it } from 'vitest';
import { readAutosave, writeAutosave, type KeyValueStore } from './autosave';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

describe('autosave', () => {
  it('round-trips the project and the last saved copy', () => {
    const store = memoryStore();
    expect(writeAutosave(store, { project: { name: 'A' }, savedJson: '{"name":"A"}' })).toBe(true);
    expect(readAutosave(store)).toEqual({ project: { name: 'A' }, savedJson: '{"name":"A"}' });
  });

  it('reads nothing from an empty, missing or corrupt store', () => {
    expect(readAutosave(memoryStore())).toBeNull();
    expect(readAutosave(null)).toBeNull();
    const store = memoryStore();
    store.data.set('lcs.autosave.v0', '{not json');
    expect(readAutosave(store)).toBeNull();
  });

  it('reports a store that refuses to write', () => {
    const full: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(writeAutosave(full, { project: {}, savedJson: null })).toBe(false);
    expect(writeAutosave(null, { project: {}, savedJson: null })).toBe(false);
  });
});
