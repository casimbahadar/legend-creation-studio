// Keeps the chapter on this device between visits. A safety net only: browsers can clear it
// (private browsing, low storage, Safari after weeks without a visit), so Save is the real copy.

const KEY = 'lcs.autosave.v0';

/** The parts of Storage this needs, so tests can pass a stand-in. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export interface Autosave {
  /** The project as last edited, as parsed JSON. Check it before use. */
  readonly project: unknown;
  /** The project JSON as last saved to or opened from a file, or null if never. */
  readonly savedJson: string | null;
}

/** localStorage, or null when the browser blocks it. */
export function deviceStore(): KeyValueStore | null {
  try {
    const s = window.localStorage;
    const probe = `${KEY}.probe`;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function readAutosave(store: KeyValueStore | null): Autosave | null {
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null || !('project' in data)) return null;
    const savedJson = 'savedJson' in data && typeof data.savedJson === 'string' ? data.savedJson : null;
    return { project: data.project, savedJson };
  } catch {
    return null;
  }
}

/** Returns false if the browser refused to store it. */
export function writeAutosave(store: KeyValueStore | null, autosave: Autosave): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify(autosave));
    return true;
  } catch {
    return false;
  }
}
