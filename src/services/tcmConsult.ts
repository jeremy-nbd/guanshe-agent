import type {
  ConsistencyCheckResponse,
  ContinueMultimodalChatRequest,
  ContinueChatRequest,
  FollowUpAnswerValue,
  FollowUpQuestion,
  MultimodalAnalyzeResponse,
  ModelCompareResponse,
  ResultCard,
  StartConsultationRequest,
  SubmitFollowUpRequest,
  TcmConsultService,
} from "@/types/tcm";

const mockFollowUpQuestions: FollowUpQuestion[] = [
  {
    allowOther: true,
    answerMode: "single",
    id: "duration",
    question: "这种情况大约持续了多久？",
    options: [
      "3 天以内",
      "1 周左右",
      "2 周以上",
      "反复超过 1 个月",
      "其他",
    ],
  },
  {
    allowOther: true,
    answerMode: "single",
    id: "appetite",
    question: "最近食欲如何？",
    options: ["正常", "食欲下降", "食欲增加", "时好时差"],
  },
  {
    allowOther: true,
    answerMode: "single",
    id: "digestion",
    question: "最近消化情况如何？",
    options: ["正常", "容易腹胀", "反酸嗳气", "大便不规律"],
  },
  {
    allowOther: true,
    answerMode: "single",
    id: "temperature",
    question: "平时更明显的是怕冷还是怕热？",
    options: ["怕冷", "怕热", "冷热都不明显", "手脚凉但口干"],
  },
  {
    answerMode: "multi",
    allowOther: true,
    exclusiveOptions: ["暂时没有其他明显不适"],
    id: "notes",
    question: "除了前面提到的情况，目前还有哪些想补充的不适？",
    options: ["乏力", "口干", "口苦", "睡眠浅", "暂时没有其他明显不适", "其他"],
  },
];

export function getDefaultFollowUpQuestions() {
  return mockFollowUpQuestions;
}

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function formatAnswerValue(value: FollowUpAnswerValue | undefined) {
  if (Array.isArray(value)) {
    return value.length > 0 ? value.join("、") : "未补充";
  }

  return value?.trim() || "未补充";
}

export async function startConsultation(
  request: StartConsultationRequest,
): Promise<FollowUpQuestion[]> {
  return tcmConsultService.startConsultation(request);
}

export async function submitFollowUp(
  request: SubmitFollowUpRequest,
): Promise<ResultCard[]> {
  return tcmConsultService.submitFollowUp(request);
}

export async function checkConsultationConsistency(
  request: SubmitFollowUpRequest,
): Promise<ConsistencyCheckResponse> {
  return tcmConsultService.checkConsultationConsistency(request);
}

export async function continueChat({
  question,
  previousMessages,
  resultCards,
}: ContinueChatRequest): Promise<string> {
  return tcmConsultService.continueChat({
    previousMessages,
    question,
    resultCards,
  });
}

