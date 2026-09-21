import type { FrequencyDroneDeviceSettings } from "./frequency-drone.ts";
export interface FrequencyDroneRenderPlan { sampleRate:number; durationSeconds:number; settings:FrequencyDroneDeviceSettings; }
export function buildFrequencyDroneRenderPlan(settings:FrequencyDroneDeviceSettings,durationSeconds:number,sampleRate=48000):FrequencyDroneRenderPlan {
 if(!Number.isFinite(durationSeconds)||durationSeconds<=0) throw new Error("Drone render duration must be positive.");
 return {sampleRate,durationSeconds,settings:{...settings}};
}
export function renderFrequencyDroneMono(plan:FrequencyDroneRenderPlan):Float32Array {
 const length=Math.ceil(plan.sampleRate*plan.durationSeconds), out=new Float32Array(length), s=plan.settings;
 const harmonics=Math.max(1,Math.min(8,Math.round(s.harmonics)));
 for(let i=0;i<length;i++){const t=i/plan.sampleRate; const lfo=1+s.modulationDepth*Math.sin(2*Math.PI*s.modulationRateHz*t);
  let v=0; for(let h=1;h<=harmonics;h++) v+=Math.sin(2*Math.PI*s.frequencyHz*h*t)/(h*h);
  out[i]=Math.max(-1,Math.min(1,v*s.gain*lfo));
 } return out;
}
