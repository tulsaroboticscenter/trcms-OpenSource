/**
 * Client-side image downscale + compress. Phone photos are frequently 5–12 MB,
 * which the upload endpoint rejects. We draw the image onto a canvas scaled to a
 * max edge and re-encode as JPEG, iterating quality down until the result fits
 * comfortably under the limit.
 *
 * The live host caps PHP uploads at ~2 MB (upload_max_filesize) and won't raise
 * it, so the target is well under that — a profile/photo doesn't need more than
 * ~1200px anyway. If the browser can't decode the image (e.g. HEIC on some
 * platforms) the original File is returned unchanged; PhotoUpload then surfaces a
 * clear message rather than a silent failure.
 */

const MAX_EDGE = 1200;         // longest side, px — plenty for avatars/profile photos
const TARGET_BYTES = 1_500_000; // stay safely under the host's ~2 MB upload cap

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  // Small enough already and not huge dimensions? Skip the work.
  const bitmap = await loadBitmap(file);
  if (!bitmap) return file; // undecodable — let the server/user deal with it

  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  if ("close" in bitmap) (bitmap as ImageBitmap).close();

  // If no resize was needed and the file already fits, keep the original.
  if (scale === 1 && file.size <= TARGET_BYTES) return file;

  let quality = 0.9;
  let blob = await toBlob(canvas, quality);
  while (blob && blob.size > TARGET_BYTES && quality > 0.4) {
    quality -= 0.1;
    blob = await toBlob(canvas, quality);
  }
  if (!blob) return file;

  const base = file.name.replace(/\.[^.]+$/, "") || "photo";
  return new File([blob], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}

function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  // Prefer createImageBitmap (fast, off-thread); fall back to <img>.
  if ("createImageBitmap" in window) {
    return createImageBitmap(file).catch(() => loadViaImg(file));
  }
  return loadViaImg(file);
}

function loadViaImg(file: File): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", quality));
}
