// The project file: the single source of truth that every part of the tool is built from.
// Plain JSON. Things are named ("lord-eirika", "iron-sword"), never numbered, and maps point
// into the player's ROM instead of containing anything from it (DECISIONS.md 9, 11, 17 to 19).

export const PROJECT_FORMAT = 'legend-creation-studio/project';
export const PROJECT_VERSION = 0;

export type Team = 'player' | 'enemy' | 'ally';
export const TEAMS: readonly Team[] = ['player', 'enemy', 'ally'];

export type ChapterGoal = 'rout';

export interface ProjectUnit {
  /** Unique within its chapter, e.g. "eirika" or "brigand-2". */
  id: string;
  /** Shown in game; class name is used when missing. */
  name?: string;
  /** A class name from the name list, e.g. "lord-eirika". */
  class: string;
  team: Team;
  level: number;
  /** Map cell [x, y], counted from the top-left. */
  at: [number, number];
  /** Item names from the name list, e.g. "iron-sword". */
  items?: string[];
}

export interface ProjectChapter {
  id: string;
  name: string;
  /** "fe8-us/chapter-entry-N": the map used by entry N of the player's ROM chapter table. */
  map: string;
  goal: ChapterGoal;
  units: ProjectUnit[];
}

export interface Project {
  format: typeof PROJECT_FORMAT;
  version: typeof PROJECT_VERSION;
  name: string;
  base: { game: 'fe8-us'; crc32: 'A47246AE' };
  chapters: ProjectChapter[];
}

export interface Problem {
  /** Where the problem is, e.g. "chapters[0].units[2].class". */
  path: string;
  message: string;
}

/** What the checker can confirm beyond the file itself. Leave a part out to skip that check. */
export interface Catalog {
  classes?: ReadonlySet<string>;
  items?: ReadonlySet<string>;
}

const NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAP_REF = /^fe8-us\/chapter-entry-(\d+)$/;
const MAX_LEVEL = 20;
/** A unit's inventory size in FE. */
export const MAX_ITEMS = 5;

export function mapRef(chapterEntry: number): string {
  return `fe8-us/chapter-entry-${chapterEntry}`;
}

/** The chapter-table entry a map reference points to, or null if it isn't one. */
export function mapEntry(ref: string): number | null {
  const m = MAP_REF.exec(ref);
  return m ? Number(m[1]) : null;
}

/** Turns any text into a name usable as an id: "My First Chapter!" becomes "my-first-chapter". */
export function toName(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

export function newProject(name: string, map: string): Project {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name,
    base: { game: 'fe8-us', crc32: 'A47246AE' },
    chapters: [{ id: 'chapter-1', name: 'Chapter 1', map, goal: 'rout', units: [] }],
  };
}

