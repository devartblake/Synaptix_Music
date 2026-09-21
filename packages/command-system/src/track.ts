import type { MusicProject, Track } from "@synaptix/project-model";
import type { EditorCommand } from "./editor.ts";
function clone(p:MusicProject){return structuredClone(p);}
export class AddTrackEditorCommand implements EditorCommand {
 readonly id:string; readonly kind="add-track";
 constructor(readonly track:Track, options:{id?:string}={}){this.id=options.id??crypto.randomUUID();}
 execute(project:MusicProject){const n=clone(project); if(n.tracks.some(t=>t.id===this.track.id)) throw new Error(`Track '${this.track.id}' already exists.`); n.tracks.push(structuredClone(this.track)); return n;}
 undo(project:MusicProject){const n=clone(project); n.tracks=n.tracks.filter(t=>t.id!==this.track.id); return n;}
}
