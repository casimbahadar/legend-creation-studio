// The panel for a placed unit in Edit mode: character, level, stats, Must survive, behaviour, items,
// removing it.

import { useState } from 'react';
import { withBonus } from '../core/combat';
import { BEHAVIOURS, DEFAULT_BEHAVIOUR, MAX_ITEMS, MAX_LEVEL, MAX_STAT, STAT_KEYS, type Behaviour, type ProjectUnit, type StatKey } from '../core/project';
import { classStats, itemStats, usable, type ClassArt, type GameItem } from '../play/catalog';
import { FE8_CHARACTER_NAMES } from '../rom/fe8-character-names';
import { LEVEL_REPEAT_EVERY, NumberInput, useHoldRepeat } from './controls';
import { BEHAVIOUR_LABELS, signed, STAT_LABELS, TEAM_LABELS } from './labels';

/** The panel for a placed unit in Edit mode: its items, and removing it. */
export function UnitPanel({
  unit,
  art,
  items,
  takenCharacters,
  onChange,
  onLevelStep,
  onClose,
}: {
  unit: ProjectUnit;
  art: ClassArt | undefined;
  items: GameItem[];
  /** Characters other player units already are. */
  takenCharacters: ReadonlySet<string>;
  /** A change to the unit, or null to remove it. */
  onChange: (change: Partial<ProjectUnit> | null) => void;
  /** Raise (+1) or lower (-1) the level. */
  onLevelStep: (delta: number) => void;
  onClose: () => void;
}) {
  const repeat = useHoldRepeat(LEVEL_REPEAT_EVERY);
  const carried = unit.items ?? [];
  const byName = new Map(items.map((i) => [i.entry.name, i]));
  const choices = art ? items.filter((i) => usable(art, i)) : [];
  const setItems = (next: string[]) => onChange({ items: next.length ? next : undefined });
  const title = `${unit.name ?? art?.entry.label ?? unit.class} (${TEAM_LABELS[unit.team].toLowerCase()})`;
  const classSt = classStats(art, unit.level);
  const custom = unit.statBonus ?? {};
  const st = withBonus(classSt, custom);
  const isCustom = (k: StatKey) => custom[k] !== undefined;
  // Open to start with if the unit has custom stats; after that it stays as the user leaves it.
  const [showCustom, setShowCustom] = useState(() => Object.keys(unit.statBonus ?? {}).length > 0);
  /** Sets one stat, saved as its difference from the class value; the class value itself clears it. */
  const setStat = (k: StatKey, v: number) => {
    const next = { ...custom };
    const diff = v - classSt[k];
    if (diff === 0) delete next[k];
    else next[k] = diff;
    onChange({ statBonus: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="unit-panel">
      <h3>{title}</h3>
      {unit.team === 'player' && (
        <label className="field">
          Character <span className="note">(name, portrait and personal stats in the patch)</span>
          <select value={unit.character ?? ''} onChange={(e) => onChange({ character: e.target.value || undefined })}>
            <option value="">Picked for you</option>
            {FE8_CHARACTER_NAMES.map((c) => (
              <option key={c.name} value={c.name} disabled={takenCharacters.has(c.name)}>
                {c.gameName}
                {takenCharacters.has(c.name) ? ' (already placed)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="level-row">
        <label htmlFor={`level-${unit.id}`}>Level</label>
        <button type="button" className="icon-button" aria-label="Lower level" disabled={unit.level <= 1} {...repeat(() => onLevelStep(-1))}>
          −
        </button>
        <NumberInput id={`level-${unit.id}`} className="number-input level-input" value={unit.level} min={1} max={MAX_LEVEL} onValue={(level) => onChange({ level })} />
        <button type="button" className="icon-button" aria-label="Raise level" disabled={unit.level >= MAX_LEVEL} {...repeat(() => onLevelStep(1))}>
          +
        </button>
      </div>
      <p className="note">
        {STAT_KEYS.map((k) => `${STAT_LABELS[k]} ${st[k]}${isCustom(k) ? `* (${signed(custom[k]!)})` : ''}`).join(' · ')}
        {art ? ` · Mov ${art.mov}` : ''}
        {Object.keys(custom).length > 0 && <> (* custom)</>}
      </p>
      <details className="custom-stats" open={showCustom} onToggle={(e) => setShowCustom(e.currentTarget.open)}>
        <summary>Custom stats</summary>
        <p className="note">
          Type a number to set a stat for this unit only. It is saved as a change from the class (shown in brackets), so it still grows
          when you raise the level.
        </p>
        <div className="stat-grid">
          {STAT_KEYS.map((k) => (
            <label key={k} className={isCustom(k) ? 'custom' : undefined}>
              <span>{STAT_LABELS[k]}</span>
              <NumberInput value={st[k]} min={k === 'hp' ? 1 : 0} max={MAX_STAT} onValue={(v) => setStat(k, v)} ariaLabel={`${STAT_LABELS[k]}`} />
            </label>
          ))}
        </div>
        <button type="button" className="button button-secondary" disabled={!Object.keys(custom).length} onClick={() => onChange({ statBonus: undefined })}>
          Reset to class stats
        </button>
      </details>
      {unit.team !== 'enemy' && (
        <label className="check-row">
          <input type="checkbox" checked={!!unit.mustSurvive} onChange={(e) => onChange({ mustSurvive: e.target.checked || undefined })} />
          <span>
            Must survive <span className="note">(the chapter is lost if this unit falls)</span>
          </span>
        </label>
      )}
      {unit.team !== 'player' && (
        <label className="field">
          Behaviour
          <select value={unit.ai ?? DEFAULT_BEHAVIOUR} onChange={(e) => onChange({ ai: e.target.value as Behaviour })}>
            {BEHAVIOURS.map((b) => (
              <option key={b} value={b}>
                {BEHAVIOUR_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="note">
        Items ({carried.length} of {MAX_ITEMS})
      </p>
      {carried.length ? (
        <ul className="inventory">
          {carried.map((name, i) => {
            const item = byName.get(name);
            return (
              <li key={i}>
                <span>
                  <strong>{item?.entry.gameName ?? name}</strong>
                  {item && <span className="note"> {itemStats(item.rom)}</span>}
                  {item && art && !usable(art, item) && <span className="bad"> (this class can't use it)</span>}
                </span>
                <button type="button" className="icon-button" aria-label={`Remove ${item?.entry.gameName ?? name}`} onClick={() => setItems(carried.filter((_, j) => j !== i))}>
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="note">No items. Without a weapon this unit can't attack.</p>
      )}
      <label className="field">
        Add an item
        <select
          value=""
          disabled={carried.length >= MAX_ITEMS}
          onChange={(e) => {
            if (e.target.value) setItems([...carried, e.target.value]);
          }}
        >
          <option value="">{carried.length >= MAX_ITEMS ? 'Inventory full' : 'Choose…'}</option>
          {choices.map((i) => (
            <option key={i.entry.name} value={i.entry.name}>
              {i.entry.gameName} ({itemStats(i.rom)})
            </option>
          ))}
        </select>
      </label>
      <div className="stepper">
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
        <button type="button" className="button button-secondary" onClick={() => onChange(null)}>
          Remove unit
        </button>
      </div>
    </div>
  );
}
