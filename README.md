# Legend Creation Studio

A tactics RPG maker for Fire Emblem fans, with Sacred Stones ROM hacking.

Legend Creation Studio is a web-first, all-in-one tool for making tactics RPGs and Fire Emblem ROM hacks. One project becomes either a standalone web game or a patch for Fire Emblem: The Sacred Stones (FE8, US). It is built for complete beginners first, with advanced options one step away.

This is a non-commercial fan tool. It is not affiliated with Nintendo or Intelligent Systems.

## Status

Pre-0.1. The repository holds the project setup and a first page that checks whether a ROM is a clean Sacred Stones (US) ROM. Nothing else works yet. The first release, 0.1 "Your First Chapter", is described in [DECISIONS.md](DECISIONS.md).

## ROM policy

- Players supply their own ROM. This project does not provide one and never will.
- Your ROM is read in your browser, on your device. It is never uploaded.
- Nothing from any ROM is ever committed to this repository or published: no ROM files, no save files, no graphics, music, text or data extracted from one.
- GBA hacks made with the tool are shared as patches, which only work with a ROM the player already has.

## Development

Requires Node.js 22.12 or newer (CI uses the version in `.nvmrc`).

```sh
npm ci
npm run dev        # local dev server
npx tsc --noEmit   # type check
npx vitest run     # tests
npm run build      # production build into dist/
```

Read [DECISIONS.md](DECISIONS.md) and [ARCHITECTURE.md](ARCHITECTURE.md) before contributing.

## Licence

GPL-3.0. See [LICENSE](LICENSE).

## Credits
