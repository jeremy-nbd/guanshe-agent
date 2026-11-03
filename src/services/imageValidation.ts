const allowedImageMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const maxUploadSizeBytes = 8 * 1024 * 1024;

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.8;

export function isAllowedImageType(mimeType: string) {
  return allowedImageMimeTypes.includes(
    mimeType.toLowerCase() as (typeof allowedImageMimeTypes)[number],
  );
}

export function validateImageFile(file: File, label: string) {
  if (!file.type.startsWith("image/") || !isAllowedImageType(file.type)) {
    throw new Error(
      `${label}仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。`,
    );
  }

  if (file.size > maxUploadSizeBytes) {
    throw new Error(`${label}不能超过 8MB，请压缩后重新上传。`);
  }
}

export async function compressImage(file: File): Promise<File> {
  if (file.size < 200 * 1024) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;

  let newWidth = width;
  let newHeight = height;
  if (Math.max(width, height) > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    newWidth = Math.round(width * scale);
    newHeight = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, newWidth, newHeight);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });

  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), {
    type: "image/jpeg",
  });
}
