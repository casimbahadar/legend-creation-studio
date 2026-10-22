// Checks for whoever is building the tool rather than making a chapter: reading any text entry from
// the ROM, and whether the hand-written class and item name lists (decision 18) match it. Collapsed
// at the bottom of the page; a mismatch still shows a warning outside it, since the editor relies on
// those lists.

import { useState } from 'react';
import { FE8_ITEM_NAMES } from '../rom/fe8-item-names';
import { FE8_CLASS_NAMES } from '../rom/fe8-names';
import type { GbaRom } from '../rom/gba-rom';
import { decodeText, type TextTable } from '../rom/text';
import type { EditorRom } from './project-io';

export function DeveloperChecks({ rom, text, data }: { rom: GbaRom; text: TextTable | null; data: EditorRom | null }) {
  const [textId, setTextId] = useState('');
  const mismatched = data ? data.mismatches.length + data.itemMismatches.length : 0;
  return (
    <section className="panel">
      {mismatched > 0 && (
        <p className="bad">Some class or item names don't match your ROM, so parts of the editor may not work. See Developer checks below.</p>
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
          </>
        )}
      </details>
    </section>
  );
}
