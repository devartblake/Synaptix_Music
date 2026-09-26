import type { Clip, MusicProject, Track } from "@synaptix/project-model";
import type { EditorCommand } from "./editor.ts";
function clone(p:MusicProject){return structuredClone(p);}
export class AddTrackEditorCommand implements EditorCommand {
 readonly id:string; readonly kind="add-track";
 constructor(readonly track:Track, options:{id?:string}={}){this.id=options.id??crypto.randomUUID();}
 execute(project:MusicProject){const n=clone(project); if(n.tracks.some(t=>t.id===this.track.id)) throw new Error(`Track '${this.track.id}' already exists.`); n.tracks.push(structuredClone(this.track)); return n;}
 undo(project:MusicProject){const n=clone(project); n.tracks=n.tracks.filter(t=>t.id!==this.track.id); return n;}
}
export class RemoveTrackEditorCommand implements EditorCommand {
 readonly id:string; readonly kind="remove-track";
 private removed:{track:Track;index:number}|null=null;
 constructor(readonly trackId:string, options:{id?:string}={}){this.id=options.id??crypto.randomUUID();}
 execute(project:MusicProject){const n=clone(project); const index=n.tracks.findIndex(t=>t.id===this.trackId); if(index<0) throw new Error(`Track '${this.trackId}' was not found.`); this.removed={track:structuredClone(n.tracks[index]!),index}; n.tracks.splice(index,1); return n;}
 undo(project:MusicProject){if(!this.removed) throw new Error("RemoveTrackEditorCommand must execute before it can be undone."); const n=clone(project); if(n.tracks.some(t=>t.id===this.trackId)) throw new Error(`Track '${this.trackId}' already exists.`); n.tracks.splice(Math.min(this.removed.index,n.tracks.length),0,structuredClone(this.removed.track)); return n;}
}
export class AddClipEditorCommand implements EditorCommand {
 readonly id:string; readonly kind="add-clip";
 constructor(readonly trackId:string, readonly clip:Clip, options:{id?:string}={}){this.id=options.id??crypto.randomUUID();}
 execute(project:MusicProject){const n=clone(project); const track=n.tracks.find(t=>t.id===this.trackId); if(!track) throw new Error(`Track '${this.trackId}' was not found.`); if(track.clips.some(c=>c.id===this.clip.id)) throw new Error(`Clip '${this.clip.id}' already exists.`); track.clips.push(structuredClone(this.clip)); return n;}
 undo(project:MusicProject){const n=clone(project); const track=n.tracks.find(t=>t.id===this.trackId); if(track) track.clips=track.clips.filter(c=>c.id!==this.clip.id); return n;}
}
