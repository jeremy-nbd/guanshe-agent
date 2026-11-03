import type { TongueAnalysisResult } from "@/types/tcm";
import { compressImage, validateImageFile } from "@/services/imageValidation";

type TongueImageFiles = {
  top: File;
  underside: File;
};

function validateImage(file: File, label: string) {
  validateImageFile(file, label);
}

export async function analyzeTongueImages({
  top,
  underside,
}: TongueImageFiles): Promise<TongueAnalysisResult> {
  validateImage(top, "舌面");
  validateImage(underside, "舌下");

  const [compressedTop, compressedUnderside] = await Promise.all([
    compressImage(top),
    compressImage(underside),
  ]);

  const formData = new FormData();
  formData.append("top", compressedTop);
  formData.append("underside", compressedUnderside);

  console.log("[tongue-analysis] Sending request...", {
    topSize: top.size,
    topType: top.type,
    undersideSize: underside.size,
    undersideType: underside.type,
  });

  let response: Response;
  try {
    response = await fetch("/api/tcm/tongue", {
      body: formData,
      method: "POST",
    });
  } catch (fetchError) {
    console.error("[tongue-analysis] Fetch failed:", fetchError);
    throw fetchError;
  }

  console.log("[tongue-analysis] Response:", response.status, response.statusText);

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    console.error("[tongue-analysis] API error:", data);
    throw new Error(data?.error || "舌象分析失败，请重新拍摄或上传图片。");
  }

  return (await response.json()) as TongueAnalysisResult;
}
