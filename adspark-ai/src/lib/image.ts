export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8 MB

export interface LoadedImage {
  dataUrl: string;
  element: HTMLImageElement;
  name: string;
}

export type ImageResult = { ok: true; image: LoadedImage } | { ok: false; error: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("bad result")));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode failed"));
    img.src = src;
  });
}

/** Validates and decodes an uploaded file. Never throws. */
export async function processImageFile(file: File | null | undefined): Promise<ImageResult> {
  if (!file) return { ok: false, error: "No file was selected." };
  if (!ACCEPTED_TYPES.includes(file.type)) {
    return { ok: false, error: "Please upload a JPG, PNG or WEBP image." };
  }
  if (file.size === 0) return { ok: false, error: "That file is empty. Please choose another image." };
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: "That image is larger than 8 MB. Please choose a smaller one." };
  }
  try {
    const dataUrl = await readAsDataUrl(file);
    const element = await loadImageElement(dataUrl);
    if (!element.naturalWidth || !element.naturalHeight) throw new Error("no size");
    return { ok: true, image: { dataUrl, element, name: file.name } };
  } catch {
    return { ok: false, error: "We couldn't read that image. It may be damaged — please try a different one." };
  }
}
