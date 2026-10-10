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
/**
 * Swaps a track's instrument: its first enabled device (else its first) becomes `deviceType`
 * with default parameters. The device gets a new id so nothing tied to the old instrument
 * (plug-in fields, automation) carries over; undo puts the old device and name back.
 */
export class SwapInstrumentEditorCommand implements EditorCommand {
 readonly id:string; readonly kind="swap-instrument";
 private previous:{index:number;device:Track["devices"][number];name:string}|null=null;
 constructor(readonly trackId:string, readonly deviceType:string, readonly options:{id?:string;name?:string}={}){this.id=options.id??crypto.randomUUID();}
 execute(project:MusicProject){const n=clone(project); const track=n.tracks.find(t=>t.id===this.trackId); if(!track) throw new Error(`Track '${this.trackId}' was not found.`); const found=track.devices.findIndex(d=>d.enabled); const index=found<0?0:found; const device=track.devices[index]; if(!device) throw new Error(`Track '${this.trackId}' has no instrument to swap.`); this.previous={index,device:structuredClone(device),name:track.name}; track.devices[index]={id:`device-${this.id}`,deviceType:this.deviceType,deviceVersion:device.deviceVersion,enabled:true,parameters:[]}; if(this.options.name) track.name=this.options.name; return n;}
 undo(project:MusicProject){if(!this.previous) throw new Error("SwapInstrumentEditorCommand must execute before it can be undone."); const n=clone(project); const track=n.tracks.find(t=>t.id===this.trackId); if(!track) throw new Error(`Track '${this.trackId}' was not found.`); track.devices[this.previous.index]=structuredClone(this.previous.device); track.name=this.previous.name; return n;}
}
