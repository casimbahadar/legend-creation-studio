// A chapter's goal (decision 36): what wins it in test play and in the patched game. Rout wins when no
// enemy is left; Seize when the lord takes Seize on the chosen square; Defeat boss when the chosen boss
// falls; Survive at the start of the turn after the chosen number of turns. A lost chapter is lost the
// same way for every goal (decision 26).

import { DEFAULT_SURVIVE_TURNS, mapEntry, mapRef, MAX_SURVIVE_TURNS, type ChapterGoal, type ProjectChapter } from './project';

export const GOAL_LABELS: Record<ChapterGoal, string> = {
  rout: 'Rout: defeat every enemy',
  seize: 'Seize: the lord takes a square',
  boss: 'Defeat boss',
  survive: 'Survive a number of turns',
};

/** What wins a chapter in play. */
export type GoalRule =
  | { readonly kind: 'rout' }
  /** `lord`: the unit that can seize, or null if the chapter has none. */
  | { readonly kind: 'seize'; readonly at: readonly [number, number] | null; readonly lord: string | null }
  | { readonly kind: 'boss'; readonly unit: string | null }
  | { readonly kind: 'survive'; readonly turns: number };

/**
 * The FE8 character who can seize in a chapter's place in the game (CanUnitSeize): Ephraim in his
 * chapters (chapter index 5, and 23 to 35 on his route), Eirika everywhere else.
 */
export function seizeLord(chapter: ProjectChapter): 'eirika' | 'ephraim' {
  const slot = mapEntry(chapter.replaces ?? mapRef(0)) ?? 0;
  return slot === 5 || (slot >= 23 && slot <= 35) ? 'ephraim' : 'eirika';
}

export function goalRule(chapter: ProjectChapter): GoalRule {
  switch (chapter.goal) {
    case 'seize': {
      const lord = seizeLord(chapter);
      return { kind: 'seize', at: chapter.seizeAt ?? null, lord: chapter.units.find((u) => u.team === 'player' && u.character === lord)?.id ?? null };
    }
    case 'boss':
      return { kind: 'boss', unit: chapter.units.some((u) => u.id === chapter.boss && u.team === 'enemy' && u.character) ? (chapter.boss ?? null) : null };
    case 'survive':
      return { kind: 'survive', turns: chapter.surviveTurns ?? DEFAULT_SURVIVE_TURNS };
    default:
      return { kind: 'rout' };
  }
}

const LORD_NAMES = { eirika: 'Eirika', ephraim: 'Ephraim' } as const;

/** What the chapter still needs before its goal can be played or patched, in plain words; null if nothing. */
export function goalProblem(chapter: ProjectChapter): string | null {
  const rule = goalRule(chapter);
  switch (rule.kind) {
    case 'seize': {
      if (!rule.at) return 'Choose the square to seize.';
      const lord = LORD_NAMES[seizeLord(chapter)];
      if (!rule.lord) return `Only ${lord} can seize in this chapter's place in the game, so the chapter needs a player unit playing ${lord}.`;
      return null;
    }
    case 'boss':
      return rule.unit ? null : 'Choose the boss to defeat: an enemy playing one of FE8\'s bosses.';
    case 'survive':
      return Number.isInteger(rule.turns) && rule.turns >= 1 && rule.turns <= MAX_SURVIVE_TURNS ? null : `Survive needs a number of turns from 1 to ${MAX_SURVIVE_TURNS}.`;
    default:
      return null;
  }
}

/** FE8's gate terrains (TERRAIN_GATE_CASTLE, TERRAIN_GATE_REGULAR): seizing one reads "Seize gate". */
const GATE_TERRAINS: ReadonlySet<number> = new Set([0x0b, 0x23]);

/**
 * The goal window's first line, one of FE8's own goal window texts: "Defeat enemy" (MSG_19E), "Seize
 * gate" (MSG_19F) on a gate and "Seize throne" (MSG_1A1) anywhere else, "Defeat boss" (MSG_19D) or
 * "Survive" (MSG_19C). `terrainAt` gives a square's terrain id.
 */
export function goalWindowText(rule: GoalRule, terrainAt: (x: number, y: number) => number): string {
  switch (rule.kind) {
    case 'seize':
      return rule.at && GATE_TERRAINS.has(terrainAt(rule.at[0], rule.at[1])) ? 'Seize gate' : 'Seize throne';
    case 'boss':
      return 'Defeat boss';
    case 'survive':
      return 'Survive';
    default:
      return 'Defeat enemy';
  }
}
