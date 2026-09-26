# @synaptix/command-system

Every change to a `MusicProject` goes through a command. Commands are pure: `execute(project)` and `undo(project)` return a new project and never mutate their input, which is what makes undo/redo, revisions and cloud sync reliable.

## Two command families

| Family                                                            | Interface                                   | Used by                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Editor commands** (`./editor`, `./midi`, `./device`, `./track`) | `EditorCommand { id, kind, execute, undo }` | The browser studio, through `EditorCommandHistory`                                                                   |
| **Studio commands** (`.`)                                         | `StudioCommand` plus `serialize()`          | Transactions and serialized histories (`CommandTransaction`, `CommandHistory`), e.g. applying generated arrangements |

New studio features should add **editor commands**.

## Entry points

| Import                            | Contents                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@synaptix/command-system/editor` | `EditorCommandHistory`, plus track mute/solo/volume/pan/output/send, mixer channel, loop and tempo commands |
| `@synaptix/command-system/midi`   | Note add/remove/move/resize/velocity/transpose/quantize/duplicate, drum step toggle/clear, clip loop        |
| `@synaptix/command-system/device` | Device enable and parameter commands                                                                        |
| `@synaptix/command-system/track`  | `AddTrackEditorCommand`, `RemoveTrackEditorCommand`, `AddClipEditorCommand`                                 |
| `@synaptix/command-system`        | `StudioCommand`s, `CommandTransaction`, `CommandHistory`, `ProjectRevision`, `canonicalizeProject`          |

## Using the history

```ts
const history = new EditorCommandHistory({ maxDepth: 100 });
const { project: next, revision } = await history.execute(
  project,
  new SetTempoEditorCommand(120, 128)
);
// Persist `next` + `revision`; later:
const undone = await history.undo(next); // null when nothing to undo
```

- `execute`, `undo` and `redo` each produce a new `ProjectRevision` (a SHA-256 checksum of the canonical project) that storage and sync use.
- The history refuses overlapping operations (`isBusy`) and is bound to one project. Call `clear()` or `reset(project)` whenever a different project or a cloud revision is loaded.

## Writing a command

1. Clone the input (`structuredClone`) and change only the clone.
2. Validate inputs and throw on impossible states, e.g. a missing track or a duplicate ID. The history never commits a command that throws.
3. Make `undo` restore exactly what `execute` changed, and store what you need during `execute` when the previous value is unknown upfront.
4. Add tests for execute, undo, input immutability and the failure cases (`src/*.test.ts`, run with `npm test`).
