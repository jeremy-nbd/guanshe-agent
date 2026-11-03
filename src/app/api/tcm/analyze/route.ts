import { NextResponse } from "next/server";

import { parseAnalyzeResponse } from "@/services/tcmAnalyzeResponse";
import { getQwenClient, qwenModel } from "@/services/qwenClient";
import { retrieveTcmKnowledge } from "@/services/tcmRag";
import {
  buildAnalyzeUserPrompt,
  TCM_ANALYZE_SYSTEM_PROMPT,
} from "@/services/tcmPrompts";
import { logApiError, logApiMetric } from "@/services/serverMonitoring";
import type { SubmitFollowUpRequest } from "@/types/tcm";

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as SubmitFollowUpRequest;

    // RAG: retrieve TCM knowledge for chief complaint and symptoms
    const { referenceText } = retrieveTcmKnowledge({
      chiefComplaint: body.chiefComplaint,
      selectedSymptoms: body.selectedSymptoms || [],
      selectedTopic: body.selectedTopic ?? undefined,
    });

    const completion = await getQwenClient().chat.completions.create({
      model: qwenModel,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: TCM_ANALYZE_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildAnalyzeUserPrompt(body, referenceText || undefined),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseAnalyzeResponse(content, body.selectedSymptoms);

    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: true,
      route: "/api/tcm/analyze",
      status: 200,
    });

    return NextResponse.json(data);
  } catch (error) {
    logApiError("/api/tcm/analyze", error);
    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: false,
      route: "/api/tcm/analyze",
      status: 500,
    });

    return NextResponse.json(
      { error: "Qwen analysis failed" },
      { status: 500 },
    );
  }
}
