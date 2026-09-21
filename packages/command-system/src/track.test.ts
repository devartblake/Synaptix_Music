import assert from "node:assert/strict"; import test from "node:test"; import { createEmptyProject } from "@synaptix/project-model"; import { AddTrackEditorCommand } from "./track.ts";
const track={id:"drone-track",name:"Drone",kind:"instrument" as const,muted:false,solo:false,volumeDb:-12,pan:0,devices:[],clips:[]};
test("adding a device track is undoable",()=>{const p=createEmptyProject("p");const c=new AddTrackEditorCommand(track,{id:"cmd"});const added=c.execute(p);assert.equal(added.tracks[0]?.id,"drone-track");assert.equal(c.undo(added).tracks.length,0);});
test("duplicate track insertion fails closed",()=>{const p=createEmptyProject("p");p.tracks.push(track);assert.throws(()=>new AddTrackEditorCommand(track).execute(p),/already exists/);});
