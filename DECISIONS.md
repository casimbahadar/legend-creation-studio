# Decisions

Settled decisions for Legend Creation Studio. Do not contradict these; raise a change instead.

1. Outputs: standalone fangames and GBA ROM hacks from the first version; other consoles later. Both audiences are served from day one, and GBA is where the community is.
2. Website first; the same code wrapped as a desktop download later. Nothing to install lowers the barrier for beginners.
3. Complete beginners first; advanced options one step away. Beginners are the audience nobody else serves, and experts lose nothing if advanced options stay close.
4. GBA target: FE8 (Sacred Stones, US) first. It is the most documented and most hacked GBA Fire Emblem.
5. Endless Chronicle's proven parts (ROM reader, text decoder, music player, GBA drawing helpers) are ported in; game rules are rebuilt as editable data starting from vanilla FE8. Reuse what already works, and make rules something users can change.
6. Stack: TypeScript, React, Vite, Vitest; Claude Code commits, GitHub Actions publishes. A common, well-supported web stack with publishing that needs no manual steps.
7. Scripting: three layers over one event language: point-and-click, editable text, full code. Each user picks their level and all three stay in sync.
8. Custom code: JavaScript at launch, designed so Python can be added later. JavaScript runs in the browser natively; Python is wanted but costs more to run there.
9. Shared projects never contain ROM-extracted assets; players load their own ROM; GBA hacks are shared as patches. This keeps the tool and its users clear of distributing copyrighted material.
10. Game export: web game first; Windows, Mac, Linux builds as soon as possible after. The web build comes free with a website-first tool.
11. Sharing: plain files at launch; in-tool gallery is the first feature after 1.0. Files need no server; a gallery does.
12. GBA testing: build the real patched ROM and run it in a built-in emulator, with jump-to-chapter, a debug panel and a pre-play checker. Testing the real output catches what a simulation would miss.
13. Import at launch: FE Repository assets, Tiled maps, MIDI, existing FE8 ROMs; Lex Talionis projects as soon as possible after. Users can bring the work and assets they already have.
14. Name: Legend Creation Studio; Fire Emblem named only in the description. Keeps the trademark out of the product name.
15. First release 0.1 "Your First Chapter": one chapter on a Sacred Stones map, played in the tool, exported as an FE8 UPS patch and a web game. The smallest release that proves the whole pipeline end to end.
16. Licence GPL-3.0; repo public from the start. Keeps the tool and its derivatives open.
17. Project file: one plain JSON file that names things like "iron-sword" instead of slot numbers, points to maps and art in the player's ROM, and will store rule changes as differences from vanilla FE8. Keeps projects readable, shareable and free of ROM data (decisions 9 and 11).
18. Names come from a hand-written list in the repo that maps each name to its FE8 id; stats and in-game names are always read from the player's ROM. Names stay stable and readable, and the repo holds no ROM data.
19. Maps are named by chapter-table entry ("fe8-us/chapter-entry-5") for now; friendly names come once chapter names are read from the ROM, and the old form stays accepted. Works today without new reverse engineering.
20. Unit stats come from the class's base stats in the ROM, raised by its growth rates for each level above 1 using average (not random) growth, so a placed unit is the same every time; per-unit stat edits can come later. Gives level a meaning without new editing screens.
21. Test play rolls hits the way FE8 does: two random numbers averaged for hit ("true hit"), one for crit. Playtesting should feel like the real ROM.
22. Battles are shown on the map first, in FE's "animations off" style: a forecast, then units lunge with damage numbers and HP bars. ROM battle animations can come after 0.1.
23. Enemy and ally behaviour is set per unit, as in FE's own chapters: Charge (head for the other side every turn), Attack in range (act only when a target is within reach; the default) or Hold (never move, attack anything in reach). Lets one chapter mix rushers, ambushers and guards.
24. Turn order is FE's: player, then enemies, then allies (green units), which use the same behaviours against enemies.
25. Custom stats are set per unit first: a unit can override any of HP, Str, Skl, Spd, Lck, Def, Res and Con with its own number, saved only for the stats changed and kept as typed when its level changes; class-wide stat editing comes later. Covers bosses and named characters with the least to build.
