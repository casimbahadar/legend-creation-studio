# Architecture

## Folders

| Folder | Holds |
| --- | --- |
| `src/core` | Project format, rules engine, event language, checker. No DOM or React here. |
| `src/rom` | Reading and writing FE8 ROMs, UPS patches. |
| `src/play` | The game renderer (canvas), and what play needs from the ROM: the class and item catalog and the rules for a chapter's map. |
| `src/editor` | The React app: the editor, test play's screens and controls, project files. |
| `src/export` | Web game export: Play links that carry a chapter, and the Play page they open (decision 33; desktop builds later). |

## Data flow

```
                     editor (src/editor)
                             |
                             v
                  project file (one per project)
                             |
          +------------------+------------------+
          |                  |                  |
     rules engine      event language        checker
          |                  |                  |
          +------------------+------------------+
                             |
        +---------------+----+----------+---------------+
        |               |               |               |
    play mode      FE8 builder       emulator       web export
   (src/play)      (src/rom)                       (src/export)
                        |
          clean FE8 ROM -> patched ROM -> UPS patch
```

- The editor writes one project file. It is the single source of truth.
- The project file uses names such as `"iron-sword"` instead of slot numbers.
- The project file points to ROM assets but never contains them.
- The rules engine, event language and checker (all in `src/core`) read the project file.
- Play mode, the FE8 builder, the emulator and the web export are all built from the project file.
- The FE8 builder always starts from a clean FE8 (US) ROM, applies the project, and produces a UPS patch.
- Everything runs on the user's device. Nothing is uploaded.
