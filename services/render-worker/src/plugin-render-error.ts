export interface PluginRenderBlocker {
  trackId: string;
  deviceId: string;
  pluginId: string;
  reason: string;
}

/** Raised when a revision contains live plug-in processing this worker cannot certify. */
export class PluginRenderUnsupportedError extends Error {
  constructor(readonly devices: readonly PluginRenderBlocker[]) {
    super(
      `Render requires plug-in processing this worker cannot certify: ${devices
        .map((device) => `${device.pluginId} on track '${device.trackId}' (${device.reason})`)
        .join("; ")}.`
    );
    this.name = "PluginRenderUnsupportedError";
  }
}
