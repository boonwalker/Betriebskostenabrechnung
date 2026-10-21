const SUPPORTED = ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp"] as const;
export type ImageType = Exclude<(typeof SUPPORTED)[number], "application/pdf">;

export function isSupportedFile(file: File) {
  return (SUPPORTED as readonly string[]).includes(file.type);
}
