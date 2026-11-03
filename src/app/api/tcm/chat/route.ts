import { NextResponse } from "next/server";

import { getQwenClient, qwenModel } from "@/services/qwenClient";
import {
  buildChatUserPrompt,
  TCM_CHAT_SYSTEM_PROMPT,
} from "@/services/tcmPrompts";
import { logApiError, logApiMetric } from "@/services/serverMonitoring";
import { sanitizeUnsupportedObservationTerms } from "@/services/tcmTextSanitizer";
import type { ContinueChatRequest } from "@/types/tcm";

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as ContinueChatRequest;
    const completion = await getQwenClient().chat.completions.create({
      model: qwenModel,
      temperature: 0.4,
      messages: [
        {
          role: "system",
          content: TCM_CHAT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildChatUserPrompt(body),
        },
      ],
    });

    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: true,
      route: "/api/tcm/chat",
      status: 200,
    });

    return NextResponse.json({
      answer: sanitizeUnsupportedObservationTerms(
        completion.choices[0]?.message?.content ?? "",
      ),
    });
  } catch (error) {
    logApiError("/api/tcm/chat", error);
    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: false,
      route: "/api/tcm/chat",
      status: 500,
    });

    return NextResponse.json({ error: "Qwen chat failed" }, { status: 500 });
  }
}
