import { useState, type ChangeEvent } from 'react';
import { ChapterEditor } from './ChapterEditor';
import { DeveloperChecks } from './DeveloperChecks';
import { readChosenRom, type ChosenRom } from './project-io';

type RomCheck = { state: 'idle' } | { state: 'checking' } | ChosenRom | { state: 'error' };

export function App() {
  const [check, setCheck] = useState<RomCheck>({ state: 'idle' });

  async function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.target.value = '';
    if (!file) return;

    setCheck({ state: 'checking' });
    try {
      setCheck(readChosenRom(new Uint8Array(await file.arrayBuffer())));
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

      {check.state === 'clean' && check.editor && <ChapterEditor data={check.editor} />}
      {check.state === 'clean' && <DeveloperChecks rom={check.rom} text={check.text} data={check.editor} />}

      <footer className="footer">
        Non-commercial fan tool. Not affiliated with Nintendo or Intelligent Systems.
      </footer>
    </main>
  );
}
