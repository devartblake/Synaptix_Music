"use client";

import { useId } from "react";

import { Button } from "../../../components/ui/StudioControls";
import { useAuditionPreference } from "../../../lib/editor/use-audition";
import type { useStudioLayout } from "../../../lib/editor/use-studio-layout";
import type { StudioSettings } from "../../../lib/editor/use-studio-settings";

/**
 * The DAW layout's Settings dialog: features (notebook, sticky notes), layout and editing.
 * Everything here is a per-browser preference; nothing changes the project.
 */
export function StudioSettingsPanel({ settings, onSettings, panelLayout, onClose }: {
  settings: StudioSettings;
  onSettings: (patch: Partial<StudioSettings>) => void;
  panelLayout: ReturnType<typeof useStudioLayout>;
  onClose: () => void;
}) {
  const [preview, setPreview] = useAuditionPreference();
  return (
    <div className="studio-settings">
      <div className="studio-settings-heading">
        <h2 tabIndex={-1}>Settings</h2>
        <Button onClick={onClose}>Close</Button>
      </div>
      <p className="studio-settings-hint">Saved in this browser. Turning a feature off hides it; notes already written stay in the project.</p>

      <section aria-labelledby="settings-features">
        <h3 id="settings-features">Features</h3>
        <Toggle label="Notebook" checked={settings.notebook} onChange={(notebook) => onSettings({ notebook })}
          description="Pages of ideas, lyrics and to-dos for the project, opened from the Notebook button." />
        <Toggle label="Sticky notes" checked={settings.stickyNotes} onChange={(stickyNotes) => onSettings({ stickyNotes })}
          description="Short notes on tracks (shown on their headers) and on the project (in the inspector)." />
      </section>

      <section aria-labelledby="settings-layout">
        <h3 id="settings-layout">Layout</h3>
        <Toggle label="Browser panel" checked={panelLayout.navigationVisible} disabled={panelLayout.mobile}
          onChange={() => panelLayout.update({ navigationOpen: !panelLayout.layout.navigationOpen })}
          description={panelLayout.mobile ? "On phones the Browser opens over the timeline from More." : "Instruments, patterns and project actions on the left."} />
        <Toggle label="Inspector panel" checked={panelLayout.inspectorVisible} disabled={panelLayout.narrow}
          onChange={() => panelLayout.update({ inspectorOpen: !panelLayout.layout.inspectorOpen })}
          description={panelLayout.narrow ? "On smaller screens the inspector opens over the timeline. Your desktop layout is remembered." : "The selection, project facts and notes on the right."} />
        <Toggle label="DAW layout (preview)" checked={panelLayout.v2}
          onChange={() => { onClose(); panelLayout.update({ shell: panelLayout.v2 ? "v1" : "v2" }); }}
          description="Turn off to go back to the classic studio layout." />
        <div className="studio-settings-row">
          <Button onClick={() => panelLayout.reset()}>Reset layout</Button>
          <p>Panel sizes and the dock go back to their defaults. Drag a panel edge to resize, or focus it and use the arrow keys.</p>
        </div>
      </section>

      <section aria-labelledby="settings-editing">
        <h3 id="settings-editing">Editing</h3>
        <Toggle label="Preview notes while editing" checked={preview} onChange={setPreview}
          description="Play notes as you draw, move or select them in the piano roll and drum editor." />
      </section>
    </div>
  );
}

function Toggle({ label, description, checked, disabled, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="studio-settings-row">
      <input id={id} type="checkbox" role="switch" className="studio-switch" checked={checked} disabled={disabled}
        aria-describedby={`${id}-description`} onChange={(event) => onChange(event.currentTarget.checked)} />
      <label htmlFor={id}>{label}</label>
      <p id={`${id}-description`}>{description}</p>
    </div>
  );
}
