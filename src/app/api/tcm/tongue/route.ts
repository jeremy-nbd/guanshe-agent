import { NextResponse } from "next/server";

import { validateImageFile } from "@/services/imageValidation";
import { parseJsonObject } from "@/services/jsonResponse";
import { getQwenClient, qwenVisionModel } from "@/services/qwenClient";
import { logApiError, logApiMetric } from "@/services/serverMonitoring";
import type { TongueAnalysisResult, TongueImageStatus } from "@/types/tcm";

const allowedStatuses: TongueImageStatus[] = [
  "no_tongue_detected",
  "poor_quality",
  "usable",
];

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeStatus(status: unknown): TongueImageStatus {
  const value = String(status || "");

  if (allowedStatuses.includes(value as TongueImageStatus)) {
    return value as TongueImageStatus;
  }

  return "poor_quality";
}

function parseTongueResponse(content: string): TongueAnalysisResult {
  const parsed = parseJsonObject<Partial<TongueAnalysisResult>>(content);
  const imageStatus = normalizeStatus(parsed.imageStatus);
  const fallback =
    imageStatus === "no_tongue_detected"
      ? "未识别到完整舌体，请重新拍摄舌面和舌下照片。"
      : imageStatus === "poor_quality"
        ? "图片模糊、过暗、过曝或舌体不完整，请重新拍摄。"
        : "图片可用于舌象观察。";

  return {
    cracks: String(parsed.cracks || "无法判断"),
    imageQuality: String(parsed.imageQuality || fallback),
    imageStatus,
    moisture: String(parsed.moisture || "无法判断"),
    qualityMessage: String(parsed.qualityMessage || fallback),
    sublingualVessels: String(parsed.sublingualVessels || "无法判断"),
    teethMarks: String(parsed.teethMarks || "无法判断"),
    tongueBodyColor: String(parsed.tongueBodyColor || "无法判断"),
    tongueCoatColor: String(parsed.tongueCoatColor || "无法判断"),
    tongueCoatThickness: String(parsed.tongueCoatThickness || "无法判断"),
    tongueShape: String(parsed.tongueShape || "无法判断"),
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const formData = await request.formData();
    const top = formData.get("top");
    const underside = formData.get("underside");

    if (!(top instanceof File) || !(underside instanceof File)) {
      logApiMetric({
        durationMs: Date.now() - startedAt,
        ok: false,
        route: "/api/tcm/tongue",
        status: 400,
      });
      return NextResponse.json(
        { error: "请同时提供舌面和舌下两张图片。" },
        { status: 400 },
      );
    }

    validateImageFile(top, "舌面照片");
    validateImageFile(underside, "舌下照片");

    const topUrl = await fileToDataUrl(top);
    const undersideUrl = await fileToDataUrl(underside);
    const completion = await getQwenClient().chat.completions.create({
      model: qwenVisionModel,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "你是一个谨慎的中医舌象观察助手。",
            "你只做图片质量与舌象观察，不做疾病诊断，不给治疗建议。",
            "必须严格输出 JSON 对象，不要 Markdown，不要代码块，不要额外解释。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                imageOrder: [
                  "第一张是舌面照片，用于观察舌质、舌苔、齿痕、裂纹、润燥。",
                  "第二张是舌下照片，用于观察舌下络脉。",
                ],
                outputSchema: {
                  cracks: "裂纹观察",
                  imageQuality: "图片质量简述",
                  imageStatus:
                    "no_tongue_detected | poor_quality | usable",
                  moisture: "润燥状态",
                  qualityMessage: "给用户的重拍或可用提示",
                  sublingualVessels: "舌下络脉观察",
                  teethMarks: "齿痕观察",
                  tongueBodyColor: "舌质颜色",
                  tongueCoatColor: "舌苔颜色",
                  tongueCoatThickness: "舌苔厚薄",
                  tongueShape: "舌体形态",
                },
                rules: [
                  "如果任一图片未识别到舌体或明显不是舌象图片，imageStatus 必须是 no_tongue_detected。",
                  "如果能识别舌体，但关键区域大面积模糊、严重过暗、严重过曝、强反光遮挡、舌体主体缺失，导致主要观察字段无法判断，imageStatus 才是 poor_quality。",
                  "不要追求医学摄影级完美。只要舌面主体或舌下络脉主体可见，轻微偏色、轻微阴影、轻微模糊、背景杂乱、角度不完全标准，都应判定为 usable，并在 imageQuality 中说明局限。",
                  "舌下照片只要能看到舌下区域和部分络脉即可 usable，不要因为角度不完全标准就退回。",
                  "imageStatus 不是 usable 时，其他观察字段用“无法判断”，qualityMessage 要用一句话明确告诉用户重新拍摄的具体原因。",
                  "不要输出诊断结论，不要提证型，不要建议用药。",
                ],
                task: "判断舌象图片是否可用于观察，并返回结构化舌象观察。",
              }),
            },
            {
              type: "image_url",
              image_url: { url: topUrl },
            },
            {
              type: "image_url",
              image_url: { url: undersideUrl },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseTongueResponse(content);

    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: true,
      route: "/api/tcm/tongue",
      status: 200,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[tongue-analysis] FAILED", error);
    logApiError("/api/tcm/tongue", error);
    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: false,
      route: "/api/tcm/tongue",
      status: 500,
    });

    const message =
      process.env.NODE_ENV !== "production"
        ? `舌象分析失败: ${error instanceof Error ? error.message : String(error)}`
        : "Qwen 舌象分析失败，请稍后重试。";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
