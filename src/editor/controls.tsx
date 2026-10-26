// Touch controls: buttons that repeat while held (the D-pad, level buttons), the on-screen GBA
// buttons, and a number field.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

export const REPEAT_DELAY = 300;

/** Level buttons repeat a little slower than the D-pad, so a held button is easy to stop on a number. */
export const LEVEL_REPEAT_EVERY = 120;

export const REPEAT_EVERY = 80;

/** On-screen GBA buttons: a D-pad that repeats while held, and A and B. */
/**
 * Pointer handlers for a button that acts once when pressed and then repeats while held, like the
 * GBA's D-pad. preventDefault stops Safari selecting text or opening its menu on a long press.
 */
export function useHoldRepeat(every = REPEAT_EVERY) {
  const timers = useRef<{ delay?: number; repeat?: number }>({});
  const stop = () => {
    clearTimeout(timers.current.delay);
    clearInterval(timers.current.repeat);
    timers.current = {};
  };
  useEffect(() => stop, []);
  return (action: () => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      stop();
      action();
      timers.current.delay = window.setTimeout(() => {
        timers.current.repeat = window.setInterval(action, every);
      }, REPEAT_DELAY);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  });
}

/** A small pill button under the pad, like the GBA's Start and Select. */
export interface ExtraButton {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}

export function GbaControls({
  onDirection,
  onA,
  onB,
  extra = [],
}: {
  onDirection: (dx: number, dy: number) => void;
  onA: () => void;
  onB: () => void;
  extra?: readonly ExtraButton[];
}) {
  const repeat = useHoldRepeat();
  const hold = (dx: number, dy: number) => repeat(() => onDirection(dx, dy));
  const press = (action: () => void) => ({
    onPointerDown: (e: ReactPointerEvent) => {
      e.preventDefault();
      action();
    },
  });

  return (
    <div className="gba-controls">
      <div className="dpad" role="group" aria-label="Direction pad">
        <button type="button" className="dpad-up" aria-label="Up" {...hold(0, -1)}>▲</button>
        <button type="button" className="dpad-left" aria-label="Left" {...hold(-1, 0)}>◀</button>
        <button type="button" className="dpad-right" aria-label="Right" {...hold(1, 0)}>▶</button>
        <button type="button" className="dpad-down" aria-label="Down" {...hold(0, 1)}>▼</button>
      </div>
      <div className="ab">
        <button type="button" className="ab-b" aria-label="B" {...press(onB)}>B</button>
        <button type="button" className="ab-a" aria-label="A" {...press(onA)}>A</button>
      </div>
      {extra.length > 0 && (
        <div className="pills">
          {extra.map((b) => (
            <button key={b.label} type="button" className="pill" disabled={b.disabled} onClick={b.onPress}>
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** A whole number you can type: digits only, applied when it is at least `min` (a number past `max` snaps to it), put back otherwise. */
export function NumberInput({ id, value, min, max, onValue, ariaLabel, className = 'number-input' }: { id?: string; value: number; min: number; max: number; onValue: (v: number) => void; ariaLabel?: string; className?: string }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <input
      id={id}
      className={className}
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      onChange={(e) => {
        const text = e.target.value.replace(/\D/g, '').slice(0, String(max).length);
        const n = Number(text);
        // A number past the maximum snaps to it, so what shows is what's kept.
        setDraft(text && n > max ? String(max) : text);
        if (text && n >= min) onValue(Math.min(n, max));
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}
