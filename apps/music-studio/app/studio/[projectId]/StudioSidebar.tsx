"use client";

import { forwardRef } from "react";
import { instrumentDefinition } from "@synaptix/daw-engine";
import type { MusicProject } from "@synaptix/project-model";

import { Button, DisclosureMenu } from "../../../components/ui/StudioControls";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import type { useStudioLayout } from "../../../lib/editor/use-studio-layout";
import { editorKindForTrack, findEditorClip, type EditorKind } from "../../../lib/editor/editor-clip-target";
import { InstrumentPicker } from "./InstrumentPicker";

export type Workspace = "arrangement" | "generation" | "adaptive" | "render" | "devices";
export type ActiveClip = { trackId: string; clipId: string };
type PanelLayout = ReturnType<typeof useStudioLayout>;

/** Panel toggles, reset, and the DAW layout preview switch; shared by both shells. */
export function LayoutMenu({ panelLayout, onReset }: { panelLayout: PanelLayout; onReset: () => void }) {
  const v2 = panelLayout.layout.shell === "v2";
  return (
    <DisclosureMenu label="Layout">
      <Button aria-pressed={panelLayout.navigationVisible} disabled={panelLayout.mobile}
        onClick={() => panelLayout.update({ navigationOpen: !panelLayout.layout.navigationOpen })}>{v2 ? "Browser panel" : "Navigation panel"}</Button>
      <Button aria-pressed={panelLayout.inspectorVisible} disabled={panelLayout.narrow}
        onClick={() => panelLayout.update({ inspectorOpen: !panelLayout.layout.inspectorOpen })}>Inspector panel</Button>
      {panelLayout.narrow && <p>Side panels hide on smaller screens to keep the editor usable. Your desktop layout is remembered.</p>}
      <Button onClick={() => { panelLayout.reset(); onReset(); }}>Reset layout</Button>
      <p>Drag a panel edge to resize, or focus it and use the arrow keys.</p>
      <Button aria-pressed={v2}
        onClick={() => panelLayout.update({ shell: v2 ? "v1" : "v2" })}>DAW layout (preview)</Button>
    </DisclosureMenu>
  );
}

/** Workspace picker, layout menu and mixer toggle under the top bar. */
export const StudioViewbar = forwardRef<HTMLButtonElement, {
  workspace: Workspace;
  onWorkspace: (workspace: Workspace) => void;
  panelLayout: PanelLayout;
  mixerOpen: boolean;
  onMixerOpen: (open: boolean) => void;
}>(function StudioViewbar({ workspace, onWorkspace, panelLayout, mixerOpen, onMixerOpen }, mixerToggleRef) {
  return (
    <div className="studio-viewbar" aria-label="Workspace and panels">
      <label>Workspace <select value={workspace} onChange={(event) => onWorkspace(event.target.value as Workspace)}>
        <option value="arrangement">Arrangement</option>
        <option value="generation">Generate</option>
        <option value="adaptive">Adaptive states</option>
        <option value="render">Render / export</option>
        <option value="devices">Devices & effects</option>
      </select></label>
      <div className="studio-view-actions">
      <LayoutMenu panelLayout={panelLayout} onReset={() => onMixerOpen(false)} />
      <Button ref={mixerToggleRef} aria-expanded={mixerOpen} aria-controls="studio-mixer"
        onClick={() => onMixerOpen(!mixerOpen)}>Mixer</Button>
      </div>
    </div>
  );
});

/** Instrument picker and "Add instrument track"; in the v1 sidebar and the v2 browser. */
export function InstrumentAdder({ newInstrument, onNewInstrument, onAddInstrument, addDisabled }: {
  newInstrument: string;
  onNewInstrument: (deviceType: string) => void;
  onAddInstrument: (deviceType: string) => void;
  addDisabled: boolean;
}) {
  return (
    <section className="sidebar-card" aria-label="Add instrument">
      <strong>Instruments</strong>
      <InstrumentPicker value={newInstrument} onChange={onNewInstrument} />
      <p>{instrumentDefinition(newInstrument)?.description}</p>
      <Button disabled={addDisabled} onClick={() => onAddInstrument(newInstrument)}>Add instrument track</Button>
    </section>
  );
}

