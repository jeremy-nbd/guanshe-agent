import { NextResponse } from "next/server";

import { parseAnalyzeResponse } from "@/services/tcmAnalyzeResponse";
import { getQwenClient, qwenModel } from "@/services/qwenClient";
import {
  buildAnalyzeUserPrompt,
  TCM_ANALYZE_SYSTEM_PROMPT,
} from "@/services/tcmPrompts";
import type {
  ModelCompareRequest,
  ModelCompareResult,
  ResultCard,
  SubmitFollowUpRequest,
} from "@/types/tcm";

const maxCompareModels = 4;

function getCompareModels() {
  const configuredModels = process.env.DMX_COMPARE_TEXT_MODELS?.split(",")
    .map((model) => model.trim())
    .filter(Boolean);

  const models =
    configuredModels && configuredModels.length > 0
      ? configuredModels
      : [qwenModel];

  return Array.from(new Set(models)).slice(0, maxCompareModels);
}

async function compareModel(
  model: string,
  request: SubmitFollowUpRequest,
  currentResultCards?: ResultCard[],
): Promise<ModelCompareResult> {
  const startedAt = Date.now();

  if (model === qwenModel && currentResultCards && currentResultCards.length > 0) {
    return {
      cards: currentResultCards,
      latencyMs: 0,
      model,
      ok: true,
    };
  }

  try {
    const completion = await getQwenClient().chat.completions.create({
      model,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: TCM_ANALYZE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildAnalyzeUserPrompt(request),
        },
      ],
    });
    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseAnalyzeResponse(content, request.selectedSymptoms);

    return {
      cards: data.cards,
      latencyMs: Date.now() - startedAt,
      model,
      ok: true,
    };
  } catch (error) {
    return {
      cards: [],
      error: error instanceof Error ? error.message : "模型调用失败",
      latencyMs: Date.now() - startedAt,
      model,
      ok: false,
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ModelCompareRequest;

    if (!body.request) {
      return NextResponse.json(
        { error: "Missing compare request" },
        { status: 400 },
      );
    }

    const results = await Promise.all(
      getCompareModels().map((model) =>
        compareModel(model, body.request, body.currentResultCards),
      ),
    );

    return NextResponse.json({ results });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Model compare failed" },
      { status: 500 },
    );
  }
}
