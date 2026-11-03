import { NextResponse } from "next/server";

import { parseJsonObject } from "@/services/jsonResponse";
import { getQwenClient, qwenModel } from "@/services/qwenClient";
import {
  buildConsistencyUserPrompt,
  TCM_CONSISTENCY_SYSTEM_PROMPT,
} from "@/services/tcmPrompts";
import { logApiError, logApiMetric } from "@/services/serverMonitoring";
import type {
  ConsistencyCheckResponse,
  ConsistencyIssue,
  SubmitFollowUpRequest,
} from "@/types/tcm";

const maxConsistencyIssues = 3;

const consistencyFieldReplacements: Array<[RegExp, string]> = [
  [/'?appetite'?/gi, "食欲情况"],
  [/'?sleep'?/gi, "睡眠情况"],
  [/'?digestion'?/gi, "消化情况"],
  [/'?temperature'?/gi, "寒热感受"],
  [/'?emotion'?/gi, "情绪状态"],
  [/'?course'?/gi, "持续时间"],
  [/'?followUpAnswers'?/gi, "补充问诊"],
  [/'?selectedSymptoms'?/gi, "已选症状"],
  [/'?chiefComplaint'?/gi, "主诉"],
  [/'?selectedTopic'?/gi, "当前场景"],
];

function sanitizeConsistencyText(text: string) {
  const normalized = consistencyFieldReplacements.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );

  return normalized
    .replace(/[`"'“”‘’]/g, "")
    .replace(/\b[a-zA-Z_][a-zA-Z0-9_.]*\b/g, (token) => {
      if (/^(AI|TCM)$/i.test(token)) {
        return token;
      }

      if (/[A-Z]/.test(token) || token.includes("_") || token.includes(".")) {
        return "";
      }

      return token;
    })
    .replace(/\s*:\s*/g, "：")
    .replace(/\s{2,}/g, " ")
    .replace(/（\s*）/g, "")
    .replace(/\(\s*\)/g, "")
    .trim();
}

function normalizeOptions(options: string[]) {
  const normalized = options
    .map((option) => sanitizeConsistencyText(option).trim())
    .filter(Boolean);

  if (normalized.includes("其他")) {
    return normalized;
  }

  return [...normalized, "其他"];
}

function getIssueTopic(issue: ConsistencyIssue) {
  const text = `${issue.id} ${issue.message}`;

  if (/寒|热|冷|温度|手脚/.test(text)) {
    return "temperature";
  }

  if (/食欲|胃口|吃饭/.test(text)) {
    return "appetite";
  }

  if (/消化|腹胀|反酸|嗳气|大便|二便/.test(text)) {
    return "digestion";
  }

  if (/睡|眠|醒|梦/.test(text)) {
    return "sleep";
  }

  if (/情绪|压力|烦|怒|焦虑/.test(text)) {
    return "emotion";
  }

  return issue.id || issue.message;
}

function parseConsistencyResponse(content: string): ConsistencyCheckResponse {
  const parsed = parseJsonObject<Partial<ConsistencyCheckResponse>>(content);
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const seenTopics = new Set<string>();

  const issues: ConsistencyIssue[] = rawIssues
    .map((issue, index) => ({
      id: String(issue.id || `issue_${index + 1}`),
      message: sanitizeConsistencyText(String(issue.message || "")),
      options: Array.isArray(issue.options)
        ? normalizeOptions(issue.options.map((option) => String(option)))
        : [],
    }))
    .filter((issue) => issue.message && issue.options.length > 0)
    .filter((issue) => {
      const topic = getIssueTopic(issue);

      if (seenTopics.has(topic)) {
        return false;
      }

      seenTopics.add(topic);
      return true;
    })
    .slice(0, maxConsistencyIssues);

  return {
    issues,
    needsClarification: Boolean(parsed.needsClarification) && issues.length > 0,
  };
}

export async function POST(request: Request) {
  const startedAt = Date.now();

  try {
    const body = (await request.json()) as SubmitFollowUpRequest;
    const completion = await getQwenClient().chat.completions.create({
      model: qwenModel,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: TCM_CONSISTENCY_SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: buildConsistencyUserPrompt(body),
        },
      ],
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const data = parseConsistencyResponse(content);

    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: true,
      route: "/api/tcm/consistency",
      status: 200,
    });

    return NextResponse.json(data);
  } catch (error) {
    logApiError("/api/tcm/consistency", error);
    logApiMetric({
      durationMs: Date.now() - startedAt,
      ok: false,
      route: "/api/tcm/consistency",
      status: 500,
    });

    return NextResponse.json(
      { error: "Qwen consistency check failed" },
      { status: 500 },
    );
  }
}
