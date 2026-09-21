import { z } from "zod";
export const AdaptiveDeviceParameterMappingSchema = z.object({
  mappingId:z.string().min(1), stateId:z.string().min(1), trackId:z.string().min(1),
  deviceId:z.string().min(1), parameterId:z.string().min(1), value:z.number()
}).strict();
export type AdaptiveDeviceParameterMapping=z.infer<typeof AdaptiveDeviceParameterMappingSchema>;
export function interpolateAdaptiveParameter(from:number,to:number,intensity:number):number {
 const t=Math.min(1,Math.max(0,intensity)); return from+(to-from)*t;
}