/** Left navigation: workspaces, editors, instrument picker and runtime preview. */
export function StudioSidebar({ project, panelLayout, workspace, onWorkspace, activeClip, onActiveClip, mixerOpen, onMixerOpen, newInstrument, onNewInstrument, onAddInstrument, addDisabled, onOpenPreview }: {
  project: MusicProject;
  panelLayout: PanelLayout;
  workspace: Workspace;
  onWorkspace: (workspace: Workspace) => void;
  activeClip: ActiveClip | null;
  onActiveClip: (clip: ActiveClip | null) => void;
  mixerOpen: boolean;
  onMixerOpen: (open: boolean) => void;
  newInstrument: string;
  onNewInstrument: (deviceType: string) => void;
  onAddInstrument: (deviceType: string) => void;
  addDisabled: boolean;
  onOpenPreview: () => void;
}) {
  return (
    <aside id="studio-navigation" className="studio-sidebar" aria-label="Studio navigation" hidden={!panelLayout.navigationVisible}>
      <ResizeHandle label="Navigation panel size" controls="studio-navigation" orientation="vertical"
        value={panelLayout.navigationWidth} min={160} max={320} onChange={(navigationWidth) => panelLayout.update({ navigationWidth })} />
      <div className="studio-sidebar-scroll">
      <p className="panel-label">Workspace</p>
      <nav className="studio-nav">
        <Button aria-current={workspace === "arrangement" && !activeClip ? "page" : undefined} onClick={() => { onWorkspace("arrangement"); onActiveClip(null); }}><span><span className="nav-glyph">A</span>Arrangement</span></Button>
        {([
          ["piano-roll", "P", "Piano roll", "Add a melodic instrument track with a clip to use the piano roll"],
          ["drum-sequencer", "D", "Drum sequencer", "Add a drum track with a clip to use the drum sequencer"]
        ] as const).map(([kind, glyph, label, unavailable]) => {
          const target = findEditorClip(project, kind as EditorKind, activeClip);
          const open = workspace === "arrangement" && activeClip !== null
            && editorKindForTrack(project, activeClip.trackId) === kind;
          return (
            <Button key={kind} disabled={!target} title={target ? undefined : unavailable}
              aria-current={open ? "page" : undefined}
              onClick={() => { if (target) { onWorkspace("arrangement"); onActiveClip(target); } }}>
              <span><span className="nav-glyph">{glyph}</span>{label}</span>
            </Button>
          );
        })}
        <Button aria-expanded={mixerOpen} aria-controls="studio-mixer" onClick={() => onMixerOpen(!mixerOpen)}><span><span className="nav-glyph">M</span>Mixer</span></Button>
      </nav>
      <p className="panel-label" style={{ marginTop: 22 }}>SynaptixPlay</p>
      <nav className="studio-nav">
        <Button aria-current={workspace === "generation" ? "page" : undefined} onClick={() => onWorkspace("generation")}><span><span className="nav-glyph">G</span>Generate</span><span className="nav-badge">AI</span></Button>
        <Button aria-current={workspace === "adaptive" ? "page" : undefined} onClick={() => onWorkspace("adaptive")}><span><span className="nav-glyph">S</span>Adaptive states</span><span className="nav-badge">13</span></Button>
        <Button aria-current={workspace === "render" ? "page" : undefined} onClick={() => onWorkspace("render")}><span><span className="nav-glyph" aria-hidden="true">R</span>Render / export</span></Button>
        <Button aria-current={workspace === "devices" ? "page" : undefined} onClick={() => onWorkspace("devices")}>Devices & effects</Button>
      </nav>
      <InstrumentAdder newInstrument={newInstrument} onNewInstrument={onNewInstrument} onAddInstrument={onAddInstrument} addDisabled={addDisabled} />
      <section className="sidebar-card" aria-label="Adaptive audio preview">
        <strong>Runtime preview</strong>
        <p>Audition rendered states, loops, and transitions with runtime events.</p>
        <Button onClick={onOpenPreview}>Open package preview</Button>
      </section>
      </div>
    </aside>
  );
}
