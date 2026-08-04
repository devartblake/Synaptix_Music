import {
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
  type HubConnection
} from "@microsoft/signalr";
import {
  GenerationJobStatusEventSchema,
  type GenerationJob,
  type GenerationJobStatusEvent
} from "@synaptix/platform-contracts";

import { getGenerationJob } from "./platform-api";

export interface GenerationJobRealtimeOptions {
  hubUrl: string;
  jobId: string;
  accessTokenFactory?: () => string | Promise<string>;
  onStatus: (event: GenerationJobStatusEvent) => void | Promise<void>;
  onRecovered?: (job: GenerationJob) => void | Promise<void>;
  onConnectionState?: (state: "connecting" | "connected" | "reconnecting" | "closed") => void;
}

export interface GenerationJobRealtimeSubscription {
  connection: HubConnection;
  stop(): Promise<void>;
}

export async function subscribeToGenerationJobStatus(
  options: GenerationJobRealtimeOptions
): Promise<GenerationJobRealtimeSubscription> {
  options.onConnectionState?.("connecting");
  const connection = new HubConnectionBuilder()
    .withUrl(options.hubUrl, {
      withCredentials: true,
      accessTokenFactory: options.accessTokenFactory
    })
    .withAutomaticReconnect([0, 1_000, 3_000, 10_000, 30_000])
    .configureLogging(LogLevel.Warning)
    .build();

  connection.on("MusicGenerationJobStatusChanged", async (payload: unknown) => {
    const event = GenerationJobStatusEventSchema.parse(payload);
    if (event.jobId !== options.jobId) return;
    await options.onStatus(event);
  });

  connection.onreconnecting(() => options.onConnectionState?.("reconnecting"));
  connection.onreconnected(async () => {
    options.onConnectionState?.("connected");
    const recovered = await getGenerationJob(options.jobId);
    await options.onRecovered?.(recovered);
  });
  connection.onclose(() => options.onConnectionState?.("closed"));

  await connection.start();
  options.onConnectionState?.("connected");

  // Reconcile immediately because a transition may have occurred between job creation and hub startup.
  const recovered = await getGenerationJob(options.jobId);
  await options.onRecovered?.(recovered);

  return {
    connection,
    async stop() {
      if (connection.state !== HubConnectionState.Disconnected) {
        await connection.stop();
      }
    }
  };
}
