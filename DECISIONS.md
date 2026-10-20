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
