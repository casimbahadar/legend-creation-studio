// Checks for whoever is building the tool rather than making a chapter: reading any text entry from
// the ROM, and whether the hand-written class, item and character name lists (decision 18) match it. Collapsed
// at the bottom of the page; a mismatch still shows a warning outside it, since the editor relies on
// those lists. A patched ROM can be opened here too, to see what a downloaded patch put in it.

import { useState, type ChangeEvent } from 'react';
import { STAT_KEYS } from '../core/project';
import { crc32 } from '../rom/crc32';
import { ALL_CHARACTER_NAMES, GENERIC_ALLY, GENERIC_ENEMY } from '../rom/fe8-character-names';
import { FE8_ITEM_NAMES } from '../rom/fe8-item-names';
import { FE8_CLASS_NAMES } from '../rom/fe8-names';
import { readRom, type GbaRom } from '../rom/gba-rom';
import { readChapter, readPlayerUnits } from '../rom/fe8-chapters';
import { findCharacterTable, readCharacters } from '../rom/fe8-characters';
import { FE8_CLASS_NAMES as CLASS_LIST } from '../rom/fe8-names';
import { decodeText, findTextTable, type TextTable } from '../rom/text';
import { STAT_LABELS } from './labels';
import type { EditorRom } from './project-io';

export function DeveloperChecks({ rom, text, data }: { rom: GbaRom; text: TextTable | null; data: EditorRom | null }) {
  const [textId, setTextId] = useState('');
  const mismatched = data ? data.mismatches.length + data.itemMismatches.length + data.characterMismatches.length : 0;
  return (
    <section className="panel">
      {mismatched > 0 && (
        <p className="bad">Some class, item or character names don't match your ROM, so parts of the editor may not work. See Developer checks below.</p>
      )}
      <details className="developer">
        <summary>Developer checks</summary>
        <h3>ROM text</h3>
        {text ? (
          <>
            <p className="note">Read {text.count.toLocaleString()} text entries from your ROM.</p>
            <label className="field">
              Text number (0 to {text.count - 1})
              <input type="text" inputMode="numeric" pattern="[0-9]*" value={textId} onChange={(e) => setTextId(e.target.value.replace(/\D/g, ''))} />
            </label>
            {textId !== '' && <pre className="text-out">{decodeText(rom, text, Number(textId)) || '(empty)'}</pre>}
          </>
        ) : (
          <p className="bad">Couldn't find the text table in this ROM.</p>
        )}
        <h3>Prologue units</h3>
        <p className="note">The Prologue's player units as your ROM stores them. In the game: Seth, a Paladin, and Eirika, a Lord, both level 1.</p>
        {text && <PrologueUnits rom={rom} text={text} />}
        <h3>Patched ROM</h3>
        <p className="note">Open a patched ROM you downloaded to see the Prologue's player units as it stores them, with each character's name and personal stats.</p>
        <PatchedRomCheck />
        <h3>Name lists</h3>
        {data && (
          <>
            {data.mismatches.length ? (
              <details className="note bad">
                <summary>
                  Name list check: {data.mismatches.length} of {FE8_CLASS_NAMES.length} class names don't match your ROM. Tap to see
                  them.
                </summary>
                <ul className="problems">
                  {data.mismatches.map((m) => (
                    <li key={m.entry.name}>
                      {m.entry.name} (class 0x{m.entry.id.toString(16).toUpperCase()}): expected "{m.entry.gameName}", ROM shows{' '}
                      {m.romName === null ? 'nothing' : `"${m.romName}"`}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="note">Name list check: all {FE8_CLASS_NAMES.length} class names match your ROM.</p>
            )}
            {data.itemMismatches.length ? (
              <details className="note bad">
                <summary>
                  Item list check: {data.itemMismatches.length} of {FE8_ITEM_NAMES.length} item names don't match your ROM. Tap to see them.
                </summary>
                <ul className="problems">
                  {data.itemMismatches.map((m) => (
                    <li key={m.entry.name}>
                      {m.entry.name} (item 0x{m.entry.id.toString(16).toUpperCase()}): expected "{m.entry.gameName}", ROM shows{' '}
                      {m.romName === null ? 'nothing' : `"${m.romName}"`}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="note">Item list check: all {FE8_ITEM_NAMES.length} item names match your ROM.</p>
            )}
            {data.characterMismatches.length ? (
              <details className="note bad">
                <summary>
                  Character list check: {data.characterMismatches.length} of {ALL_CHARACTER_NAMES.length} character and boss names don't match your
                  ROM. Tap to see them.
                </summary>
                <ul className="problems">
                  {data.characterMismatches.map((m) => (
                    <li key={m.entry.name}>
                      {m.entry.name} (character 0x{m.entry.id.toString(16).toUpperCase()}): expected "{m.entry.gameName}", ROM shows{' '}
                      {m.romName === null ? 'nothing' : `"${m.romName}"`}
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <p className="note">
                Character list check: all {ALL_CHARACTER_NAMES.length} character and boss names match your ROM. Enemies will be "
                {data.characters[GENERIC_ENEMY - 1]?.name ?? '?'}" and allies "{data.characters[GENERIC_ALLY - 1]?.name ?? '?'}" (expected Soldier and Frelian).
              </p>
            )}
          </>
        )}
      </details>
    </section>
  );
}

function PatchedRomCheck() {
  const [result, setResult] = useState<{ name: string; rom: GbaRom; text: TextTable | null } | null>(null);
  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const rom = readRom(new Uint8Array(await file.arrayBuffer()));
    setResult({ name: file.name, rom, text: findTextTable(rom) });
  }
  return (
    <>
      <label className="button button-secondary">
        Open a patched ROM
        <input type="file" className="visually-hidden" onChange={onFile} />
      </label>
      {result && (
        <>
          <p className="note">
            {result.name}: {(result.rom.size / 0x100000).toFixed(2)} MB, CRC32 {crc32(result.rom.bytes).toString(16).toUpperCase().padStart(8, '0')}
          </p>
          {result.text ? <PrologueUnits rom={result.rom} text={result.text} withBases /> : <p className="bad">Couldn't find the text table in this ROM.</p>}
        </>
      )}
    </>
  );
}

function PrologueUnits({ rom, text, withBases = false }: { rom: GbaRom; text: TextTable; withBases?: boolean }) {
  const table = findCharacterTable(rom);
  const characters = table === null ? [] : readCharacters(rom, text, table);
  const names = new Map(characters.map((c) => [c.id, c.name]));
  const itemName = (id: number) => FE8_ITEM_NAMES.find((i) => i.id === id)?.gameName ?? `item 0x${id.toString(16)}`;
  const units = readPlayerUnits(rom, readChapter(rom, text, 0));
  if (!units.length) return <p className="bad">Couldn't find the Prologue's units.</p>;
  return (
    <ul className="problems">
      {units.map((u, i) => (
        <li key={i}>
          {names.get(u.character) ?? `character 0x${u.character.toString(16)}`} ({CLASS_LIST.find((c) => c.id === u.classId)?.label ?? `class 0x${u.classId.toString(16)}`}), {u.allegiance}, level{' '}
          {u.level} at ({u.x}, {u.y}){u.items.length ? `: ${u.items.map(itemName).join(', ')}` : ''}
          {withBases &&
            (() => {
              const c = characters[u.character - 1];
              return c ? ` · base level ${c.baseLevel}, personal ${STAT_KEYS.map((k) => `${STAT_LABELS[k]} ${c.base[k]}`).join(' ')}` : '';
            })()}
        </li>
      ))}
    </ul>
  );
}
