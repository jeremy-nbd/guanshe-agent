import { NextResponse } from "next/server";

import { parseJsonObject } from "@/services/jsonResponse";
import { parseAnalyzeResponse } from "@/services/tcmAnalyzeResponse";
import { getQwenClient, qwenVisionModel } from "@/services/qwenClient";
import { retrieveTcmKnowledge } from "@/services/tcmRag";
import { TCM_MULTIMODAL_ANALYZE_SYSTEM_PROMPT } from "@/services/tcmPrompts";
import type {
  MultimodalAnalyzeResponse,
  SubmitFollowUpRequest,
} from "@/types/tcm";

async function fileToDataUrl(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "image/jpeg";

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

function parseMultimodalAnalyzeResponse(
  content: string,
  selectedSymptoms: string[],
): MultimodalAnalyzeResponse {
  const parsed = parseJsonObject<
    Partial<MultimodalAnalyzeResponse> & { cards?: unknown[] }
  >(content);
  const cardsContent = JSON.stringify({
    cards: Array.isArray(parsed.cards) ? parsed.cards : [],
  });
  const cards = parseAnalyzeResponse(cardsContent, selectedSymptoms).cards;
  const observationSummary = String(parsed.observationSummary ?? "").trim();

  if (!observationSummary) {
    throw new Error(
      "Invalid multimodal analysis response: missing observationSummary",
    );
  }

  return {
    cards,
    observationSummary,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const payload = formData.get("payload");
    const tongueTop = formData.get("tongueTop");
    const tongueUnderside = formData.get("tongueUnderside");
    const face = formData.get("face");

    if (typeof payload !== "string") {
      return NextResponse.json(
        { error: "Missing multimodal payload." },
        { status: 400 },
      );
    }

    if (
      !(tongueTop instanceof File) ||
      !(tongueUnderside instanceof File) ||
      !(face instanceof File)
    ) {
      return NextResponse.json(
        { error: "请同时提供舌面、舌下和面部照片。" },
        { status: 400 },
      );
    }

    const body = JSON.parse(payload) as SubmitFollowUpRequest;

    // RAG: retrieve TCM knowledge
    const { referenceText } = retrieveTcmKnowledge({
      chiefComplaint: body.chiefComplaint,
      selectedSymptoms: body.selectedSymptoms || [],
      selectedTopic: body.selectedTopic ?? undefined,
    });

    const tongueTopUrl = await fileToDataUrl(tongueTop);
    const tongueUndersideUrl = await fileToDataUrl(tongueUnderside);
    const faceUrl = await fileToDataUrl(face);

    const multimodalRules = [
      "只返回 JSON 对象，顶层必须包含 cards 和 observationSummary。",
      "cards 必须包含且只包含四张卡：症状理解、中医分析、调理建议、风险提示。",
      "症状理解要把主诉、用户选择的症状表现、补充问诊、舌象观察和面象观察自然串联起来。",
      "如果 input.selectedSymptoms 不为空，要把这些症状自然融入句子；不要写“症状标签：”“已选症状：”这类机械标签。",
      "如果 input.selectedSymptoms 为空，不要提“未选择症状”。",
      "分析只能基于当前问诊与望诊线索展开，不要写“四诊合参”“望闻问切”“结合切诊”“结合闻诊”等表述。",
      "中医分析可以描述证候倾向，但要基于当前问诊、舌象和面象线索直接分析，不要写自我免责声明。",
      "不要写“需线下医生结合动态问诊进一步辨证”“不可单凭舌面或面色定论”“仅供参考不能替代医生”等降低专业感的套话。",
      "不要写“结合脉诊、腹诊、脉象、切脉、把脉、按腹、腹部按诊”等内容；需要表达不确定性时，用“目前更偏向、可考虑、建议继续观察变化”等自然表述。",
      "调理建议要温和、可执行，优先作息、饮食、情绪、运动等低风险建议。",
      "风险提示必须明确说明哪些情况需要线下就医。",
      "observationSummary 只总结这次望诊与问诊里相对稳定的观察线索，后续追问会复用，不要写图片质量提示，不要写重新分析图片。",
    ];

    if (referenceText) {
      multimodalRules.push(
        "ragReference 是从中医知识库中检索到的相关症状、疾病、药膳食疗、穴位按摩资料。",
        "中医分析可以参考 ragReference 中的症状和疾病描述来加深分析，但最终结论要结合当前用户的实际信息。",
        "调理建议应优先参考 ragReference 中的药膳食疗和穴位按摩建议，选择与用户具体情况最匹配的 1-2 条，具体说明食材、做法或穴位按压方法。",
        "引用 ragReference 中的内容时，要用你自己的话自然融入，不要写“根据知识库”“参考显示”这类机械表述。",
      );
    }

    const userPayload: Record<string, unknown> = {
      input: body,
      outputSchema: {
        cards: [
          { title: "症状理解", content: "string" },
          { title: "中医分析", content: "string" },
          { title: "调理建议", content: "string" },
          { title: "风险提示", content: "string" },
        ],
        observationSummary: "一句到两句，概括本次望诊观察到的稳定线索，供后续追问沿用。",
      },
      rules: multimodalRules,
      task: "结合主诉、补充问诊和提供的舌象/面象图片，直接生成结构化中医会诊结果。",
    };

    if (referenceText) {
      userPayload.ragReference = referenceText;
    }

    const completion = await getQwenClient().chat.completions.create({
      model: qwenVisionModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: TCM_MULTIMODAL_ANALYZE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify(userPayload),
            },
            { type: "image_url", image_url: { url: tongueTopUrl } },
            { type: "image_url", image_url: { url: tongueUndersideUrl } },
            { type: "image_url", image_url: { url: faceUrl } },
          ],
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseMultimodalAnalyzeResponse(content, body.selectedSymptoms);

    return NextResponse.json(data);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Qwen multimodal analysis failed" },
      { status: 500 },
    );
  }
}
