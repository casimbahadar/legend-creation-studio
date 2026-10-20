# Standing rules for every session in this repo

- Read DECISIONS.md and ARCHITECTURE.md first. Never contradict a decision; raise it instead.
- Audit before changing: read the relevant files, say what is wrong and what is fine, propose the minimal change, then make it. One concern per commit. Match existing style.
- Never commit a ROM, save file, or anything extracted from a ROM. Tests that need a real ROM read its path from the environment variable `LCS_FE8_ROM` and are skipped when it is unset, so CI never needs one.
- The clean FE8 US ROM is identified by CRC32 `A47246AE`.
- Phone first: every screen must work in iPhone Safari.
- End every session with a report: what changed, what was run and its result, what was not verified. Never claim something works without having run it.

## Commands

- `npm ci` installs dependencies.
- `npx tsc --noEmit` type checks.
- `npx vitest run` runs the tests.
- `npm run build` builds into `dist/`.
