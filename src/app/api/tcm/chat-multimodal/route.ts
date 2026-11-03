import { NextResponse } from "next/server";

import { getQwenClient, qwenVisionModel } from "@/services/qwenClient";
import {
  buildMultimodalChatUserPrompt,
  TCM_MULTIMODAL_CHAT_SYSTEM_PROMPT,
} from "@/services/tcmPrompts";
import { sanitizeUnsupportedObservationTerms } from "@/services/tcmTextSanitizer";
import type { ContinueMultimodalChatRequest } from "@/types/tcm";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ContinueMultimodalChatRequest;
    const completion = await getQwenClient().chat.completions.create({
      model: qwenVisionModel,
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content: TCM_MULTIMODAL_CHAT_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildMultimodalChatUserPrompt(body),
        },
      ],
    });

    return NextResponse.json({
      answer: sanitizeUnsupportedObservationTerms(
        completion.choices[0]?.message?.content ?? "",
      ),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Qwen multimodal chat failed" },
      { status: 500 },
    );
  }
}
