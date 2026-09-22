# Studio UI controls

These application components consume the semantic `--sx-*` tokens from `app/globals.css`.
They contain presentation and interaction behavior; project mutations belong in editor commands.

| Component | Use |
| --- | --- |
| `Button` | Native button props, `default`/`primary`/`quiet` variants, focus and disabled states; defaults to `type="button"`. |
| `Panel` | Bordered section with shared surface and radius tokens. Supply an accessible label or heading association. |
| `Toolbar` | Wrapping editor header for labeled controls. Retains normal Tab navigation. |
| `Badge` | Compact metadata/status text; live announcements remain the caller's responsibility. |
| `ViewTabs` | Linked tab/panel IDs, selected state, disabled tabs, and Arrow/Home/End keyboard selection. Render matching `tabpanel` elements. |
| `DisclosureMenu` | Expandable group for settings controls; outside click, focus departure, and Escape dismiss it. Escape restores trigger focus. |
| `CommitSlider` | Local fader draft with one async commit per pointer or keyboard gesture, cancellation, pending state, and error display. |
| `MeterBar` | Bounded dBFS meter with accessible numeric and silence/clipping text. |
| `ResizeHandle` | Bounded pointer and keyboard separator. Arrow keys change 16px (Shift: 32px); Home/End select limits. Pointer cancellation restores the starting size. |

`CommitSlider` does not mutate or audition the project during a drag. Pass a command-backed
`onCommit` callback to persist the released value. Domain-specific canvases, clip geometry,
and audio subscriptions remain outside this folder.

Studio layout preferences are separate from project data, versioned under
`synaptix-music:studio-layout:v1`. The layout hook validates stored values, constrains the
mixer to the current viewport, and preserves desktop dimensions when panels automatically
hide on smaller screens. Layout reset also closes the mixer using its existing visibility
preference.
