import { NextResponse } from "next/server";

import { validateImageFile } from "@/services/imageValidation";
import { parseJsonObject } from "@/services/jsonResponse";
import { getQwenClient, qwenVisionModel } from "@/services/qwenClient";
import { logApiError, logApiMetric } from "@/services/serverMonitoring";
import type { FaceAnalysisResult, FaceImageStatus } from "@/types/tcm";

const allowedStatuses: FaceImageStatus[] = [
  "no_face_detected",
  "poor_quality",
  "usable",
];

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function normalizeStatus(status: unknown): FaceImageStatus {
  const value = String(status || "");

  if (allowedStatuses.includes(value as FaceImageStatus)) {
    return value as FaceImageStatus;
  }

  return "poor_quality";
}

function parseFaceResponse(content: string): FaceAnalysisResult {
  const parsed = parseJsonObject<Partial<FaceAnalysisResult>>(content);
  const imageStatus = normalizeStatus(parsed.imageStatus);
  const fallback =
    imageStatus === "no_face_detected"
      ? "未识别到正面面部，请重新拍摄。"
      : imageStatus === "poor_quality"
        ? "图片模糊、过暗、过曝或面部遮挡较多，请重新拍摄。"
        : "图片可用于面象观察。";

  return {
    complexion: String(parsed.complexion || "无法判断"),
    eyeArea: String(parsed.eyeArea || "无法判断"),
    facialExpression: String(parsed.facialExpression || "无法判断"),
    imageQuality: String(parsed.imageQuality || fallback),
    imageStatus,
    lipColor: String(parsed.lipColor || "无法判断"),
    localColor: String(parsed.localColor || "无法判断"),
    luster: String(parsed.luster || "无法判断"),
    qualityMessage: String(parsed.qualityMessage || fallback),
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const formData = await request.formData();
    const face = formData.get("face");

    if (!(face instanceof File)) {
      logApiMetric({
        durationMs: Date.now() - startedAt,
        ok: false,
        route: "/api/tcm/face",
        status: 400,
      });
      return NextResponse.json(
        { error: "请提供一张正面面部照片。" },
        { status: 400 },
      );
    }

    validateImageFile(face, "面诊照片");

    const faceUrl = await fileToDataUrl(face);
    const completion = await getQwenClient().chat.completions.create({
      model: qwenVisionModel,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: [
            "你是一个谨慎的中医面象观察助手。",
            "你只做图片质量与面象观察，不做身份识别，不判断年龄性别，不做疾病诊断，不给治疗建议。",
            "必须严格输出 JSON 对象，不要 Markdown，不要代码块，不要额外解释。",
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                imageOrder: ["这是一张正面面部照片，用于观察面色、光泽、局部色泽、眼周、唇色和神态线索。"],
                outputSchema: {
                  complexion: "整体面色观察",
                  eyeArea: "眼周状态观察",
                  facialExpression: "神态线索观察",
                  imageQuality: "图片质量简述",
                  imageStatus: "no_face_detected | poor_quality | usable",
                  lipColor: "唇色观察",
                  localColor: "局部泛红、暗沉或色泽不均观察",
                  luster: "面部光泽观察",
                  qualityMessage: "给用户的重拍或可用提示",
                },
                rules: [
                  "如果未识别到正面面部或明显不是面部照片，imageStatus 必须是 no_face_detected。",
                  "如果能识别面部，但关键区域大面积模糊、严重过暗、严重过曝、强反光遮挡、口罩或遮挡物覆盖大部分面部，导致主要观察字段无法判断，imageStatus 才是 poor_quality。",
                  "不要追求证件照级完美。只要正面面部主体可见，轻微偏色、轻微阴影、轻微模糊、背景杂乱、角度略偏，都应判定为 usable，并在 imageQuality 中说明局限。",
                  "imageStatus 不是 usable 时，其他观察字段用“无法判断”，qualityMessage 要用一句话明确告诉用户重新拍摄的具体原因。",
                  "不要输出诊断结论，不要提证型，不要建议用药，不要识别身份或描述敏感身份属性。",
                ],
                task: "判断面诊图片是否可用于观察，并返回结构化面象观察。",
              }),
            },
            {
              type: "image_url",
              image_url: { url: faceUrl },
            },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseFaceResponse(content);

    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: true,
      route: "/api/tcm/face",
      status: 200,
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error("[face-analysis] FAILED", error);
    logApiError("/api/tcm/face", error);
    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: false,
      route: "/api/tcm/face",
      status: 500,
    });

    const message =
      process.env.NODE_ENV !== "production"
        ? `面诊分析失败: ${error instanceof Error ? error.message : String(error)}`
        : "Qwen 面诊分析失败，请稍后重试。";

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
