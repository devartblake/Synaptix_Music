import StudioClient from "./StudioClient";
export default async function StudioPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <StudioClient projectId={projectId} />;
}
