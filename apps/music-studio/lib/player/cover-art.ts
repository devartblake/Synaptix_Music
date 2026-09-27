/** Image types accepted for cover art. */
export const COVER_ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
/** Upload limit before processing; covers are re-encoded far smaller. */
export const COVER_MAX_INPUT_BYTES = 20 * 1024 * 1024;
/** Longest side of the stored square cover (enough for a sharp Now Playing view). */
export const COVER_OUTPUT_SIZE = 1024;
export const COVER_MIN_SIZE = 64;

export class CoverArtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoverArtError";
  }
}

export function validateCoverFile(file: { type: string; size: number }): void {
  if (!(COVER_ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    throw new CoverArtError("Choose a PNG, JPEG, or WebP image.");
  }
  if (file.size > COVER_MAX_INPUT_BYTES) throw new CoverArtError("Choose an image smaller than 20 MB.");
}

export interface SquareCrop {
  sx: number;
  sy: number;
  size: number;
  output: number;
}

/** Center-crop to a square and scale down (never up) to at most COVER_OUTPUT_SIZE. */
export function squareCrop(width: number, height: number): SquareCrop {
  const size = Math.min(width, height);
  if (!Number.isFinite(size) || size < COVER_MIN_SIZE) {
    throw new CoverArtError(`Choose an image at least ${COVER_MIN_SIZE} × ${COVER_MIN_SIZE} pixels.`);
  }
  return {
    sx: Math.floor((width - size) / 2),
    sy: Math.floor((height - size) / 2),
    size,
    output: Math.min(size, COVER_OUTPUT_SIZE)
  };
}

export interface PreparedCover {
  blob: Blob;
  mediaType: string;
  width: number;
  height: number;
}

/**
 * Decode, square-crop and re-encode an uploaded image in the browser. Re-encoding strips
 * metadata (e.g. EXIF location) and bounds the stored size.
 */
export async function prepareCoverImage(file: File): Promise<PreparedCover> {
  validateCoverFile(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new CoverArtError("This image couldn't be read. Try a different file.");
  }
  try {
    const crop = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = crop.output;
    canvas.height = crop.output;
    const context = canvas.getContext("2d");
    if (!context) throw new CoverArtError("This browser can't process images.");
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, crop.sx, crop.sy, crop.size, crop.size, 0, 0, crop.output, crop.output);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.88))
      ?? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new CoverArtError("This image couldn't be saved.");
    return { blob, mediaType: blob.type || "image/webp", width: crop.output, height: crop.output };
  } finally {
    bitmap.close();
  }
}