export function projectToJson(project: Project): string {
  return JSON.stringify(project, null, 2) + '\n';
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * Checks a parsed project file. Returns the project only when there are no problems.
 * Messages are written for beginners, since they are shown as they are.
 */
export function checkProject(data: unknown, catalog: Catalog = {}): { project: Project | null; problems: Problem[] } {
  const problems: Problem[] = [];
  const problem = (path: string, message: string) => problems.push({ path, message });

  if (!isObject(data)) {
    problem('', "This isn't a Legend Creation Studio project file.");
    return { project: null, problems };
  }
  if (data.format !== PROJECT_FORMAT) {
    problem('format', "This isn't a Legend Creation Studio project file.");
    return { project: null, problems };
  }
  if (data.version !== PROJECT_VERSION) {
    problem('version', `This project was made with a different version of the tool (format version ${String(data.version)}).`);
    return { project: null, problems };
  }
  if (typeof data.name !== 'string' || !data.name.trim()) problem('name', 'The project needs a name.');
  if (!isObject(data.base) || data.base.game !== 'fe8-us' || data.base.crc32 !== 'A47246AE') {
    problem('base', 'The project must be based on a clean Sacred Stones (US) ROM.');
  }
  if (!Array.isArray(data.chapters) || data.chapters.length === 0) {
    problem('chapters', 'The project needs at least one chapter.');
  } else {
    const chapterIds = new Set<string>();
    data.chapters.forEach((c: unknown, ci) => {
      const at = `chapters[${ci}]`;
      if (!isObject(c)) return problem(at, 'This chapter is not readable.');
      if (typeof c.id !== 'string' || !NAME.test(c.id)) problem(`${at}.id`, 'A chapter id must use only lowercase letters, numbers and dashes.');
      else if (chapterIds.has(c.id)) problem(`${at}.id`, `Two chapters are both called "${c.id}".`);
      else chapterIds.add(c.id);
      if (typeof c.name !== 'string' || !c.name.trim()) problem(`${at}.name`, 'The chapter needs a name.');
      if (typeof c.map !== 'string' || mapEntry(c.map) === null) problem(`${at}.map`, 'The chapter needs a map.');
      if (c.goal !== 'rout') problem(`${at}.goal`, 'The chapter goal must be "rout" (defeat every enemy).');
      if (!Array.isArray(c.units)) return problem(`${at}.units`, 'The chapter needs a list of units, even an empty one.');

      const unitIds = new Set<string>();
      const cells = new Set<string>();
      c.units.forEach((u: unknown, ui) => {
        const up = `${at}.units[${ui}]`;
        if (!isObject(u)) return problem(up, 'This unit is not readable.');
        const who = typeof u.id === 'string' ? `"${u.id}"` : 'A unit';
        if (typeof u.id !== 'string' || !NAME.test(u.id)) problem(`${up}.id`, 'A unit id must use only lowercase letters, numbers and dashes.');
        else if (unitIds.has(u.id)) problem(`${up}.id`, `Two units are both called "${u.id}".`);
        else unitIds.add(u.id);
        if (u.name !== undefined && (typeof u.name !== 'string' || !u.name.trim())) problem(`${up}.name`, `${who} has an empty name.`);
        if (typeof u.class !== 'string' || !NAME.test(u.class)) problem(`${up}.class`, `${who} needs a class.`);
        else if (catalog.classes && !catalog.classes.has(u.class)) problem(`${up}.class`, `${who} has a class this tool doesn't know: "${u.class}".`);
        if (typeof u.team !== 'string' || !TEAMS.includes(u.team as Team)) problem(`${up}.team`, `${who} must be on the player, enemy or ally team.`);
        if (!isInt(u.level) || u.level < 1 || u.level > MAX_LEVEL) problem(`${up}.level`, `${who} needs a level from 1 to ${MAX_LEVEL}.`);
        if (!Array.isArray(u.at) || u.at.length !== 2 || !u.at.every((v) => isInt(v) && v >= 0)) {
          problem(`${up}.at`, `${who} needs a place on the map.`);
        } else {
          const key = u.at.join(',');
          if (cells.has(key)) problem(`${up}.at`, `${who} is standing on the same square as another unit.`);
          cells.add(key);
        }
        if (u.items !== undefined) {
          if (!Array.isArray(u.items)) problem(`${up}.items`, `${who} has an unreadable item list.`);
          else if (u.items.length > MAX_ITEMS) problem(`${up}.items`, `${who} carries ${u.items.length} items; a unit can carry at most ${MAX_ITEMS}.`);
          else
            u.items.forEach((item: unknown, ii) => {
              if (typeof item !== 'string' || !NAME.test(item)) problem(`${up}.items[${ii}]`, `${who} has an unreadable item.`);
              else if (catalog.items && !catalog.items.has(item)) problem(`${up}.items[${ii}]`, `${who} has an item this tool doesn't know: "${item}".`);
            });
        }
      });
    });
  }
  return { project: problems.length ? null : (data as unknown as Project), problems };
}
