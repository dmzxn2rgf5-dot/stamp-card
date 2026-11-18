// Small images kept in D1 (logo, custom stamp icon), so a deploy needs no R2 bucket.
export const MAX_IMAGE_BYTES = 200 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

// SVG can carry scripts. Rather than try to clean a file (hard to do reliably
// without a DOM), anything that could run code or load something is refused.
const SVG_BLOCKLIST: [RegExp, string][] = [
  [/<script/i, "scripts"],
  [/\son[a-z]+\s*=/i, "event handlers"],
  [/javascript:/i, "javascript: links"],
  [/<foreignObject/i, "embedded HTML"],
  [/<!ENTITY/i, "entities"],
  [/<!DOCTYPE/i, "a DOCTYPE"],
  [/<(iframe|embed|object|audio|video|animate|set)\b/i, "embedded content or animation"],
  [/(?:xlink:)?href\s*=\s*["']\s*(?!#)/i, "links to other files"],
  [/url\(\s*["']?\s*(?!#)/i, "external styles"],
  [/@import/i, "external styles"],
  [/data:/i, "embedded data"],
];

/** Returns an error message, or null if the upload is acceptable. */
export async function checkImage(file: File): Promise<string | null> {
  if (!IMAGE_TYPES.includes(file.type)) return "Use a PNG, JPEG, WebP or SVG image.";
  if (file.size > MAX_IMAGE_BYTES) return "Image must be under 200 KB.";
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    if (!/<svg[\s>]/i.test(text)) return "That SVG file doesn't look valid.";
    for (const [re, what] of SVG_BLOCKLIST) if (re.test(text)) return `SVG files can't contain ${what}. Export a plain SVG, or use PNG.`;
  }
  return null;
}

/** Headers for serving a stored image. SVGs are locked down in case one is opened directly. */
export function imageHeaders(contentType: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": contentType, "Cache-Control": "public, max-age=31536000, immutable" };
  if (contentType === "image/svg+xml") h["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return h;
}
