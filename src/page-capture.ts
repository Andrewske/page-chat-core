/* Browser-only page capture shared by the feedback widget and the page agent
   chat. snapdom re-renders the DOM (not real pixels; getDisplayMedia prompts
   and doesn't exist on mobile), then we crop to the visible scroll window so
   the image is exactly what was on screen. */

export type CaptureMime = "image/webp" | "image/png";

/** Elements carrying this attribute (floating buttons, open sheets) are left out of captures. */
export const CAPTURE_EXCLUDE_ATTR = "data-feedback-exclude";

function cropToViewport(canvas: HTMLCanvasElement, mime: CaptureMime): Promise<Blob | null> {
  const rect = document.body.getBoundingClientRect();
  const ratio = canvas.width / rect.width;
  const sx = Math.max(0, -rect.left * ratio);
  const sy = Math.max(0, -rect.top * ratio);
  const width = Math.min(window.innerWidth * ratio, canvas.width - sx);
  const height = Math.min(window.innerHeight * ratio, canvas.height - sy);
  const crop = document.createElement("canvas");
  crop.width = Math.round(width);
  crop.height = Math.round(height);
  const ctx = crop.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.drawImage(canvas, sx, sy, width, height, 0, 0, crop.width, crop.height);
  return new Promise((resolve) => crop.toBlob((blob) => resolve(blob), mime, 0.8));
}

/** Capture what's on screen. Failures degrade to null so callers fall back to text-only. */
export async function captureVisible(mime: CaptureMime): Promise<Blob | null> {
  try {
    const { snapdom } = await import("@zumer/snapdom");
    const canvas = await snapdom.toCanvas(document.body, {
      scale: 1,
      backgroundColor: getComputedStyle(document.body).backgroundColor,
      exclude: [`[${CAPTURE_EXCLUDE_ATTR}]`],
    });
    return await cropToViewport(canvas, mime);
  } catch (error) {
    console.error("[page-capture] screenshot capture failed:", error);
    return null;
  }
}
