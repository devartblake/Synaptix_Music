"use client";

import type { AnyMusicProject } from "@synaptix/project-model/v2";

import { useCoverUrl } from "../../lib/player/covers";
import { ProjectArtwork } from "./ProjectArtwork";

/** A project's cover: the uploaded image when there is one, otherwise its generated artwork. */
export function CoverArt({ projectId, project, className, label }: {
  projectId: string;
  project?: AnyMusicProject | null;
  className?: string;
  label?: string;
}) {
  const url = useCoverUrl(projectId);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- local object URL; no optimization applies
    return <img className={className} src={url} alt={label ?? ""} style={{ objectFit: "cover", display: "block" }} />;
  }
  return <ProjectArtwork seed={projectId} project={project} className={className} label={label} />;
}
