import { useState, type ChangeEvent } from 'react';
import { crc32, formatCrc32 } from '../rom/crc32';
import { FE8_US_CRC32 } from '../rom/fe8';
import { readAllChapterMaps } from '../rom/fe8-maps';
import { readRom, type GbaRom } from '../rom/gba-rom';
import { decodeText, findTextTable, type TextTable } from '../rom/text';
import { ChapterEditor } from './ChapterEditor';
import { readEditorRom, type EditorRom } from './project-io';

type RomCheck =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'clean'; rom: GbaRom; text: TextTable | null; editor: EditorRom | null }
  | { state: 'other'; crc: string }
  | { state: 'error' };

export function App() {
  const [check, setCheck] = useState<RomCheck>({ state: 'idle' });
  const [textId, setTextId] = useState('');

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = '';
    if (!file) return;

    setCheck({ state: 'checking' });
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const crc = crc32(bytes);
      if (crc === FE8_US_CRC32) {
        const rom = readRom(bytes);
        const text = findTextTable(rom);
        setCheck({ state: 'clean', rom, text, editor: text ? readEditorRom(rom, text, readAllChapterMaps(rom)) : null });
      } else {
        setCheck({ state: 'other', crc: formatCrc32(crc) });
      }
    } catch {
      setCheck({ state: 'error' });
    }
  }

  return (
    <main className="page">
      <h1>Legend Creation Studio</h1>
      <p className="tagline">A tactics RPG maker for Fire Emblem fans, with Sacred Stones ROM hacking.</p>

      <label className="button">
        Choose your FE8 (US) ROM
        <input type="file" className="visually-hidden" onChange={onFileChosen} />
      </label>
      <p className="note">Your ROM is read on this device. It is not uploaded or stored.</p>

      <p className="result" role="status" aria-live="polite">
        {check.state === 'checking' && 'Checking…'}
        {check.state === 'clean' && <span className="good">Clean Sacred Stones (US) ROM found</span>}
        {check.state === 'other' && (
          <span className="bad">This isn't a clean Sacred Stones (US) ROM (CRC32 {check.crc})</span>
        )}
        {check.state === 'error' && <span className="bad">Couldn't read that file. Try choosing it again.</span>}
      </p>

      {check.state === 'clean' && (
        <section className="panel">
          <h2>ROM text check</h2>
          {check.text ? (
            <>
              <p>Read {check.text.count.toLocaleString()} text entries from your ROM.</p>
              <label className="field">
                Text number (0 to {check.text.count - 1})
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={textId}
                  onChange={(e) => setTextId(e.target.value.replace(/\D/g, ''))}
                />
              </label>
              {textId !== '' && (
                <pre className="text-out">{decodeText(check.rom, check.text, Number(textId)) || '(empty)'}</pre>
              )}
            </>
          ) : (
            <p className="bad">Couldn't find the text table in this ROM.</p>
          )}
        </section>
      )}

      {check.state === 'clean' && check.editor && <ChapterEditor data={check.editor} />}

      <footer className="footer">
        Non-commercial fan tool. Not affiliated with Nintendo or Intelligent Systems.
      </footer>
    </main>
  );
}
