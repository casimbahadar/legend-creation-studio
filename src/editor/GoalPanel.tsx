// The chapter's goal in Edit mode (decision 36): Rout, Seize a square, Defeat a boss or Survive a
// number of turns, and what the chosen goal still needs.

import { goalProblem, goalRule, GOAL_LABELS, seizeLord } from '../core/goals';
import { CHAPTER_GOALS, DEFAULT_SURVIVE_TURNS, MAX_SURVIVE_TURNS, type ChapterGoal, type ProjectChapter } from '../core/project';
import { FE8_BOSS_NAMES } from '../rom/fe8-character-names';
import { NumberInput } from './controls';

const LORDS = { eirika: 'Eirika', ephraim: 'Ephraim' } as const;

export function GoalPanel({
  chapter,
  picking,
  onPicking,
  onChange,
}: {
  chapter: ProjectChapter;
  /** Whether the next map tap chooses the square to seize. */
  picking: boolean;
  onPicking: (picking: boolean) => void;
  onChange: (change: Partial<ProjectChapter>) => void;
}) {
  const problem = goalProblem(chapter);
  const rule = goalRule(chapter);
  // The problem already names the lord when the chapter has none, so the note doesn't repeat it.
  const lordNote = rule.kind === 'seize' && (rule.lord || !rule.at);
  const bosses = chapter.units.filter((u) => u.team === 'enemy' && u.character);
  const bossName = (character: string) => FE8_BOSS_NAMES.find((b) => b.name === character)?.label ?? character;
  return (
    <div className="goal-controls">
      <label className="field">
        Goal
        <select
          value={chapter.goal}
          onChange={(e) => {
            onPicking(false);
            onChange({ goal: e.target.value as ChapterGoal });
          }}
        >
          {CHAPTER_GOALS.map((g) => (
            <option key={g} value={g}>
              {GOAL_LABELS[g]}
            </option>
          ))}
        </select>
      </label>
      {chapter.goal === 'seize' && (
        <>
          <p className="note">
            {chapter.seizeAt ? `Square to seize: ${chapter.seizeAt[0]}, ${chapter.seizeAt[1]}.` : 'No square chosen yet.'}
            {lordNote && ` Only ${LORDS[seizeLord(chapter)]} can seize in this chapter's place in the game.`}
          </p>
          <div className="stepper">
            <button type="button" className="button" aria-pressed={picking} onClick={() => onPicking(!picking)}>
              {picking ? 'Cancel' : chapter.seizeAt ? 'Move the square' : 'Choose the square'}
            </button>
          </div>
          {picking && <p className="note">Tap the square on the map.</p>}
        </>
      )}
      {chapter.goal === 'boss' && (
        <label className="field">
          Boss
          <select value={bosses.some((u) => u.id === chapter.boss) ? chapter.boss : ''} onChange={(e) => onChange({ boss: e.target.value || undefined })}>
            <option value="">{bosses.length ? 'Choose…' : 'No enemy plays a boss yet'}</option>
            {bosses.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? bossName(u.character!)} ({u.at[0]}, {u.at[1]})
              </option>
            ))}
          </select>
        </label>
      )}
      {chapter.goal === 'survive' && (
        <label className="field">
          Turns to survive
          <NumberInput value={chapter.surviveTurns ?? DEFAULT_SURVIVE_TURNS} min={1} max={MAX_SURVIVE_TURNS} onValue={(surviveTurns) => onChange({ surviveTurns })} />
        </label>
      )}
      {problem && <p className="bad">{problem}</p>}
    </div>
  );
}
