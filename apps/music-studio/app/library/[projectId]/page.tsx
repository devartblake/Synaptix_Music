import { ProjectListenClient } from "./ProjectListenClient";

export default async function ProjectListenPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectListenClient projectId={projectId} />;
}
