import type { MusicProject } from "@synaptix/project-model";
export interface StudioCommand { readonly type: string; execute(project: MusicProject): MusicProject; undo(project: MusicProject): MusicProject; }
