import type { Device, MusicProject, Track } from "@synaptix/project-model";

export const FREQUENCY_DRONE_DEVICE_TYPE = "synaptix-frequency-drone";
export const DRONE_FREQUENCY_PARAMETER = "droneFrequencyHz";
export const DRONE_GAIN_PARAMETER = "droneGain";
export const DRONE_HARMONICS_PARAMETER = "droneHarmonics";
export const DRONE_MOD_RATE_PARAMETER = "droneModulationRateHz";
export const DRONE_MOD_DEPTH_PARAMETER = "droneModulationDepth";
export const DRONE_FILTER_PARAMETER = "droneFilterHz";
export const DRONE_STEREO_OFFSET_PARAMETER = "droneStereoOffsetHz";

export interface FrequencyDroneDeviceSettings {
  frequencyHz: number; gain: number; harmonics: number; modulationRateHz: number;
  modulationDepth: number; filterHz: number; stereoOffsetHz: number;
}
export const DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS: FrequencyDroneDeviceSettings = {
  frequencyHz: 528, gain: 0.12, harmonics: 1, modulationRateHz: 0.15,
  modulationDepth: 0, filterHz: 12000, stereoOffsetHz: 0
};
const ids: Record<keyof FrequencyDroneDeviceSettings,string> = {
 frequencyHz:DRONE_FREQUENCY_PARAMETER,gain:DRONE_GAIN_PARAMETER,harmonics:DRONE_HARMONICS_PARAMETER,
 modulationRateHz:DRONE_MOD_RATE_PARAMETER,modulationDepth:DRONE_MOD_DEPTH_PARAMETER,
 filterHz:DRONE_FILTER_PARAMETER,stereoOffsetHz:DRONE_STEREO_OFFSET_PARAMETER
};
function value(device: Device, id: string, fallback: number): number {
 return device.parameters.find(p=>p.id===id)?.value ?? fallback;
}
export function resolveFrequencyDroneDevice(device: Device): FrequencyDroneDeviceSettings {
 const d=DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS;
 return {
  frequencyHz:value(device,ids.frequencyHz,d.frequencyHz), gain:value(device,ids.gain,d.gain),
  harmonics:Math.round(value(device,ids.harmonics,d.harmonics)), modulationRateHz:value(device,ids.modulationRateHz,d.modulationRateHz),
  modulationDepth:value(device,ids.modulationDepth,d.modulationDepth), filterHz:value(device,ids.filterHz,d.filterHz),
  stereoOffsetHz:value(device,ids.stereoOffsetHz,d.stereoOffsetHz)
 };
}
export function createFrequencyDroneTrack(settings: Partial<FrequencyDroneDeviceSettings> = {}, id = crypto.randomUUID()): Track {
 const s={...DEFAULT_FREQUENCY_DRONE_DEVICE_SETTINGS,...settings};
 return {id:`drone-track-${id}`,name:`Frequency Drone ${Math.round(s.frequencyHz)} Hz`,kind:"instrument",muted:false,solo:false,volumeDb:-12,pan:0,clips:[],devices:[{
  id:`drone-device-${id}`,deviceType:FREQUENCY_DRONE_DEVICE_TYPE,deviceVersion:"1.0.0",enabled:true,
  parameters:(Object.keys(ids) as (keyof FrequencyDroneDeviceSettings)[]).map(k=>({id:ids[k],value:s[k]}))
 }]};
}
export function frequencyDroneDevices(project: MusicProject): Array<{track:Track;device:Device;settings:FrequencyDroneDeviceSettings}> {
 return project.tracks.flatMap(track=>track.devices.filter(device=>device.deviceType===FREQUENCY_DRONE_DEVICE_TYPE)
  .map(device=>({track,device,settings:resolveFrequencyDroneDevice(device)})));
}