export async function compareConsultationModels(
  request: SubmitFollowUpRequest,
  currentResultCards?: ResultCard[],
): Promise<ModelCompareResponse> {
  const response = await fetch("/api/tcm/compare", {
    body: JSON.stringify({ currentResultCards, request }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Model compare failed");
  }

  return (await response.json()) as ModelCompareResponse;
}

export async function analyzeMultimodalConsultation(
  request: SubmitFollowUpRequest,
  images: { face: File; tongueTop: File; tongueUnderside: File },
): Promise<MultimodalAnalyzeResponse> {
  const formData = new FormData();
  formData.append("payload", JSON.stringify(request));
  formData.append("tongueTop", images.tongueTop);
  formData.append("tongueUnderside", images.tongueUnderside);
  formData.append("face", images.face);

  const response = await fetch("/api/tcm/analyze-multimodal", {
    body: formData,
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Qwen multimodal analysis failed");
  }

  return (await response.json()) as MultimodalAnalyzeResponse;
}

export async function continueMultimodalChat(
  request: ContinueMultimodalChatRequest,
): Promise<string> {
  const response = await fetch("/api/tcm/chat-multimodal", {
    body: JSON.stringify(request),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error("Qwen multimodal chat failed");
  }

  const data = (await response.json()) as { answer: string };
  return data.answer;
}

const mockTcmConsultService: TcmConsultService = {
  async startConsultation(request) {
    void request;
    await wait(250);

    return mockFollowUpQuestions;
  },

  async checkConsultationConsistency(request) {
    void request;

    return {
      issues: [],
      needsClarification: false,
    };
  },

  async submitFollowUp({ observation, selectedSymptoms, followUpAnswers }) {
    await wait(1000);

    const symptoms =
      selectedSymptoms.length > 0
        ? `结合你选择的${selectedSymptoms.join("、")}等表现，`
        : "";
    const duration = formatAnswerValue(followUpAnswers.duration);
    const durationOther = formatAnswerValue(followUpAnswers.duration_other);
    const appetite = formatAnswerValue(followUpAnswers.appetite);
    const digestion = formatAnswerValue(followUpAnswers.digestion);
    const temperature = formatAnswerValue(followUpAnswers.temperature);
    const notes = formatAnswerValue(followUpAnswers.notes);
    const notesOther = formatAnswerValue(followUpAnswers.notes_other);
    const extraNotes =
      notes === "其他" && notesOther !== "未补充"
        ? `其他补充为“${notesOther}”`
        : notesOther !== "未补充"
          ? `${notes}；其他补充为“${notesOther}”`
          : notes;
    const tongueSummary = observation?.tongue
      ? `舌象观察：舌质${observation.tongue.tongueBodyColor}，舌苔${observation.tongue.tongueCoatColor}，${observation.tongue.tongueCoatThickness}，${observation.tongue.moisture}，${observation.tongue.sublingualVessels}。`
      : "暂未完成舌象观察。";
    const faceSummary = observation?.face
      ? `面象观察：${observation.face.complexion}，${observation.face.luster}，${observation.face.localColor}，${observation.face.lipColor}。`
      : "暂未完成面象观察。";

    return [
      {
        title: "症状理解",
        content: `${symptoms}持续时间为“${duration === "其他" && durationOther !== "未补充" ? durationOther : duration}”，当前信息显示食欲为“${appetite}”，消化情况为“${digestion}”，寒热感受为“${temperature}”。补充说明：${extraNotes === "未补充" ? "暂无额外补充" : extraNotes}。${tongueSummary}${faceSummary}`,
      },
      {
        title: "中医分析",
        content:
          "Mock 判断偏向以气机不畅、脾胃运化或睡眠节律受扰为主要线索，需结合后续真实问诊进一步辨证。",
      },
      {
        title: "调理建议",
        content:
          "建议先规律作息，晚间减少刺激性饮食和长时间用脑；饮食以温和清淡为主，观察 3 到 7 天变化。",
      },
      {
        title: "风险提示",
        content:
          "若出现持续加重、明显胸闷胸痛、高热、黑便、剧烈疼痛或影响日常功能，请及时线下就医。",
      },
    ];
  },

  async continueChat({ question }) {
    await wait(300);

    return `Mock 回复：已结合本次会诊结果理解你的问题“${question}”。当前建议仍以结果卡中的作息、饮食和风险提示为准；如果症状明显加重或出现风险提示中的情况，应优先线下就医。`;
  },
};

const qwenApiTcmConsultService: TcmConsultService = {
  async startConsultation(request) {
    const response = await fetch("/api/tcm/start", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Qwen start consultation failed");
    }

    const data = (await response.json()) as { questions: FollowUpQuestion[] };
    return data.questions;
  },

  async checkConsultationConsistency(request) {
    const response = await fetch("/api/tcm/consistency", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Qwen consistency check failed");
    }

    return (await response.json()) as ConsistencyCheckResponse;
  },

  async submitFollowUp(request) {
    const response = await fetch("/api/tcm/analyze", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Qwen analysis failed");
    }

    const data = (await response.json()) as { cards: ResultCard[] };
    return data.cards;
  },

  async continueChat(request) {
    const response = await fetch("/api/tcm/chat", {
      body: JSON.stringify(request),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error("Qwen chat failed");
    }

    const data = (await response.json()) as { answer: string };
    return data.answer;
  },
};

const tcmConsultService: TcmConsultService =
  ["dmx", "qwen"].includes(process.env.NEXT_PUBLIC_TCM_SERVICE_MODE ?? "")
    ? qwenApiTcmConsultService
    : mockTcmConsultService;
