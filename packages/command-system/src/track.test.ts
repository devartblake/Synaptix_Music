import assert from "node:assert/strict"; import test from "node:test"; import { createEmptyProject } from "@synaptix/project-model"; import { AddClipEditorCommand, AddTrackEditorCommand, RemoveTrackEditorCommand, SwapInstrumentEditorCommand } from "./track.ts";
const track={id:"drone-track",name:"Drone",kind:"instrument" as const,muted:false,solo:false,volumeDb:-12,pan:0,devices:[],clips:[]};
test("adding a device track is undoable",()=>{const p=createEmptyProject("p");const c=new AddTrackEditorCommand(track,{id:"cmd"});const added=c.execute(p);assert.equal(added.tracks[0]?.id,"drone-track");assert.equal(c.undo(added).tracks.length,0);});
test("duplicate track insertion fails closed",()=>{const p=createEmptyProject("p");p.tracks.push(track);assert.throws(()=>new AddTrackEditorCommand(track).execute(p),/already exists/);});
test("removing a track is undoable and restores its position",()=>{const p=createEmptyProject("p");p.tracks.push({...track,id:"a"},{...track,id:"b"},{...track,id:"c"});const c=new RemoveTrackEditorCommand("b",{id:"rm"});const removed=c.execute(p);assert.deepEqual(removed.tracks.map(t=>t.id),["a","c"]);assert.deepEqual(c.undo(removed).tracks.map(t=>t.id),["a","b","c"]);assert.equal(p.tracks.length,3,"input project is not mutated");});
test("removing a missing track fails closed",()=>{assert.throws(()=>new RemoveTrackEditorCommand("nope").execute(createEmptyProject("p")),/was not found/);});
test("adding a clip is undoable and rejects duplicates",()=>{const p=createEmptyProject("p");p.tracks.push({...track,id:"t"});const clip={id:"c",kind:"midi" as const,name:"Clip",loop:false,notes:[],range:{start:{bar:4,beat:0,tick:0},durationTicks:15360}};const c=new AddClipEditorCommand("t",clip);const added=c.execute(p);assert.equal(added.tracks[0]?.clips[0]?.id,"c");assert.equal(p.tracks[0]?.clips.length,0,"input not mutated");assert.equal(c.undo(added).tracks[0]?.clips.length,0);assert.throws(()=>c.execute(added),/already exists/);assert.throws(()=>new AddClipEditorCommand("missing",clip).execute(p),/not found/);});
test("swapping an instrument replaces the sounding device with defaults and undoes exactly",()=>{
  const p=createEmptyProject("p");
  const old={id:"dev-old",deviceType:"warm-pad",deviceVersion:"1.0.0",enabled:true,parameters:[{id:"cutoff",value:900}]};
  p.tracks.push({...track,id:"t",name:"Warm Pad",devices:[{...old,id:"dev-off",enabled:false},old]});
  const c=new SwapInstrumentEditorCommand("t","pluck",{id:"swap",name:"Pluck"});
  const swapped=c.execute(p);
  const t=swapped.tracks[0]!;
  // The enabled device is the one that plays, so it is the one replaced; its old settings don't apply to the new instrument.
  assert.deepEqual(t.devices[1],{id:"device-swap",deviceType:"pluck",deviceVersion:"1.0.0",enabled:true,parameters:[]});
  assert.equal(t.devices[0]?.id,"dev-off");
  assert.equal(t.name,"Pluck");
  assert.equal(p.tracks[0]?.devices[1]?.deviceType,"warm-pad","input not mutated");
  assert.deepEqual(c.undo(swapped).tracks[0],p.tracks[0]);
  assert.throws(()=>new SwapInstrumentEditorCommand("t","pluck").execute(createEmptyProject("p")),/not found/);
});
