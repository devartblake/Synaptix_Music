import type { AnyMusicProject } from "@synaptix/project-model/v2";

import { artworkContour, artworkPalette } from "../../lib/player/playback-model";

/**
 * Generated cover art for a project: colors from the project id, a waveform from its notes.
 * Deterministic, so a project looks the same in the library, the mini player and Now Playing.
 */
export function ProjectArtwork({ seed, project, size, className, label }: {
  seed: string;
  project?: AnyMusicProject | null;
  size?: number;
  className?: string;
  label?: string;
}) {
  const { hueA, hueB, hueC, rotation } = artworkPalette(seed);
  const contour = artworkContour(project ?? null, 28);
  const id = `art-${seed.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24) || "x"}`;
  const bars = contour.map((value, index) => {
    const x = 14 + index * (72 / contour.length);
    const height = 8 + value * 34;
    return <rect key={index} x={x} y={62 - height / 2} width={72 / contour.length - 1.2} height={height} rx={1.2} />;
  });
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" role={label ? "img" : undefined}
      aria-label={label} aria-hidden={label ? undefined : true} preserveAspectRatio="xMidYMid slice">
      <defs>
        <linearGradient id={`${id}-bg`} gradientTransform={`rotate(${rotation} .5 .5)`}>
          <stop offset="0" stopColor={`hsl(${hueA} 72% 46%)`} />
          <stop offset=".55" stopColor={`hsl(${hueB} 68% 28%)`} />
          <stop offset="1" stopColor={`hsl(${hueC} 60% 14%)`} />
        </linearGradient>
        <radialGradient id={`${id}-glow`} cx=".72" cy=".28" r=".6">
          <stop offset="0" stopColor={`hsl(${hueB} 95% 72% / .75)`} />
          <stop offset="1" stopColor={`hsl(${hueB} 95% 72% / 0)`} />
        </radialGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${id}-bg)`} />
      <rect width="100" height="100" fill={`url(#${id}-glow)`} />
      <circle cx="72" cy="28" r="15" fill="none" stroke="rgb(255 255 255 / .35)" strokeWidth=".6" />
      <circle cx="72" cy="28" r="24" fill="none" stroke="rgb(255 255 255 / .18)" strokeWidth=".5" />
      <g fill="rgb(255 255 255 / .82)">{bars}</g>
    </svg>
  );
}
