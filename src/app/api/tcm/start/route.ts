import { NextResponse } from "next/server";

import { parseJsonObject } from "@/services/jsonResponse";
import { getQwenClient, qwenModel } from "@/services/qwenClient";
import {
  buildStartUserPrompt,
  TCM_START_SYSTEM_PROMPT,
} from "@/services/tcmPrompts";
import { logApiError, logApiMetric } from "@/services/serverMonitoring";
import type { FollowUpQuestion, StartConsultationRequest } from "@/types/tcm";

type StartResponse = {
  questions: FollowUpQuestion[];
};

function normalizeOptions(options: string[]) {
  const normalized = options.map((option) => option.trim()).filter(Boolean);

  if (normalized.length === 0 || normalized.includes("其他")) {
    return normalized;
  }

  return [...normalized, "其他"];
}

function normalizeExclusiveOptions(options: string[] | undefined) {
  if (!Array.isArray(options)) {
    return [];
  }

  return options.map((option) => option.trim()).filter(Boolean);
}

function parseStartResponse(content: string): StartResponse {
  const parsed = parseJsonObject<Partial<StartResponse>>(content);

  if (!Array.isArray(parsed.questions)) {
    throw new Error("Invalid Qwen start response: missing questions");
  }

  const questions = parsed.questions
    .map((question, index) => ({
      allowOther:
        question.allowOther === undefined ? true : Boolean(question.allowOther),
      answerMode:
        question.answerMode === "multi"
          ? ("multi" as const)
          : ("single" as const),
      exclusiveOptions: normalizeExclusiveOptions(question.exclusiveOptions),
      id: String(question.id || `question_${index + 1}`),
      maxSelections:
        typeof question.maxSelections === "number" &&
        question.maxSelections > 0
          ? Math.floor(question.maxSelections)
          : undefined,
      question: String(question.question || ""),
      options: Array.isArray(question.options)
        ? normalizeOptions(question.options.map((option) => String(option)))
        : [],
    }))
    .filter((question) => question.id && question.question)
    .slice(0, 6);

  if (questions.length === 0) {
    throw new Error("Invalid Qwen start response: empty questions");
  }

  return { questions };
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as StartConsultationRequest;
    const completion = await getQwenClient().chat.completions.create({
      model: qwenModel,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: TCM_START_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildStartUserPrompt(body),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseStartResponse(content);

    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: true,
      route: "/api/tcm/start",
      status: 200,
    });

    return NextResponse.json(data);
  } catch (error) {
    logApiError("/api/tcm/start", error);
    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: false,
      route: "/api/tcm/start",
      status: 500,
    });

    return NextResponse.json(
      { error: "Qwen start consultation failed" },
      { status: 500 },
    );
  }
}
