import { extractErrorMessage } from "./platform-project-repository";
export async function platformRequest(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`/api/platform/${path}`, {
    ...init,
    credentials: "include",
    cache: "no-store",
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(extractErrorMessage(await response.text(), response.status));
  return response.json();
}
