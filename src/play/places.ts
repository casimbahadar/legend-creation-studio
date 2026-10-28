// Doors, chests, villages and houses on a chapter's map (decision 38): which squares can hold one,
// and the ones FE8's own chapter on the map has, as a chapter starts with them.

import type { PlaceKind, ProjectChapter, ProjectPlace } from '../core/project';
import { mapChangeAt, type MapChange, type TileEvent } from '../rom/fe8-tile-events';

/** What FE8's chapter on a map has: its map changes and its doors, chests, villages and houses. */
export interface Fe8Places {
  readonly changes: readonly MapChange[];
  readonly events: readonly TileEvent[];
}

/** FE8's terrain ids for squares that can hold one (include/constants/terrains.h). */
const TERRAIN = { village: 0x03, house: 0x05, door: 0x1e, chest: 0x21 } as const;

/**
 * What a square can hold, from its terrain: a door, a full chest or a village only where the map has a
 * tile change for it to open or close (decision 38); a house anywhere on a house.
 */
export function placeKindAt(map: { readonly width: number; readonly terrain: Uint8Array }, changes: readonly MapChange[], x: number, y: number): PlaceKind | null {
  const t = map.terrain[y * map.width + x];
  if (t === TERRAIN.house) return 'house';
  const kind = t === TERRAIN.door ? 'door' : t === TERRAIN.chest ? 'chest' : t === TERRAIN.village ? 'village' : null;
  return kind && mapChangeAt(changes, x, y) !== null ? kind : null;
}

/**
 * FE8's own as a chapter starts with them: doors as they are, chests with their item (by name) or gold,
 * and villages, houses and random chests playing FE8's own (`fe8`). `itemName` names an item id.
 */
export function fe8Places(fe8: Fe8Places, itemName: (id: number) => string | undefined): ProjectPlace[] {
  return fe8.events.map((e): ProjectPlace => {
    const at: [number, number] = [e.x, e.y];
    if (e.kind === 'door') return { kind: 'door', at };
    if (e.kind === 'chest') {
      if (e.gold !== null && e.gold > 0) return { kind: 'chest', at, gold: e.gold };
      const item = itemName(e.item);
      return item ? { kind: 'chest', at, item } : { kind: 'chest', at, fe8: true };
    }
    if (e.kind === 'randomChest') return { kind: 'chest', at, fe8: true };
    return { kind: e.kind, at, fe8: true };
  });
}

/** A chapter's doors, chests, villages and houses: its own list, or the map's own from FE8. */
export function chapterPlaces(chapter: Pick<ProjectChapter, 'places'>, fe8: readonly ProjectPlace[]): readonly ProjectPlace[] {
  return chapter.places ?? fe8;
}
