// Exporting the chapter as an FE8 patch (decisions 9, 15 and 27): which vanilla chapter it takes the
// place of, what the patch can't carry yet, and downloads of the UPS patch (to share) and the patched
// ROM (to play on this device).

import { useMemo, useState } from 'react';
import { mapEntry, mapRef, toName, type Project, type ProjectChapter } from '../core/project';
import { buildFe8Rom, characterIds, goalBlocker, ownsCharacter, patchNotes } from '../rom/fe8-build';
import { nameProblem } from '../rom/text-encode';
import { crc32 } from '../rom/crc32';
import { createUps } from '../rom/ups';
import { download, type EditorRom } from './project-io';

export function PatchExport({ data, project, chapter, onChange }: { data: EditorRom; project: Project; chapter: ProjectChapter; onChange: (replaces: string) => void }) {
  const [error, setError] = useState<string | null>(null);
  /** The last file downloaded, with its CRC32 to compare against Developer checks. */
  const [saved, setSaved] = useState<string | null>(null);
  const slot = mapEntry(chapter.replaces ?? mapRef(0)) ?? 0;
  const notes = useMemo(() => {
    try {
      return patchNotes(chapter, characterIds(data.rom, chapter.units), data.rom);
    } catch (e) {
      return [(e as Error).message];
    }
  }, [chapter, data.rom]);

  // Names the game can't spell would stop the build, so they block the downloads and are listed here.
  const nameProblems = chapter.units.flatMap((u) => {
    const problem = ownsCharacter(u) && u.name?.trim() ? nameProblem(data.textCodes, u.name) : null;
    return problem ? [`${u.name}: ${problem}`] : [];
  });
  const goalBlock = goalBlocker(chapter);
  const blocked = !chapter.units.length || nameProblems.length > 0 || goalBlock !== null;

  function save(kind: 'patch' | 'rom') {
    setError(null);
    setSaved(null);
    try {
      const built = buildFe8Rom(data.rom, data.text, chapter).bytes;
      const name = toName(project.name);
      const file = kind === 'patch' ? createUps(data.rom.bytes, built) : built;
      const fileName = `${name}.${kind === 'patch' ? 'ups' : 'gba'}`;
      download(new Blob([file]), fileName);
      const code = (n: Uint8Array) => crc32(n).toString(16).toUpperCase().padStart(8, '0');
      setSaved(
        kind === 'patch'
          ? `Downloaded ${fileName}. The ROM it makes has CRC32 ${code(built)}.`
          : `Downloaded ${fileName}, CRC32 ${code(built)}. Developer checks › Patched ROM shows this code for the same file.`,
      );
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
      {nameProblems.length > 0 && (
        <div className="bad">
          <p>Change these names to download:</p>
          <ul className="problems">
            {nameProblems.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
      {goalBlock && <p className="bad">Goal: {goalBlock}</p>}
      <div className="stepper">
        <button type="button" className="button" disabled={blocked} onClick={() => save('patch')}>
          Download patch
        </button>
        <button type="button" className="button button-secondary" disabled={blocked} onClick={() => save('rom')}>
          Download patched ROM
        </button>
      </div>
      <p className="note">
        Share the patch (.ups): others apply it to their own clean ROM with a patcher. The patched ROM is for playing yourself in an
        emulator; don't share it.
      </p>
      {saved && <p className="note">{saved}</p>}
      {error && (
        <p className="bad" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
