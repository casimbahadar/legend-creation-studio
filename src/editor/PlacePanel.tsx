// The panel for a door, chest, village or house in Edit mode (decision 38): what a chest holds, what a
// village or house says and gives, or FE8's own with what it does and one choice to replace it.

import { MAX_GOLD, type PlaceKind, type ProjectPlace } from '../core/project';
import type { GameItem } from '../play/catalog';
import type { TileEvent } from '../rom/fe8-tile-events';
import { nameProblem, type HuffmanCodes } from '../rom/text-encode';
import { NumberInput } from './controls';

export const PLACE_LABELS: Record<PlaceKind, string> = { door: 'Door', chest: 'Chest', village: 'Village', house: 'House' };
/** Longest text a village or house takes here; FE8's own run to a few lines. */
const MAX_TEXT = 200;
/** What a new chest, village or house gives until it's changed. */
export const STARTING_ITEM = 'vulnerary';
const STARTING_GOLD = 500;

type Gives = 'nothing' | 'item' | 'gold';

/** A place as first put on a square of the kind it can hold. */
export function newPlace(kind: PlaceKind, at: [number, number]): ProjectPlace {
  return kind === 'door' ? { kind, at } : { kind, at, item: STARTING_ITEM };
}

export function PlacePanel({
  place,
  fe8,
  items,
  textCodes,
  fe8Text,
  onChange,
  onClose,
}: {
  place: ProjectPlace;
  /** FE8's own event at this square, to say what FE8's own does. */
  fe8: TileEvent | undefined;
  items: GameItem[];
  /** The ROM's text codes, to check text can be written into the game. */
  textCodes: HuffmanCodes;
  /** One of the ROM's messages as plain text. */
  fe8Text: (id: number) => string;
  /** The place changed, or null to remove it. */
  onChange: (place: ProjectPlace | null) => void;
  onClose: () => void;
}) {
  const byName = new Map(items.map((i) => [i.entry.name, i]));
  const itemLabel = (name: string) => byName.get(name)?.entry.gameName ?? name;
  const romItemLabel = (id: number) => items.find((i) => i.rom.id === id)?.entry.gameName ?? `item ${id}`;
  const title = `${PLACE_LABELS[place.kind]} (${place.at[0]}, ${place.at[1]})`;
  const { kind, at } = place;
  const gives: Gives = place.gold !== undefined ? 'gold' : place.item !== undefined ? 'item' : 'nothing';
  const setGives = (g: Gives) =>
    onChange({ kind, at, ...(place.text !== undefined ? { text: place.text } : {}), ...(g === 'item' ? { item: place.item ?? STARTING_ITEM } : g === 'gold' ? { gold: place.gold ?? STARTING_GOLD } : {}) });
  const textProblem = place.text?.trim() ? nameProblem(textCodes, place.text) : null;

  return (
    <div className="unit-panel place-panel">
      <h3>{title}</h3>
      {kind === 'door' && <p className="note">Units open it as they do in FE8. It holds nothing.</p>}
      {kind !== 'door' && place.fe8 && (
        <>
          <p className="note">
            <strong>FE8&apos;s own {kind === 'chest' ? 'chest' : 'scene'}.</strong> {fe8Summary(fe8, fe8Text, romItemLabel)}
          </p>
          <div className="stepper">
            <button type="button" className="button" onClick={() => onChange(newPlace(kind, at))}>
              Replace with your own
            </button>
          </div>
        </>
      )}
      {kind !== 'door' && !place.fe8 && (
        <>
          {kind !== 'chest' && (
            <label className="field field-wide">
              What&apos;s said here <span className="note">(optional)</span>
              <textarea
                rows={3}
                maxLength={MAX_TEXT}
                value={place.text ?? ''}
                placeholder="Welcome, traveller! Take this."
                onChange={(e) => {
                  const { text: _old, ...rest } = place;
                  onChange(e.target.value.trim() ? { ...rest, text: e.target.value } : rest);
                }}
              />
            </label>
          )}
          {textProblem && <p className="bad">{textProblem}</p>}
          <div className="segmented" role="group" aria-label={kind === 'chest' ? 'Holds' : 'Gives'}>
            {(kind === 'chest' ? (['item', 'gold'] as const) : (['nothing', 'item', 'gold'] as const)).map((g) => (
              <button key={g} type="button" aria-pressed={gives === g} onClick={() => setGives(g)}>
                {g === 'nothing' ? 'Nothing' : g === 'item' ? 'An item' : 'Gold'}
              </button>
            ))}
          </div>
          {gives === 'item' && (
            <label className="field">
              Item
              <select value={place.item} onChange={(e) => onChange({ ...place, item: e.target.value })}>
                {items.map((i) => (
                  <option key={i.entry.name} value={i.entry.name}>
                    {i.entry.gameName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {gives === 'gold' && (
            <label className="field">
              Gold
              <NumberInput value={place.gold ?? STARTING_GOLD} min={1} max={MAX_GOLD} onValue={(gold) => onChange({ ...place, gold })} />
            </label>
          )}
          <p className="note">
            {kind === 'chest' ? 'Units open it as they do in FE8' : 'A player unit can visit it once'}
            {gives === 'item' && place.item ? ` for ${itemLabel(place.item)}.` : gives === 'gold' ? ` for ${place.gold} gold.` : '.'}
          </p>
        </>
      )}
      <div className="stepper">
        <button type="button" className="button" onClick={onClose}>
          Done
        </button>
        <button type="button" className="button button-secondary" onClick={() => onChange(null)}>
          Remove {PLACE_LABELS[kind].toLowerCase()}
        </button>
      </div>
    </div>
  );
}

/** What FE8's own does here, in a sentence or two. */
function fe8Summary(e: TileEvent | undefined, text: (id: number) => string, item: (id: number) => string): string {
  if (!e) return 'As FE8 has it on this map.';
  if (e.kind === 'randomChest') return `It holds one of ${e.items.map((i) => item(i.item)).join(', ')}, by chance.`;
  if (e.kind === 'chest') return e.gold !== null ? `It holds ${e.gold} gold.` : `It holds ${item(e.item)}.`;
  if (e.kind === 'door') return '';
  const s = e.scene;
  if (!s) return 'As FE8 has it on this map.';
  const said = s.texts.map(text).filter(Boolean);
  const parts = [said.length ? `Says: “${said.join(' … ')}”.` : '', s.item !== null ? `Gives ${item(s.item)}.` : s.gold !== null ? `Gives ${s.gold} gold.` : ''];
  if (s.custom) parts.push('It also does more than talk and give (such as checking who visits, or a unit joining), which stays as FE8 has it.');
  return parts.filter(Boolean).join(' ');
}
