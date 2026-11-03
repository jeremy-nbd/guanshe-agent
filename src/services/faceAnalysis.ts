import type { FaceAnalysisResult } from "@/types/tcm";
import { compressImage, validateImageFile } from "@/services/imageValidation";

function validateImage(file: File) {
  validateImageFile(file, "面诊照片");
}

export async function analyzeFaceImage(file: File): Promise<FaceAnalysisResult> {
  validateImage(file);

  const compressed = await compressImage(file);

  const formData = new FormData();
  formData.append("face", compressed);

  console.log("[face-analysis] Sending request...", {
    size: file.size,
    type: file.type,
  });

  let response: Response;
  try {
    response = await fetch("/api/tcm/face", {
      body: formData,
      method: "POST",
    });
  } catch (fetchError) {
    console.error("[face-analysis] Fetch failed:", fetchError);
    throw fetchError;
  }

  console.log("[face-analysis] Response:", response.status, response.statusText);

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    console.error("[face-analysis] API error:", data);
    throw new Error(data?.error || "面诊分析失败，请重新拍摄或上传图片。");
  }

  return (await response.json()) as FaceAnalysisResult;
}
