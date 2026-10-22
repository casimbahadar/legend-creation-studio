// Exporting the chapter as an FE8 patch (decisions 9, 15 and 27): which vanilla chapter it takes the
// place of, what the patch can't carry yet, and downloads of the UPS patch (to share) and the patched
// ROM (to play on this device).

import { useMemo, useState } from 'react';
import { mapEntry, mapRef, toName, type Project, type ProjectChapter } from '../core/project';
import { buildFe8Rom, characterIds, patchNotes } from '../rom/fe8-build';
import { createUps } from '../rom/ups';
import { download, type EditorRom } from './project-io';

export function PatchExport({ data, project, chapter, onChange }: { data: EditorRom; project: Project; chapter: ProjectChapter; onChange: (replaces: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  const slot = mapEntry(chapter.replaces ?? mapRef(0)) ?? 0;
  const notes = useMemo(() => {
    try {
      return patchNotes(chapter, characterIds(data.rom, chapter.units));
    } catch (e) {
      return [(e as Error).message];
    }
  }, [chapter, data.rom]);

  function save(kind: 'patch' | 'rom') {
    setError(null);
    try {
      const built = buildFe8Rom(data.rom, chapter).bytes;
      const name = toName(project.name);
      if (kind === 'patch') download(new Blob([createUps(data.rom.bytes, built)]), `${name}.ups`);
      else download(new Blob([built]), `${name}.gba`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="patch-export">
      <h3>FE8 patch</h3>
      <label className="field">
        Takes the place of
        <select value={slot} onChange={(e) => onChange(mapRef(Number(e.target.value)))}>
          {data.chapterTitles.map((title, i) =>
            title ? (
              <option key={i} value={i}>
                {title}
              </option>
            ) : null,
          )}
        </select>
      </label>
      <p className="note">
        {slot === 0
          ? "A new game starts with your chapter, then carries on into the rest of Sacred Stones. Your player units stay in the army; Chapter 1 brings in Eirika and Seth itself if they aren't there, and later chapters may still treat characters you used as not yet met."
          : 'Only the Prologue has been tried so far; other chapters may not build or play right.'}
      </p>
      {notes.length > 0 && (
        <div className="note">
          <p>Not in the patch yet:</p>
          <ul className="problems">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="stepper">
        <button type="button" className="button" disabled={!chapter.units.length} onClick={() => save('patch')}>
          Download patch
        </button>
        <button type="button" className="button button-secondary" disabled={!chapter.units.length} onClick={() => save('rom')}>
          Download patched ROM
        </button>
      </div>
      <p className="note">
        Share the patch (.ups): others apply it to their own clean ROM with a patcher. The patched ROM is for playing yourself in an
        emulator; don't share it.
      </p>
      {error && (
        <p className="bad" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
