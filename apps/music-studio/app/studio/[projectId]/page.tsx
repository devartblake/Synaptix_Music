import StudioClient from "./StudioClient";
export default async function StudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <><section className="viewport-notice" aria-label="Editing viewport"><h1>Make room to edit</h1><p>Studio editing needs at least 320 × 480 CSS pixels. Enlarge this window, rotate your device, or reduce browser zoom.</p><a href="/">Back to projects</a></section><StudioClient projectId={projectId} /></>;
}
