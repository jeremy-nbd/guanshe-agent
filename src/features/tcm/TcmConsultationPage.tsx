"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";

import {
  analyzeMultimodalConsultation,
  checkConsultationConsistency,
  compareConsultationModels,
  continueMultimodalChat,
  continueChat,
  startConsultation,
  submitFollowUp,
} from "@/services/tcmConsult";
import { analyzeFaceImage } from "@/services/faceAnalysis";
import { validateImageFile } from "@/services/imageValidation";
import { getSafeUserErrorMessage, reportFrontendEvent } from "@/services/monitoring";
import { analyzeTongueImages } from "@/services/tongueAnalysis";
import type {
  ChatMessage,
  ConsultationHistoryItem,
  ConsistencyIssue as AiConsistencyIssue,
  FaceAnalysisResult,
  FollowUpAnswerValue,
  FollowUpQuestion,
  ModelCompareResult,
  ObservationState,
  ResultCard,
  SubmitFollowUpRequest,
  TongueAnalysisResult,
} from "@/types/tcm";

const consultationScenarios = [
  {
    description: "入睡难、易醒、白天乏力",
    icon: "眠",
    prompt: "我想咨询睡眠调理，主要情况是：",
    title: "睡眠调理",
  },
  {
    description: "腹胀、食欲差、饭后不适",
    icon: "胃",
    prompt: "我想咨询脾胃不适，主要情况是：",
    title: "脾胃不适",
  },
  {
    description: "长期紧张、疲劳、情绪波动",
    icon: "气",
    prompt: "我想咨询压力疲劳，主要情况是：",
    title: "压力疲劳",
  },
  {
    description: "周期、手脚凉、睡眠与气色",
    icon: "养",
    prompt: "我想咨询女性调理，主要情况是：",
    title: "女性调理",
  },
  {
    description: "肩颈紧、酸痛、久坐不适",
    icon: "筋",
    prompt: "我想咨询肩颈酸痛，主要情况是：",
    title: "肩颈酸痛",
  },
  {
    description: "以上都不合适，直接描述情况",
    icon: "其",
    prompt: "",
    title: "其他",
  },
];

const symptomTags = [
  "怕冷",
  "口干",
  "乏力",
  "腹胀",
  "头晕",
  "失眠",
  "易怒",
  "食欲差",
];

const placeholderResultCards: ResultCard[] = [
  {
    title: "症状理解",
    content: "综合主诉、症状表现与问诊信息，梳理症状特征与关联。",
  },
  {
    title: "中医分析",
    content: "从气血、阴阳、脏腑、六淫等角度分析证候倾向与病机。",
  },
  {
    title: "调理建议",
    content: "提供饮食、作息、情绪、运动等低风险日常调理方案。",
  },
  {
    title: "风险提示",
    content: "标注需警惕的健康风险信号及线下就医指征。",
  },
];

const tongueObservationFields: Array<{
  key: keyof TongueAnalysisResult;
  label: string;
}> = [
  { key: "tongueBodyColor", label: "舌质颜色" },
  { key: "tongueCoatColor", label: "舌苔颜色" },
  { key: "tongueCoatThickness", label: "舌苔厚薄" },
  { key: "tongueShape", label: "舌体形态" },
  { key: "teethMarks", label: "齿痕" },
  { key: "cracks", label: "裂纹" },
  { key: "moisture", label: "润燥状态" },
  { key: "sublingualVessels", label: "舌下络脉" },
];

const faceObservationFields: Array<{
  key: keyof FaceAnalysisResult;
  label: string;
}> = [
  { key: "complexion", label: "整体面色" },
  { key: "luster", label: "面部光泽" },
  { key: "localColor", label: "局部色泽" },
  { key: "eyeArea", label: "眼周状态" },
  { key: "lipColor", label: "唇色" },
  { key: "facialExpression", label: "神态线索" },
];

type TongueImageSlot = "top" | "underside";

type TongueImageItem = {
  file: File | null;
  name: string;
  preview: string | null;
};

type LocalConsistencyIssue = {
  id: string;
  message: string;
  actions: Array<{
    id: string;
    label: string;
  }>;
};

const consultationHistoryStorageKey = "bitwins_tcm_consultation_history_v1";
const maxConsultationHistoryItems = 10;

function ItwinsAvatar() {
  return (
    <div className="flex h-10 min-w-16 shrink-0 items-center justify-center rounded-full bg-white px-3 text-xs font-semibold uppercase tracking-[0.04em] text-[#866237] shadow-sm">
      itwins
    </div>
  );
}

function renderRichText(content: string) {
  const lines = content.split("\n");

  return lines.map((line, lineIndex) => {
    const parts = line.split(/(\*\*[^*]+\*\*)/g);

    return (
      <span key={`line-${lineIndex}`}>
        {parts.map((part, partIndex) =>
          part.startsWith("**") && part.endsWith("**") ? (
            <strong className="font-semibold" key={`${lineIndex}-${partIndex}`}>
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span key={`${lineIndex}-${partIndex}`}>{part}</span>
          ),
        )}
        {lineIndex < lines.length - 1 ? <br /> : null}
      </span>
    );
  });
}

function revokeObjectUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}

function readConsultationHistory(): ConsultationHistoryItem[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawHistory = window.localStorage.getItem(consultationHistoryStorageKey);

    if (!rawHistory) {
      return [];
    }

    const parsed = JSON.parse(rawHistory);
    return Array.isArray(parsed) ? (parsed as ConsultationHistoryItem[]) : [];
  } catch {
    return [];
  }
}

function writeConsultationHistory(history: ConsultationHistoryItem[]) {
  window.localStorage.setItem(
    consultationHistoryStorageKey,
    JSON.stringify(history.slice(0, maxConsultationHistoryItems)),
  );
}

function formatHistoryTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function getAnswerArray(value: FollowUpAnswerValue | undefined) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function getAnswerText(value: FollowUpAnswerValue | undefined) {
  if (Array.isArray(value)) {
    return value.join("、");
  }

  return value ?? "";
}

export function TcmConsultationPage() {
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [followUpAnswers, setFollowUpAnswers] = useState<
    Record<string, FollowUpAnswerValue>
  >({});
  const [followUpQuestions, setFollowUpQuestions] = useState<
    FollowUpQuestion[]
  >([]);
  const [activeFollowUpIndex, setActiveFollowUpIndex] = useState(0);
  const [followUpDrafts, setFollowUpDrafts] = useState<Record<string, string>>(
    {},
  );
  const [hasStarted, setHasStarted] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingFollowUps, setIsGeneratingFollowUps] = useState(false);
  const [resultCards, setResultCards] = useState<ResultCard[] | null>(null);
  const [multimodalResultCards, setMultimodalResultCards] = useState<
    ResultCard[] | null
  >(null);
  const [multimodalObservationSummary, setMultimodalObservationSummary] =
    useState<string | null>(null);
  const [multimodalChatMessages, setMultimodalChatMessages] = useState<
    ChatMessage[]
  >([]);
  const [isAnalyzingMultimodal, setIsAnalyzingMultimodal] = useState(false);
  const [isMultimodalChatting, setIsMultimodalChatting] = useState(false);
  const [compareResults, setCompareResults] = useState<ModelCompareResult[]>(
    [],
  );
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [isMultimodalCompareOpen, setIsMultimodalCompareOpen] =
    useState(false);
  const [consultationHistory, setConsultationHistory] = useState<
    ConsultationHistoryItem[]
  >(() => readConsultationHistory());
  const [activeHistoryId, setActiveHistoryId] = useState<string | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState(false);
  const [isCheckingConsistency, setIsCheckingConsistency] = useState(false);
  const [aiConsistencyIssues, setAiConsistencyIssues] = useState<
    AiConsistencyIssue[]
  >([]);
  const [aiConsistencyDrafts, setAiConsistencyDrafts] = useState<
    Record<string, string>
  >({});
  const [hasResolvedAiConsistencyRound, setHasResolvedAiConsistencyRound] =
    useState(false);
  const [tongueImages, setTongueImages] = useState<
    Record<TongueImageSlot, TongueImageItem>
  >({
    top: { file: null, name: "", preview: null },
    underside: { file: null, name: "", preview: null },
  });
  const [tongueAnalysisState, setTongueAnalysisState] =
    useState<ObservationState>("idle");
  const [tongueAnalysis, setTongueAnalysis] =
    useState<TongueAnalysisResult | null>(null);
  const [tongueError, setTongueError] = useState<string | null>(null);
  const [faceImage, setFaceImage] = useState<TongueImageItem>({
    file: null,
    name: "",
    preview: null,
  });
  const [faceAnalysisState, setFaceAnalysisState] =
    useState<ObservationState>("idle");
  const [faceAnalysis, setFaceAnalysis] = useState<FaceAnalysisResult | null>(
    null,
  );
  const [faceError, setFaceError] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const analysisRunId = useRef(0);
  const nextChatId = useRef(1);
  const autoComplaintRef = useRef("");

  const canStart = useMemo(
    () => chiefComplaint.trim().length > 0 || selectedSymptoms.length > 0,
    [chiefComplaint, selectedSymptoms.length],
  );

  const isTongueAnalysisComplete =
    tongueAnalysisState === "success" && tongueAnalysis?.imageStatus === "usable";
  const isFaceAnalysisComplete =
    faceAnalysisState === "success" && faceAnalysis?.imageStatus === "usable";
  const isObservationComplete =
    isTongueAnalysisComplete && isFaceAnalysisComplete;

  function isFollowUpAnswered(question: FollowUpQuestion) {
    const answer = followUpAnswers[question.id];
    const answers = getAnswerArray(answer);

    if (answers.length === 0) {
      return false;
    }

    if (answers.includes("其他")) {
      return Boolean(getAnswerText(followUpAnswers[`${question.id}_other`]).trim());
    }

    return true;
  }

  const answeredFollowUps = useMemo(
    () => followUpQuestions.filter(isFollowUpAnswered).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followUpAnswers, followUpQuestions],
  );

  const requiredFollowUpQuestions = useMemo(
    () => followUpQuestions.filter((question) => question.options.length > 0),
    [followUpQuestions],
  );

  const answeredRequiredFollowUps = useMemo(
    () => requiredFollowUpQuestions.filter(isFollowUpAnswered).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [followUpAnswers, requiredFollowUpQuestions],
  );

  const canSubmitFollowUp = useMemo(
    () =>
      canStart &&
      requiredFollowUpQuestions.length > 0 &&
      answeredRequiredFollowUps === requiredFollowUpQuestions.length &&
      activeFollowUpIndex >= followUpQuestions.length &&
      isObservationComplete,
    [
      activeFollowUpIndex,
      answeredRequiredFollowUps,
      canStart,
      followUpQuestions.length,
      isObservationComplete,
      requiredFollowUpQuestions.length,
    ],
  );

  const activeFollowUpQuestion = followUpQuestions[activeFollowUpIndex] ?? null;
  const displayResultCards = resultCards?.filter(
    (card) => card.title !== "会诊摘要",
  );
  const displayMultimodalResultCards = multimodalResultCards?.filter(
    (card) => card.title !== "会诊摘要",
  );
  const standardUserMessages = chatMessages.filter(
    (message) => message.role === "user",
  );
  const standardAssistantMessages = chatMessages.filter(
    (message) => message.role === "assistant",
  );
  const multimodalAssistantMessages = multimodalChatMessages.filter(
    (message) => message.role === "assistant",
  );

  useEffect(() => {
    return () => {
      Object.values(tongueImages).forEach((image) => {
        revokeObjectUrl(image.preview);
      });
      revokeObjectUrl(faceImage.preview);
    };
  }, [faceImage.preview, tongueImages]);

  useEffect(() => {
    function handleWindowError(event: ErrorEvent) {
      void reportFrontendEvent({
        details: {
          colno: event.colno,
          filename: event.filename,
          lineno: event.lineno,
        },
        message: event.message || "unknown_window_error",
        type: "frontend_error",
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const message =
        event.reason instanceof Error
          ? event.reason.message
          : typeof event.reason === "string"
            ? event.reason
            : "unknown_unhandled_rejection";

      void reportFrontendEvent({
        details: {},
        message,
        type: "frontend_rejection",
      });
    }

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  function getFollowUpAnswerLabel(question: FollowUpQuestion) {
    const answers = getAnswerArray(followUpAnswers[question.id]);
    const otherDetail = getAnswerText(
      followUpAnswers[`${question.id}_other`],
    ).trim();

    if (answers.length === 0) {
      return "";
    }

    const labels = answers.map((answer) =>
      answer === "其他" && otherDetail ? `其他：${otherDetail}` : answer,
    );

    if (answers.includes("其他") && otherDetail && !labels.includes(`其他：${otherDetail}`)) {
      labels.push(`其他：${otherDetail}`);
    }

    return labels.join("、");
  }

  const consistencyIssues = useMemo<LocalConsistencyIssue[]>(() => {
    const issues: LocalConsistencyIssue[] = [];
    const temperatureAnswer = getAnswerText(followUpAnswers.temperature);
    const appetiteAnswer = getAnswerText(followUpAnswers.appetite);
    const digestionAnswer = getAnswerText(followUpAnswers.digestion);

    if (
      selectedSymptoms.includes("怕冷") &&
      ["怕热", "冷热都不明显"].includes(temperatureAnswer)
    ) {
      issues.push({
        actions: [
          {
            id: "temperature-cold",
            label: "以怕冷为准",
          },
          {
            id: "temperature-neutral",
            label:
              temperatureAnswer === "怕热"
                ? "以怕热为准"
                : "以冷热不明显为准",
          },
        ],
        id: "cold-neutral",
        message: `你在症状标签中选择了“怕冷”，但补充问诊中选择了“${temperatureAnswer}”。请确认哪一项更符合当前情况。`,
      });
    }

    if (
      selectedSymptoms.includes("食欲差") &&
      ["正常", "食欲增加"].includes(appetiteAnswer)
    ) {
      issues.push({
        actions: [
          {
            id: "appetite-low",
            label: "以食欲差为准",
          },
          {
            id: "appetite-current",
            label: `以${appetiteAnswer}为准`,
          },
        ],
        id: "appetite-conflict",
        message: `你在症状标签中选择了“食欲差”，但补充问诊中选择了“${appetiteAnswer}”。请确认食欲情况。`,
      });
    }

    if (
      selectedSymptoms.includes("腹胀") &&
      digestionAnswer === "正常"
    ) {
      issues.push({
        actions: [
          {
            id: "digestion-bloating",
            label: "以腹胀为准",
          },
          {
            id: "digestion-normal",
            label: "以消化正常为准",
          },
        ],
        id: "digestion-conflict",
        message:
          "你在症状标签中选择了“腹胀”，但补充问诊中选择了“消化正常”。请确认消化情况。",
      });
    }

    return issues;
  }, [followUpAnswers, selectedSymptoms]);

  function clearDerivedState() {
    setIsAnalyzing(false);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setIsChatting(false);
    setIsCheckingConsistency(false);
    setIsGeneratingFollowUps(false);
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setHasResolvedAiConsistencyRound(false);
    setErrorMessage(null);
    setFollowUpAnswers({});
    setFollowUpQuestions([]);
    setFollowUpDrafts({});
    setActiveFollowUpIndex(0);
    setTongueImages({
      top: { file: null, name: "", preview: null },
      underside: { file: null, name: "", preview: null },
    });
    setTongueAnalysisState("idle");
    setTongueAnalysis(null);
    setTongueError(null);
    setFaceImage({ file: null, name: "", preview: null });
    setFaceAnalysisState("idle");
    setFaceAnalysis(null);
    setFaceError(null);
  }

  function resetCurrentConsultation() {
    analysisRunId.current += 1;
    setChiefComplaint("");
    setSelectedTopic(null);
    setSelectedSymptoms([]);
    setHasStarted(false);
    setIsAnalyzing(false);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setIsChatting(false);
    setIsCheckingConsistency(false);
    setIsGeneratingFollowUps(false);
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setHasResolvedAiConsistencyRound(false);
    setErrorMessage(null);
    setFollowUpAnswers({});
    setFollowUpQuestions([]);
    setFollowUpDrafts({});
    setActiveFollowUpIndex(0);
    setTongueImages({
      top: { file: null, name: "", preview: null },
      underside: { file: null, name: "", preview: null },
    });
    setTongueAnalysisState("idle");
    setTongueAnalysis(null);
    setTongueError(null);
    setFaceImage({ file: null, name: "", preview: null });
    setFaceAnalysisState("idle");
    setFaceAnalysis(null);
    setFaceError(null);
    autoComplaintRef.current = "";
  }

  function saveConsultationHistory(cards: ResultCard[]) {
    const historyId = `${Date.now()}`;
    const resultSources: ConsultationHistoryItem["resultSources"] = [
      "standard",
      ...(multimodalResultCards ? (["multimodal"] as Array<"multimodal">) : []),
    ];
    const historyItem: ConsultationHistoryItem = {
      chatMessages,
      chiefComplaint,
      createdAt: new Date().toISOString(),
      followUpAnswers,
      id: historyId,
      multimodalChatMessages,
      multimodalObservationSummary,
      multimodalResultCards,
      observation: {
        ...(faceAnalysis ? { face: faceAnalysis } : {}),
        hasFaceInput: Boolean(faceAnalysis),
        hasTongueInput: Boolean(tongueAnalysis),
        ...(tongueAnalysis ? { tongue: tongueAnalysis } : {}),
      },
      resultCards: cards,
      resultSources,
      selectedSymptoms,
      selectedTopic,
    };

    setConsultationHistory((current) => {
      const next = [historyItem, ...current].slice(
        0,
        maxConsultationHistoryItems,
      );
      writeConsultationHistory(next);
      return next;
    });
    setActiveHistoryId(historyId);
  }

  function updateActiveHistoryChat(messages: ChatMessage[]) {
    if (!activeHistoryId) {
      return;
    }

    setConsultationHistory((current) => {
      const next = current.map((item) =>
        item.id === activeHistoryId ? { ...item, chatMessages: messages } : item,
      );
      writeConsultationHistory(next);
      return next;
    });
  }

  function updateActiveHistoryMultimodalChat(messages: ChatMessage[]) {
    if (!activeHistoryId) {
      return;
    }

    setConsultationHistory((current) => {
      const next = current.map((item) =>
        item.id === activeHistoryId
          ? { ...item, multimodalChatMessages: messages }
          : item,
      );
      writeConsultationHistory(next);
      return next;
    });
  }

  function buildCurrentSubmitRequest(): SubmitFollowUpRequest {
    return {
      chiefComplaint,
      followUpAnswers,
      observation: {
        ...(faceAnalysis ? { face: faceAnalysis } : {}),
        hasFaceInput: Boolean(faceAnalysis),
        hasTongueInput: Boolean(tongueAnalysis),
        ...(tongueAnalysis ? { tongue: tongueAnalysis } : {}),
      },
      selectedSymptoms,
      selectedTopic,
    };
  }

  function buildConsistencySubmitRequest(): SubmitFollowUpRequest {
    return {
      chiefComplaint,
      followUpAnswers,
      selectedSymptoms,
      selectedTopic,
    };
  }

  function restoreConsultationHistory(item: ConsultationHistoryItem) {
    analysisRunId.current += 1;
    setChiefComplaint(item.chiefComplaint);
    setSelectedTopic(item.selectedTopic);
    setSelectedSymptoms(item.selectedSymptoms);
    setFollowUpAnswers(item.followUpAnswers);
    setFollowUpQuestions([]);
    setFollowUpDrafts({});
    setActiveFollowUpIndex(0);
    setHasStarted(true);
    setIsAnalyzing(false);
    setIsGeneratingFollowUps(false);
    setIsCheckingConsistency(false);
    setHasResolvedAiConsistencyRound(true);
    setResultCards(item.resultCards);
    setMultimodalResultCards(item.multimodalResultCards ?? null);
    setMultimodalObservationSummary(item.multimodalObservationSummary ?? null);
    setMultimodalChatMessages(item.multimodalChatMessages ?? []);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(item.id);
    setChatMessages(item.chatMessages);
    setChatInput("");
    setIsChatting(false);
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setErrorMessage(null);
    setTongueAnalysis(item.observation?.tongue ?? null);
    setTongueAnalysisState(item.observation?.tongue ? "success" : "idle");
    setTongueImages({
      top: { file: null, name: "", preview: null },
      underside: { file: null, name: "", preview: null },
    });
    setTongueError(null);
    setFaceAnalysis(item.observation?.face ?? null);
    setFaceAnalysisState(item.observation?.face ? "success" : "idle");
    setFaceImage({ file: null, name: "", preview: null });
    setFaceError(null);
    setIsHistoryOpen(false);
    autoComplaintRef.current = "";
  }

  function clearConsultationHistory() {
    window.localStorage.removeItem(consultationHistoryStorageKey);
    setConsultationHistory([]);
    setIsHistoryOpen(false);
  }

  function handleScenarioSelect(
    scenario: (typeof consultationScenarios)[number],
  ) {
    analysisRunId.current += 1;
    setHasStarted(false);
    clearDerivedState();

    if (selectedTopic === scenario.title) {
      setSelectedTopic(null);

      if (chiefComplaint === autoComplaintRef.current) {
        setChiefComplaint("");
      }

      autoComplaintRef.current = "";
      return;
    }

    setSelectedTopic(scenario.title);

    const canReplaceComplaint =
      !chiefComplaint.trim() || chiefComplaint === autoComplaintRef.current;

    if (!scenario.prompt && chiefComplaint === autoComplaintRef.current) {
      setChiefComplaint("");
      autoComplaintRef.current = "";
      return;
    }

    if (scenario.prompt && canReplaceComplaint) {
      setChiefComplaint(scenario.prompt);
      autoComplaintRef.current = scenario.prompt;
    }
  }

  function handleSymptomToggle(symptom: string) {
    analysisRunId.current += 1;
    setHasStarted(false);
    clearDerivedState();
    setSelectedSymptoms((current) =>
      current.includes(symptom)
        ? current.filter((item) => item !== symptom)
        : [...current, symptom],
    );
  }

  function handleFollowUpAnswer(questionId: string, answer: string) {
    analysisRunId.current += 1;
    setIsAnalyzing(false);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setIsChatting(false);
    setIsCheckingConsistency(false);
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setHasResolvedAiConsistencyRound(false);
    setErrorMessage(null);
    setFollowUpAnswers((current) => ({
      ...current,
      ...(answer !== "其他"
        ? { [`${questionId}_other`]: "" }
        : {}),
      [questionId]: answer,
    }));
  }

  function handleFollowUpSingleOptionAnswer(
    question: FollowUpQuestion,
    answer: string,
  ) {
    handleFollowUpAnswer(question.id, answer);

    if (answer !== "其他") {
      moveToNextFollowUp();
    }
  }

  function handleFollowUpMultiOptionAnswer(
    question: FollowUpQuestion,
    answer: string,
  ) {
    analysisRunId.current += 1;
    setIsAnalyzing(false);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setIsChatting(false);
    setIsCheckingConsistency(false);
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setHasResolvedAiConsistencyRound(false);
    setErrorMessage(null);

    setFollowUpAnswers((current) => {
      const currentAnswers = getAnswerArray(current[question.id]);
      const exclusiveOptions = question.exclusiveOptions ?? [];
      let nextAnswers = currentAnswers.includes(answer)
        ? currentAnswers.filter((item) => item !== answer)
        : [...currentAnswers, answer];

      if (exclusiveOptions.includes(answer)) {
        nextAnswers = nextAnswers.includes(answer) ? [answer] : [];
      } else if (nextAnswers.includes(answer)) {
        nextAnswers = nextAnswers.filter(
          (item) => !exclusiveOptions.includes(item),
        );
      }

      if (
        typeof question.maxSelections === "number" &&
        question.maxSelections > 0 &&
        nextAnswers.length > question.maxSelections
      ) {
        nextAnswers = nextAnswers.slice(
          nextAnswers.length - question.maxSelections,
        );
      }

      return {
        ...current,
        ...(nextAnswers.includes("其他")
          ? {}
          : { [`${question.id}_other`]: "" }),
        [question.id]: nextAnswers,
      };
    });
  }

  function moveToNextFollowUp() {
    setActiveFollowUpIndex((current) =>
      Math.min(current + 1, followUpQuestions.length),
    );
  }

  function handleFollowUpOptionAnswer(
    question: FollowUpQuestion,
    answer: string,
  ) {
    if (question.answerMode === "multi") {
      handleFollowUpMultiOptionAnswer(question, answer);
      return;
    }

    handleFollowUpSingleOptionAnswer(question, answer);
  }

  function handleConfirmFollowUpText(question: FollowUpQuestion) {
    const answer = followUpDrafts[question.id]?.trim();

    if (!answer) {
      return;
    }

    handleFollowUpAnswer(question.id, answer);
    moveToNextFollowUp();
  }

  function handleSkipFollowUp(question: FollowUpQuestion) {
    setFollowUpDrafts((current) => ({
      ...current,
      [question.id]: "",
    }));
    moveToNextFollowUp();
  }

  function handleConfirmOtherDetail(question: FollowUpQuestion) {
    const otherKey = `${question.id}_other`;
    const answer = followUpDrafts[otherKey]?.trim();

    if (!answer) {
      return;
    }

    setFollowUpAnswers((current) => ({
      ...current,
      [otherKey]: answer,
    }));
    moveToNextFollowUp();
  }

  function updateTongueImage(slot: TongueImageSlot, file: File | null) {
    if (!file) {
      return;
    }

    try {
      validateImageFile(file, slot === "top" ? "舌面照片" : "舌下照片");
    } catch (error) {
      setTongueAnalysisState("error");
      setTongueError(
        getSafeUserErrorMessage("图片校验失败，请重新拍摄或上传。", error, {
          allowListedMessages: [
            "舌面照片仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。",
            "舌下照片仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。",
            "舌面照片不能超过 8MB，请压缩后重新上传。",
            "舌下照片不能超过 8MB，请压缩后重新上传。",
          ],
        }),
      );
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setTongueImages((current) => ({
      ...current,
      [slot]: {
        file,
        name: file.name,
        preview: previewUrl,
      },
    }));
    setTongueAnalysis(null);
    setTongueError(null);
    setTongueAnalysisState("idle");
  }

  async function handleAnalyzeTongueImages() {
    const top = tongueImages.top.file;
    const underside = tongueImages.underside.file;

    if (!top || !underside) {
      setTongueAnalysisState("error");
      setTongueError("请先完成舌面和舌下两张照片。");
      return;
    }

    setTongueAnalysis(null);
    setTongueError(null);
    setTongueAnalysisState("uploading");

    await new Promise((resolve) => {
      window.setTimeout(resolve, 250);
    });

    setTongueAnalysisState("analyzing");

    try {
      const result = await analyzeTongueImages({ top, underside });
      setTongueAnalysis(result);
      if (result.imageStatus === "usable") {
        setTongueAnalysisState("success");
      } else {
        setTongueAnalysisState("error");
        setTongueError(result.qualityMessage);
      }
    } catch (error) {
      setTongueAnalysis(null);
      setTongueAnalysisState("error");
      setTongueError(
        getSafeUserErrorMessage("舌象分析失败，请重新拍摄或上传图片。", error, {
          allowListedMessages: [
            "舌面照片仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。",
            "舌下照片仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。",
            "舌面照片不能超过 8MB，请压缩后重新上传。",
            "舌下照片不能超过 8MB，请压缩后重新上传。",
          ],
        }),
      );
    }
  }

  function handleRemoveTongueImage(slot: TongueImageSlot) {
    setTongueImages((current) => ({
      ...current,
      [slot]: { file: null, name: "", preview: null },
    }));
    setTongueAnalysis(null);
    setTongueAnalysisState("idle");
    setTongueError(null);
  }

  function updateFaceImage(file: File | null) {
    if (!file) {
      return;
    }

    try {
      validateImageFile(file, "面诊照片");
    } catch (error) {
      setFaceAnalysisState("error");
      setFaceError(
        getSafeUserErrorMessage("面诊照片校验失败，请重新拍摄或上传。", error, {
          allowListedMessages: [
            "面诊照片仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。",
            "面诊照片不能超过 8MB，请压缩后重新上传。",
          ],
        }),
      );
      return;
    }

    const previewUrl = URL.createObjectURL(file);
    setFaceImage({
      file,
      name: file.name,
      preview: previewUrl,
    });
    setFaceAnalysis(null);
    setFaceError(null);
    setFaceAnalysisState("idle");
  }

  async function handleAnalyzeFaceImage() {
    if (!faceImage.file) {
      setFaceAnalysisState("error");
      setFaceError("请先完成正面面部照片。");
      return;
    }

    setFaceAnalysis(null);
    setFaceError(null);
    setFaceAnalysisState("uploading");

    await new Promise((resolve) => {
      window.setTimeout(resolve, 250);
    });

    setFaceAnalysisState("analyzing");

    try {
      const result = await analyzeFaceImage(faceImage.file);
      setFaceAnalysis(result);
      if (result.imageStatus === "usable") {
        setFaceAnalysisState("success");
      } else {
        setFaceAnalysisState("error");
        setFaceError(result.qualityMessage);
      }
    } catch (error) {
      setFaceAnalysis(null);
      setFaceAnalysisState("error");
      setFaceError(
        getSafeUserErrorMessage("面诊分析失败，请重新拍摄或上传图片。", error, {
          allowListedMessages: [
            "面诊照片仅支持 JPG、PNG、WEBP、HEIC 或 HEIF 图片，请重新上传。",
            "面诊照片不能超过 8MB，请压缩后重新上传。",
          ],
        }),
      );
    }
  }

  function handleRemoveFaceImage() {
    setFaceImage({ file: null, name: "", preview: null });
    setFaceAnalysis(null);
    setFaceAnalysisState("idle");
    setFaceError(null);
  }

  async function handleStartConsultation() {
    if (!canStart || isGeneratingFollowUps) {
      return;
    }

    const runId = analysisRunId.current + 1;
    analysisRunId.current = runId;
    setHasStarted(true);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setIsChatting(false);
    setIsCheckingConsistency(false);
    setIsAnalyzing(false);
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setHasResolvedAiConsistencyRound(false);
    setFollowUpAnswers({});
    setFollowUpDrafts({});
    setActiveFollowUpIndex(0);
    setErrorMessage(null);
    setIsGeneratingFollowUps(true);

    try {
      const questions = await startConsultation({
        chiefComplaint,
        selectedSymptoms,
        selectedTopic,
      });

      if (analysisRunId.current !== runId) {
        return;
      }

      setFollowUpQuestions(questions);
      setActiveFollowUpIndex(0);
    } catch {
      if (analysisRunId.current === runId) {
        setHasStarted(false);
        setErrorMessage("开始会诊失败，请稍后重试。");
      }
    } finally {
      if (analysisRunId.current === runId) {
        setIsGeneratingFollowUps(false);
      }
    }
  }

  function handleResolveConsistencyIssue(actionId: string) {
    analysisRunId.current += 1;
    setErrorMessage(null);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setAiConsistencyIssues([]);
    setAiConsistencyDrafts({});
    setHasResolvedAiConsistencyRound(false);

    if (actionId === "temperature-cold") {
      handleFollowUpAnswer("temperature", "怕冷");
      return;
    }

    if (actionId === "temperature-neutral") {
      setSelectedSymptoms((current) =>
        current.filter((symptom) => symptom !== "怕冷"),
      );
      return;
    }

    if (actionId === "appetite-low") {
      handleFollowUpAnswer("appetite", "食欲下降");
      return;
    }

    if (actionId === "appetite-current") {
      setSelectedSymptoms((current) =>
        current.filter((symptom) => symptom !== "食欲差"),
      );
      return;
    }

    if (actionId === "digestion-bloating") {
      handleFollowUpAnswer("digestion", "容易腹胀");
      return;
    }

    if (actionId === "digestion-normal") {
      setSelectedSymptoms((current) =>
        current.filter((symptom) => symptom !== "腹胀"),
      );
    }
  }

  function handleResolveAiConsistencyIssue(issueId: string, option: string) {
    analysisRunId.current += 1;
    setErrorMessage(null);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsMultimodalCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setAiConsistencyIssues((current) => {
      const remainingIssues = current.filter((issue) => issue.id !== issueId);

      if (remainingIssues.length === 0) {
        setHasResolvedAiConsistencyRound(true);
      }

      return remainingIssues;
    });
    setAiConsistencyDrafts((current) => {
      const next = { ...current };
      delete next[issueId];
      return next;
    });
    setFollowUpAnswers((current) => ({
      ...current,
      [`clarification_${issueId}`]: option,
    }));
  }

  function handleAiConsistencyOption(issueId: string, option: string) {
    if (option === "其他") {
      setAiConsistencyDrafts((current) => ({
        ...current,
        [issueId]: current[issueId] ?? "",
      }));
      return;
    }

    handleResolveAiConsistencyIssue(issueId, option);
  }

  function handleConfirmAiConsistencyOther(issueId: string) {
    const answer = aiConsistencyDrafts[issueId]?.trim();

    if (!answer) {
      return;
    }

    handleResolveAiConsistencyIssue(issueId, `其他：${answer}`);
  }

  async function handleSubmitFollowUp() {
    if (!canSubmitFollowUp || isAnalyzing || isCheckingConsistency) {
      return;
    }

    if (consistencyIssues.length > 0) {
      setErrorMessage("请先确认存在冲突的问诊信息。");
      return;
    }

    if (aiConsistencyIssues.length > 0) {
      setErrorMessage("请先确认需要澄清的问诊信息。");
      return;
    }

    const runId = analysisRunId.current + 1;
    analysisRunId.current = runId;
    setHasStarted(true);
    setResultCards(null);
    setMultimodalResultCards(null);
    setMultimodalObservationSummary(null);
    setMultimodalChatMessages([]);
    setIsAnalyzingMultimodal(false);
    setIsMultimodalChatting(false);
    setCompareResults([]);
    setIsCompareOpen(false);
    setIsComparing(false);
    setCompareError(null);
    setActiveHistoryId(null);
    setChatMessages([]);
    setChatInput("");
    setIsChatting(false);
    setAiConsistencyDrafts({});
    setErrorMessage(null);

    const request = buildCurrentSubmitRequest();
    const consistencyRequest = buildConsistencySubmitRequest();

    if (!hasResolvedAiConsistencyRound) {
      try {
        setIsCheckingConsistency(true);
        const consistency =
          await checkConsultationConsistency(consistencyRequest);

        if (analysisRunId.current !== runId) {
          return;
        }

        if (consistency.needsClarification) {
          setAiConsistencyIssues(consistency.issues);
          setAiConsistencyDrafts({});
          setErrorMessage("请先确认需要澄清的问诊信息。");
          return;
        }

        setHasResolvedAiConsistencyRound(true);
      } catch {
        setErrorMessage("信息一致性检查失败，请稍后重试。");
        return;
      } finally {
        if (analysisRunId.current === runId) {
          setIsCheckingConsistency(false);
        }
      }
    }

    if (analysisRunId.current !== runId) {
      return;
    }

    setIsAnalyzing(true);

    try {
      const cards = await submitFollowUp(request);

      if (analysisRunId.current !== runId) {
        return;
      }

      setResultCards(cards);
      saveConsultationHistory(cards);
    } catch {
      setErrorMessage("分析失败，请重新提交补充问诊。");
    } finally {
      if (analysisRunId.current === runId) {
        setIsAnalyzing(false);
      }
    }
  }

  async function handleCompareModels() {
    if (!resultCards || isComparing) {
      return;
    }

    setIsCompareOpen(true);
    setIsComparing(true);
    setCompareError(null);

    try {
      const response = await compareConsultationModels(
        buildCurrentSubmitRequest(),
        resultCards,
      );
      setCompareResults(response.results);
    } catch {
      setCompareError("模型对比失败，请检查 DMXAPI key 和模型名配置。");
    } finally {
      setIsComparing(false);
    }
  }

  async function handleGenerateMultimodalCompare() {
    if (
      !resultCards ||
      isAnalyzingMultimodal ||
      !tongueImages.top.file ||
      !tongueImages.underside.file ||
      !faceImage.file
    ) {
      return;
    }

    setIsMultimodalCompareOpen(true);
    setIsAnalyzingMultimodal(true);
    setErrorMessage(null);

    try {
      const response = await analyzeMultimodalConsultation(
        buildCurrentSubmitRequest(),
        {
          face: faceImage.file,
          tongueTop: tongueImages.top.file,
          tongueUnderside: tongueImages.underside.file,
        },
      );

      setMultimodalResultCards(response.cards);
      setMultimodalObservationSummary(response.observationSummary);
      setMultimodalChatMessages([]);
      setConsultationHistory((current) => {
        if (!activeHistoryId) {
          return current;
        }

        const next = current.map((item) =>
          item.id === activeHistoryId
            ? {
                ...item,
                multimodalObservationSummary: response.observationSummary,
                multimodalResultCards: response.cards,
                resultSources: ["standard", "multimodal"] as Array<
                  "standard" | "multimodal"
                >,
              }
            : item,
        );
        writeConsultationHistory(next);
        return next;
      });
    } catch {
      setErrorMessage("Qwen3-VL 直出结果生成失败，请稍后重试。");
    } finally {
      setIsAnalyzingMultimodal(false);
    }
  }

  async function handleSendChat() {
    const question = chatInput.trim();

    if (
      !question ||
      !resultCards ||
      isChatting ||
      isMultimodalChatting
    ) {
      return;
    }

    const userMessage: ChatMessage = {
      id: nextChatId.current,
      role: "user",
      content: question,
    };
    nextChatId.current += 1;

    const messagesWithUser = [...chatMessages, userMessage];

    setChatMessages(messagesWithUser);
    updateActiveHistoryChat(messagesWithUser);
    const multimodalMessagesWithUser = multimodalResultCards
      ? [...multimodalChatMessages, userMessage]
      : null;

    if (multimodalMessagesWithUser) {
      setMultimodalChatMessages(multimodalMessagesWithUser);
      updateActiveHistoryMultimodalChat(multimodalMessagesWithUser);
    }
    setChatInput("");
    setIsChatting(true);
    setIsMultimodalChatting(Boolean(multimodalResultCards));
    setErrorMessage(null);

    try {
      const [standardAnswer, multimodalAnswer] = await Promise.all([
        continueChat({
          previousMessages: chatMessages,
          question,
          resultCards,
        }),
        multimodalResultCards && multimodalObservationSummary
          ? continueMultimodalChat({
              chiefComplaint,
              followUpAnswers,
              observationSummary: multimodalObservationSummary,
              previousMessages: multimodalChatMessages,
              question,
              resultCards: multimodalResultCards,
              selectedSymptoms,
              selectedTopic,
            })
          : Promise.resolve<string | null>(null),
      ]);

      const assistantMessage: ChatMessage = {
        id: nextChatId.current,
        role: "assistant",
        content: standardAnswer,
      };
      nextChatId.current += 1;

      const messagesWithAnswer = [...messagesWithUser, assistantMessage];

      setChatMessages(messagesWithAnswer);
      updateActiveHistoryChat(messagesWithAnswer);

      if (
        multimodalMessagesWithUser &&
        multimodalResultCards &&
        multimodalObservationSummary &&
        multimodalAnswer
      ) {
        const multimodalAssistantMessage: ChatMessage = {
          id: nextChatId.current,
          role: "assistant",
          content: multimodalAnswer,
        };
        nextChatId.current += 1;

        const multimodalMessagesWithAnswer = [
          ...multimodalMessagesWithUser,
          multimodalAssistantMessage,
        ];

        setMultimodalChatMessages(multimodalMessagesWithAnswer);
        updateActiveHistoryMultimodalChat(multimodalMessagesWithAnswer);
      }
    } catch {
      setErrorMessage("追问发送失败，请稍后重试。");
    } finally {
      setIsChatting(false);
      setIsMultimodalChatting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(135deg,#f8eadb_0%,#f8f4e9_48%,#dff2f7_100%)] text-[#171b20]">
      <section className="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-5 py-6 pb-32 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-5 border-b border-white/60 pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#866237]">
              ITWINS TCM
            </p>
            <h1 className="mt-2 text-4xl font-semibold text-[#161832]">
              中医会诊
            </h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-[#60646d]">
              以中医问诊与望诊为主，结合舌象、体感、睡眠、饮食与情志等线索，综合分析当前状态，并提供个性化调理建议。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="h-11 w-fit rounded-2xl border border-[#eadfce] bg-white/85 px-5 text-sm font-semibold text-[#866237] shadow-sm transition hover:border-[#f0a653] hover:bg-white disabled:cursor-not-allowed disabled:text-[#b9aa94]"
              onClick={() => setIsHistoryOpen(true)}
              type="button"
            >
              历史记录
            </button>
            <button
              className="h-11 w-fit rounded-2xl border border-[#eadfce] bg-white/85 px-5 text-sm font-semibold text-[#866237] shadow-sm transition hover:border-[#f0a653] hover:bg-white"
              onClick={resetCurrentConsultation}
              type="button"
            >
              开始新的会诊
            </button>
          </div>
        </header>

        <section
          aria-label="会诊聊天"
          className="mt-7 flex flex-1 flex-col gap-5"
        >
          <div className="flex items-start gap-3">
            <ItwinsAvatar />
            <div className="max-w-3xl rounded-[1.25rem] border border-white/80 bg-white px-5 py-4 text-lg leading-9 text-[#2d3036] shadow-[0_10px_30px_rgba(55,48,40,0.08)]">
              您好，我会通过中医问诊方式了解您的情况。可以先选择一个场景，也可以直接描述目前最困扰的问题。
            </div>
          </div>

          <div className="ml-13 grid gap-3 md:grid-cols-6">
            {consultationScenarios.map((scenario) => {
              const isSelected = selectedTopic === scenario.title;

              return (
                <button
                  aria-pressed={isSelected}
                  className={`min-h-32 rounded-[1.5rem] border p-4 text-left shadow-[0_10px_28px_rgba(82,65,42,0.08)] transition ${
                    isSelected
                      ? "border-[#f39b42] bg-[#fff4dc]"
                      : "border-white/80 bg-white/80 hover:border-[#f1b35f]"
                  }`}
                  key={scenario.title}
                  onClick={() => handleScenarioSelect(scenario)}
                  type="button"
                >
                  <span
                    className={`flex h-11 w-11 items-center justify-center rounded-2xl text-base font-semibold ${
                      isSelected
                        ? "bg-[#f6aa48] text-white"
                        : "bg-[#f7f2e9] text-[#866237]"
                    }`}
                  >
                    {scenario.icon}
                  </span>
                  <span className="mt-4 block font-semibold text-[#151934]">
                    {scenario.title}
                  </span>
                  <span className="mt-2 block text-sm leading-5 text-[#7b8291]">
                    {scenario.description}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto w-full max-w-3xl rounded-[1.75rem] border border-white/80 bg-white/95 p-5 shadow-[0_18px_45px_rgba(82,65,42,0.12)]">
            <div className="rounded-t-[1.25rem] bg-[linear-gradient(90deg,#fff4df,#fbd36c)] p-5">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white text-3xl shadow-sm">
                  诊
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-[#151934]">
                    开始会诊
                  </h2>
                  <p className="mt-1 text-sm text-[#657083]">
                    输入主诉，选择症状，我会继续追问关键信息。
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-5 px-1 pt-5">
              <textarea
                className="min-h-32 w-full resize-none rounded-2xl border border-[#eadfce] bg-[#fffaf2] px-4 py-3 text-base leading-7 outline-none transition placeholder:text-[#a5a6af] focus:border-[#f0a653] focus:ring-2 focus:ring-[#f8d59b]"
                onChange={(event) => {
                  analysisRunId.current += 1;
                  autoComplaintRef.current = "";
                  setChiefComplaint(event.target.value);
                  setHasStarted(false);
                  clearDerivedState();
                }}
                placeholder="例如：近两周入睡困难，容易醒，白天乏力，最近工作压力较大。"
                value={chiefComplaint}
              />

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[#2b3440]">
                    症状标签
                  </h3>
                  <span className="text-sm text-[#8a8f9d]">
                    已选 {selectedSymptoms.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {symptomTags.map((symptom) => {
                    const isSelected = selectedSymptoms.includes(symptom);

                    return (
                      <button
                        aria-pressed={isSelected}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                          isSelected
                            ? "border-[#60bf7a] bg-[#e9f8ee] text-[#267645]"
                            : "border-[#edf0f5] bg-white text-[#657083] hover:border-[#bddfc7]"
                        }`}
                        key={symptom}
                        onClick={() => handleSymptomToggle(symptom)}
                        type="button"
                      >
                        {symptom}
                      </button>
                    );
                  })}
                </div>
              </div>

              {!canStart ? (
                <div className="rounded-2xl border border-dashed border-[#eadfce] bg-[#fffaf2] px-4 py-3 text-sm leading-6 text-[#8a8f9d]">
                  填写主诉或选择至少一个症状后即可开始。
                </div>
              ) : null}

              {followUpQuestions.length === 0 ? (
                <button
                  className="h-13 w-full rounded-2xl bg-[#151934] px-5 text-base font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                  disabled={!canStart || isGeneratingFollowUps}
                  onClick={handleStartConsultation}
                  type="button"
                >
                  {isGeneratingFollowUps ? "问诊中" : "发送主诉，开始会诊"}
                </button>
              ) : null}

              </div>
          </div>

          {isGeneratingFollowUps ? (
            <div className="flex items-start gap-3">
              <ItwinsAvatar />
              <div
                aria-live="polite"
                className="max-w-3xl rounded-[1.5rem] border border-white/80 bg-white px-5 py-4 shadow-[0_12px_34px_rgba(55,48,40,0.08)]"
                role="status"
              >
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#f3cf8c] border-t-[#f39a40]" />
                  <p className="text-base font-semibold text-[#151934]">
                    我正在根据你的主诉整理下一步问诊问题。
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {followUpQuestions
            .slice(0, activeFollowUpIndex)
            .map((question, index) => {
              const answer = getFollowUpAnswerLabel(question) || "暂不补充";

              return (
                <div className="space-y-3" key={question.id}>
                  <div className="flex items-start gap-3">
                    <ItwinsAvatar />
                    <div className="max-w-3xl rounded-[1.5rem] border border-white/80 bg-white px-5 py-4 text-base leading-7 text-[#2d3036] shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                      {index + 1}. {question.question}
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div className="max-w-2xl rounded-[1.5rem] bg-[#151934] px-5 py-4 text-base leading-7 text-white shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                      {answer}
                    </div>
                  </div>
                </div>
              );
            })}

          {activeFollowUpQuestion ? (
            <div className="flex items-start gap-3">
              <ItwinsAvatar />
              <div className="max-w-3xl rounded-[1.5rem] border border-white/80 bg-white px-5 py-4 shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                <p className="text-base leading-7 text-[#2d3036]">
                  {activeFollowUpIndex + 1}. {activeFollowUpQuestion.question}
                  {activeFollowUpQuestion.options.length === 0 ? (
                    <span className="ml-2 text-xs font-medium text-[#9aa0ad]">
                      可选
                    </span>
                  ) : null}
                </p>

                {activeFollowUpQuestion.options.length > 0 ? (
                  <>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {activeFollowUpQuestion.options.map((option) => {
                        const isSelected = getAnswerArray(
                          followUpAnswers[activeFollowUpQuestion.id],
                        ).includes(option);

                        return (
                          <button
                            aria-pressed={isSelected}
                            className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                              isSelected
                                ? "border-[#60bf7a] bg-[#e9f8ee] text-[#267645]"
                                : "border-[#edf0f5] bg-white text-[#657083] hover:border-[#bddfc7]"
                            }`}
                            key={option}
                            onClick={() =>
                              handleFollowUpOptionAnswer(
                                activeFollowUpQuestion,
                                option,
                              )
                            }
                            type="button"
                          >
                            {option}
                          </button>
                        );
                      })}
                    </div>

                    {getAnswerArray(
                      followUpAnswers[activeFollowUpQuestion.id],
                    ).includes("其他") ? (
                      <div className="mt-3">
                        <input
                          className="h-11 w-full rounded-2xl border border-[#eadfce] bg-white px-4 text-sm outline-none transition placeholder:text-[#a5a6af] focus:border-[#f0a653] focus:ring-2 focus:ring-[#f8d59b]"
                          onChange={(event) =>
                            setFollowUpDrafts((current) => ({
                              ...current,
                              [`${activeFollowUpQuestion.id}_other`]:
                                event.target.value,
                            }))
                          }
                          placeholder="请补充具体情况"
                          type="text"
                          value={
                            followUpDrafts[
                              `${activeFollowUpQuestion.id}_other`
                            ] ?? ""
                          }
                        />
                      </div>
                    ) : null}

                    {activeFollowUpQuestion.answerMode === "multi" ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          className="h-11 rounded-2xl bg-[#151934] px-5 text-sm font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                          disabled={
                            getAnswerArray(
                              followUpAnswers[activeFollowUpQuestion.id],
                            ).length === 0 ||
                            (getAnswerArray(
                              followUpAnswers[activeFollowUpQuestion.id],
                            ).includes("其他") &&
                              !(followUpDrafts[
                                `${activeFollowUpQuestion.id}_other`
                              ] ?? "").trim())
                          }
                          onClick={() => {
                            const otherKey = `${activeFollowUpQuestion.id}_other`;
                            const otherText = followUpDrafts[otherKey]?.trim();
                            if (otherText) {
                              setFollowUpAnswers((current) => ({
                                ...current,
                                [otherKey]: otherText,
                              }));
                            }
                            moveToNextFollowUp();
                          }}
                          type="button"
                        >
                          确认选择
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <div className="mt-4 space-y-3">
                    <textarea
                      className="min-h-24 w-full resize-none rounded-2xl border border-[#eadfce] bg-white px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-[#a5a6af] focus:border-[#f0a653] focus:ring-2 focus:ring-[#f8d59b]"
                      onChange={(event) =>
                        setFollowUpDrafts((current) => ({
                          ...current,
                          [activeFollowUpQuestion.id]: event.target.value,
                        }))
                      }
                      placeholder="例如：最近口干明显、夜间容易醒、下午更疲劳。"
                      value={followUpDrafts[activeFollowUpQuestion.id] ?? ""}
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="h-11 rounded-2xl bg-[#151934] px-5 text-sm font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                        disabled={
                          !followUpDrafts[activeFollowUpQuestion.id]?.trim()
                        }
                        onClick={() =>
                          handleConfirmFollowUpText(activeFollowUpQuestion)
                        }
                        type="button"
                      >
                        确认补充
                      </button>
                      <button
                        className="h-11 rounded-2xl border border-[#eadfce] bg-[#fffaf2] px-5 text-sm font-semibold text-[#866237] transition hover:border-[#f0a653]"
                        onClick={() =>
                          handleSkipFollowUp(activeFollowUpQuestion)
                        }
                        type="button"
                      >
                        暂不补充
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {followUpQuestions.length > 0 &&
          activeFollowUpIndex >= followUpQuestions.length ? (
            <div className="ml-13 max-w-3xl rounded-[1.5rem] border border-white/80 bg-white/90 p-4 shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
              <div className="rounded-2xl bg-[#fffaf2] px-4 py-3 text-sm leading-6 text-[#7b8291]">
                必答已完成 {answeredRequiredFollowUps} /{" "}
                {requiredFollowUpQuestions.length}，已填写 {answeredFollowUps} /{" "}
                {followUpQuestions.length} 个问题。
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-[#e6efe7] bg-[#fbfffb] p-4">
                <div>
                  <div>
                    <h3 className="text-base font-semibold text-[#1f4b34]">
                      舌象采集
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[#66746b]">
                      请完成舌面和舌下两张照片。画面能看清舌体主体即可，避免明显模糊、过暗、过曝或强反光。支持 JPG、PNG、WEBP、HEIC、HEIF，单张不超过 8MB。
                    </p>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div className="grid gap-5 md:grid-cols-2">
                    {(
                      [
                        ["top", "舌面照片", "伸舌自然放松，尽量拍到舌质和舌苔"],
                        ["underside", "舌下照片", "轻抬舌尖，尽量拍到舌下区域"],
                      ] as const
                    ).map(([slot, title, hint]) => {
                      const image = tongueImages[slot];

                      return (
                        <div
                          className="rounded-2xl border border-[#dfe9df] bg-white p-3"
                          key={slot}
                        >
                          <div className="overflow-hidden rounded-2xl border border-[#edf2ed] bg-[#fbfffb]">
                            {image.preview ? (
                              <Image
                                alt={`${title}预览`}
                                className="h-60 w-full object-cover"
                                height={240}
                                src={image.preview}
                                unoptimized
                                width={320}
                              />
                            ) : (
                              <div className="flex h-60 items-center justify-center px-5 text-center text-sm leading-6 text-[#8a958d]">
                                {title}预览
                              </div>
                            )}
                          </div>
                          <h4 className="mt-3 text-sm font-semibold text-[#263a2d]">
                            {title}
                          </h4>
                          <p className="mt-1 text-xs leading-5 text-[#66746b]">
                            {hint}
                          </p>
                          {image.name ? (
                            <p className="mt-2 truncate text-xs text-[#7b8a80]">
                              {image.name}
                            </p>
                          ) : null}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <label className="inline-flex h-10 cursor-pointer items-center rounded-2xl bg-[#151934] px-4 text-sm font-semibold text-white transition hover:bg-[#252b4a]">
                              上传
                              <input
                                accept="image/*"
                                className="sr-only"
                                onChange={(event) => {
                                  updateTongueImage(
                                    slot,
                                    event.target.files?.[0] ?? null,
                                  );
                                  event.currentTarget.value = "";
                                }}
                                type="file"
                              />
                            </label>
                            <label className="inline-flex h-10 cursor-pointer items-center rounded-2xl border border-[#dfe9df] bg-[#fffaf2] px-4 text-sm font-semibold text-[#617067] transition hover:border-[#a9c5ad]">
                              拍摄
                              <input
                                accept="image/*"
                                capture="environment"
                                className="sr-only"
                                onChange={(event) => {
                                  updateTongueImage(
                                    slot,
                                    event.target.files?.[0] ?? null,
                                  );
                                  event.currentTarget.value = "";
                                }}
                                type="file"
                              />
                            </label>
                            {image.preview ? (
                              <button
                                className="h-10 rounded-2xl border border-[#dfe9df] bg-white px-4 text-sm font-semibold text-[#617067] transition hover:border-[#a9c5ad]"
                                onClick={() => handleRemoveTongueImage(slot)}
                                type="button"
                              >
                                删除
                              </button>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-3">
                    <button
                      className="h-11 rounded-2xl bg-[#151934] px-5 text-sm font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                      disabled={
                        !tongueImages.top.file ||
                        !tongueImages.underside.file ||
                        tongueAnalysisState === "uploading" ||
                        tongueAnalysisState === "analyzing"
                      }
                      onClick={handleAnalyzeTongueImages}
                      type="button"
                    >
                      开始舌象观察
                    </button>

                    {tongueAnalysisState === "uploading" ||
                    tongueAnalysisState === "analyzing" ? (
                      <div
                        aria-live="polite"
                        className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-[#66746b]"
                        role="status"
                      >
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#cfe0cf] border-t-[#60bf7a]" />
                        {tongueAnalysisState === "uploading"
                          ? "正在读取图片"
                          : "正在进行舌象观察"}
                      </div>
                    ) : null}

                    {tongueError ? (
                      <p className="rounded-2xl bg-[#fff1ec] px-4 py-3 text-sm leading-6 text-[#9a4a2d]">
                        {tongueError}
                      </p>
                    ) : null}

                    {tongueAnalysis ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {tongueObservationFields.map((field) => (
                          <div
                            className="rounded-2xl border border-[#e6efe7] bg-white px-4 py-3"
                            key={field.key}
                          >
                            <p className="text-xs font-semibold text-[#7b8a80]">
                              {field.label}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-[#263a2d]">
                              {tongueAnalysis[field.key]}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-[#66746b]">
                        舌象观察是生成本次会诊结果前的必要步骤。手机上可用“拍摄”调起相机；电脑浏览器通常会打开文件选择器。
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-[#e6edf3] bg-[#fbfdff] p-4">
                <div>
                  <div>
                    <h3 className="text-base font-semibold text-[#273f5b]">
                      面象采集
                    </h3>
                    <p className="mt-1 text-sm leading-6 text-[#657083]">
                      请完成一张正面面部照片。画面能看清面部主体即可，避免明显模糊、过暗、过曝或大面积遮挡。支持 JPG、PNG、WEBP、HEIC、HEIF，单张不超过 8MB。
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-[260px_1fr]">
                  <div className="rounded-2xl border border-[#dfe7ef] bg-white p-3">
                    <div className="overflow-hidden rounded-2xl border border-[#edf2f7] bg-[#fbfdff]">
                      {faceImage.preview ? (
                        <Image
                          alt="面象预览"
                          className="h-60 w-full object-cover"
                          height={240}
                          src={faceImage.preview}
                          unoptimized
                          width={260}
                        />
                      ) : (
                        <div className="flex h-60 items-center justify-center px-5 text-center text-sm leading-6 text-[#8a939d]">
                          正面面部照片预览
                        </div>
                      )}
                    </div>
                    <h4 className="mt-3 text-sm font-semibold text-[#26384b]">
                      正面照片
                    </h4>
                    <p className="mt-1 text-xs leading-5 text-[#657083]">
                      保持自然光线，摘下口罩，尽量露出完整面部。
                    </p>
                    {faceImage.name ? (
                      <p className="mt-2 truncate text-xs text-[#7b8490]">
                        {faceImage.name}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                          <label className="inline-flex h-10 cursor-pointer items-center rounded-2xl bg-[#151934] px-4 text-sm font-semibold text-white transition hover:bg-[#252b4a]">
                            上传
                            <input
                              accept="image/*"
                              className="sr-only"
                              onChange={(event) => {
                                updateFaceImage(event.target.files?.[0] ?? null);
                                event.currentTarget.value = "";
                              }}
                              type="file"
                            />
                          </label>
                          <label className="inline-flex h-10 cursor-pointer items-center rounded-2xl border border-[#dfe7ef] bg-[#f7fbff] px-4 text-sm font-semibold text-[#52687f] transition hover:border-[#abc1d6]">
                            拍摄
                            <input
                              accept="image/*"
                              capture="user"
                              className="sr-only"
                              onChange={(event) => {
                                updateFaceImage(event.target.files?.[0] ?? null);
                                event.currentTarget.value = "";
                              }}
                              type="file"
                            />
                          </label>
                          {faceImage.preview ? (
                            <button
                              className="h-10 rounded-2xl border border-[#dfe7ef] bg-white px-4 text-sm font-semibold text-[#52687f] transition hover:border-[#abc1d6]"
                              onClick={handleRemoveFaceImage}
                              type="button"
                            >
                              删除
                            </button>
                          ) : null}
                    </div>
                  </div>

                  <div className="space-y-3 md:min-w-0">
                    <button
                      className="h-11 rounded-2xl bg-[#151934] px-5 text-sm font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                      disabled={
                        !faceImage.file ||
                        faceAnalysisState === "uploading" ||
                        faceAnalysisState === "analyzing"
                      }
                      onClick={handleAnalyzeFaceImage}
                      type="button"
                    >
                      开始面象观察
                    </button>

                    {faceAnalysisState === "uploading" ||
                    faceAnalysisState === "analyzing" ? (
                      <div
                        aria-live="polite"
                        className="flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-sm text-[#657083]"
                        role="status"
                      >
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#d6e2ef] border-t-[#6385a8]" />
                        {faceAnalysisState === "uploading"
                          ? "正在读取图片"
                          : "正在进行面象观察"}
                      </div>
                    ) : null}

                    {faceError ? (
                      <p className="rounded-2xl bg-[#fff1ec] px-4 py-3 text-sm leading-6 text-[#9a4a2d]">
                        {faceError}
                      </p>
                    ) : null}

                    {faceAnalysis ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {faceObservationFields.map((field) => (
                          <div
                            className="rounded-2xl border border-[#e6edf3] bg-white px-4 py-3"
                            key={field.key}
                          >
                            <p className="text-xs font-semibold text-[#7b8490]">
                              {field.label}
                            </p>
                            <p className="mt-1 text-sm font-semibold text-[#26384b]">
                              {faceAnalysis[field.key]}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-[#657083]">
                        面象观察是生成本次会诊结果前的必要步骤。手机上可用“拍摄”调起前置相机；电脑浏览器通常会打开文件选择器。
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {consistencyIssues.length > 0 ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-[#f1c894] bg-[#fff8eb] p-4">
                  <h3 className="text-sm font-semibold text-[#9a5a1c]">
                    需要确认的信息
                  </h3>
                  {consistencyIssues.map((issue) => (
                    <div className="space-y-3" key={issue.id}>
                      <p className="text-sm leading-6 text-[#7a5b38]">
                        {issue.message}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {issue.actions.map((action) => (
                          <button
                            className="rounded-full border border-[#e5b978] bg-white px-4 py-2 text-sm font-semibold text-[#8a541d] transition hover:bg-[#fff2d8]"
                            key={action.id}
                            onClick={() =>
                              handleResolveConsistencyIssue(action.id)
                            }
                            type="button"
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {aiConsistencyIssues.length > 0 ? (
                <div className="mt-4 space-y-3 rounded-2xl border border-[#f1c894] bg-[#fff8eb] p-4">
                  <h3 className="text-sm font-semibold text-[#9a5a1c]">
                    需要进一步确认
                  </h3>
                  {aiConsistencyIssues.map((issue) => (
                    <div className="space-y-3" key={issue.id}>
                      <p className="text-sm leading-6 text-[#7a5b38]">
                        {issue.message}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {issue.options.map((option) => (
                          <button
                            className="rounded-full border border-[#e5b978] bg-white px-4 py-2 text-sm font-semibold text-[#8a541d] transition hover:bg-[#fff2d8]"
                            key={option}
                            onClick={() => handleAiConsistencyOption(issue.id, option)}
                            type="button"
                          >
                            {option}
                          </button>
                        ))}
                      </div>
                      {aiConsistencyDrafts[issue.id] !== undefined ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <input
                            className="h-11 flex-1 rounded-2xl border border-[#e5b978] bg-white px-4 text-sm outline-none transition placeholder:text-[#b88c58] focus:border-[#f0a653] focus:ring-2 focus:ring-[#f8d59b]"
                            onChange={(event) =>
                              setAiConsistencyDrafts((current) => ({
                                ...current,
                                [issue.id]: event.target.value,
                              }))
                            }
                            placeholder="请补充具体情况"
                            type="text"
                            value={aiConsistencyDrafts[issue.id] ?? ""}
                          />
                          <button
                            className="h-11 rounded-2xl bg-[#151934] px-5 text-sm font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                            disabled={!aiConsistencyDrafts[issue.id]?.trim()}
                            onClick={() =>
                              handleConfirmAiConsistencyOther(issue.id)
                            }
                            type="button"
                          >
                            确认
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              <button
                className="mt-4 h-13 w-full rounded-2xl bg-[#151934] px-5 text-base font-semibold text-white transition hover:bg-[#252b4a] disabled:cursor-not-allowed disabled:bg-[#b8c0cf]"
                disabled={
                  !canSubmitFollowUp ||
                  isAnalyzing ||
                  isGeneratingFollowUps ||
                  isCheckingConsistency ||
                  consistencyIssues.length > 0 ||
                  aiConsistencyIssues.length > 0
                }
                onClick={handleSubmitFollowUp}
                type="button"
              >
                {isCheckingConsistency
                  ? "检查信息中"
                  : isAnalyzing
                    ? "分析中"
                    : isObservationComplete
                      ? "提交补充问诊，生成会诊结果"
                      : "完成望诊采集后生成会诊结果"}
              </button>
            </div>
          ) : null}

          {isAnalyzing ? (
            <div className="flex items-start gap-3">
              <ItwinsAvatar />
              <div
                aria-live="polite"
                className="max-w-3xl rounded-[1.5rem] border border-white/80 bg-white px-5 py-4 shadow-[0_12px_34px_rgba(55,48,40,0.08)]"
                role="status"
              >
                <div className="flex items-center gap-3">
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#f3cf8c] border-t-[#f39a40]" />
                  <p className="text-base font-semibold text-[#151934]">
                    正在整理问诊信息并生成分析
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {displayResultCards ? (
            <div className="flex items-start gap-3">
              <ItwinsAvatar />
              <div className="w-full max-w-4xl rounded-[1.5rem] border border-white/80 bg-white p-5 shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="text-xl font-semibold text-[#151934]">
                    会诊结果
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="h-10 w-fit rounded-2xl border border-[#eadfce] bg-white px-4 text-sm font-semibold text-[#866237] transition hover:border-[#f0a653] disabled:cursor-not-allowed disabled:text-[#b9aa94]"
                      disabled={isAnalyzingMultimodal}
                      onClick={handleGenerateMultimodalCompare}
                      type="button"
                    >
                      {isAnalyzingMultimodal
                        ? "Qwen3-VL 生成中"
                        : "Qwen3-VL直出对比"}
                    </button>
                    <button
                      className="h-10 w-fit rounded-2xl border border-[#eadfce] bg-white px-4 text-sm font-semibold text-[#866237] transition hover:border-[#f0a653] disabled:cursor-not-allowed disabled:text-[#b9aa94]"
                      disabled={isComparing}
                      onClick={handleCompareModels}
                      type="button"
                    >
                      {isComparing ? "模型对比中" : "模型对比"}
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {displayResultCards.map((card) => (
                    <article
                      className="rounded-2xl border border-[#e7f0e8] bg-[#f8fcf8] p-4"
                      key={card.title}
                    >
                      <h3 className="font-semibold text-[#1e4f35]">
                        {card.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-[#536057]">
                        {card.content}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          ) : !hasStarted ? (
            <div className="ml-13 grid gap-3 md:grid-cols-4">
              {placeholderResultCards.map((card) => (
                <article
                  className="rounded-2xl border border-white/80 bg-white/65 p-4 text-sm text-[#7b8291]"
                  key={card.title}
                >
                  <h3 className="font-semibold text-[#515762]">{card.title}</h3>
                  <p className="mt-2 leading-6">{card.content}</p>
                </article>
              ))}
            </div>
          ) : null}

          {standardUserMessages.map((message, index) => (
            <div className="space-y-3" key={message.id}>
              <div className="flex items-start justify-end gap-3">
                <div className="max-w-3xl rounded-[1.5rem] bg-[#151934] px-5 py-4 text-base leading-7 text-white shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                  {message.content}
                </div>
              </div>

              {multimodalResultCards ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {standardAssistantMessages[index] ? (
                    <div className="flex items-start gap-3">
                      <ItwinsAvatar />
                      <div className="w-full rounded-[1.5rem] border border-white/80 bg-white px-5 py-4 text-base leading-7 text-[#2d3036] shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7b8291]">
                          标准分层方案
                        </p>
                        <div className="mt-2">
                          {renderRichText(standardAssistantMessages[index].content)}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {multimodalAssistantMessages[index] ? (
                    <div className="flex items-start gap-3">
                      <ItwinsAvatar />
                      <div className="w-full rounded-[1.5rem] border border-[#e5d8f7] bg-[#fcf8ff] px-5 py-4 text-base leading-7 text-[#2d3036] shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8a69b6]">
                          Qwen3-VL直出方案
                        </p>
                        <div className="mt-2">
                          {renderRichText(multimodalAssistantMessages[index].content)}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : standardAssistantMessages[index] ? (
                <div className="flex items-start gap-3">
                  <ItwinsAvatar />
                  <div className="max-w-3xl rounded-[1.5rem] border border-white/80 bg-white px-5 py-4 text-base leading-7 text-[#2d3036] shadow-[0_12px_34px_rgba(55,48,40,0.08)]">
                    {renderRichText(standardAssistantMessages[index].content)}
                  </div>
                </div>
              ) : null}
            </div>
          ))}

          {errorMessage ? (
            <div
              className="rounded-2xl border border-[#e2b9a8] bg-[#fff6f1] px-4 py-3 text-sm leading-6 text-[#8a3f2c]"
              role="alert"
            >
              {errorMessage}
            </div>
          ) : null}
        </section>
      </section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-white/70 bg-[#fbf4e8]/90 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <input
            className="h-14 flex-1 rounded-full border border-white/80 bg-white px-6 text-base outline-none transition placeholder:text-[#b0b2bd] focus:border-[#f0a653] focus:ring-2 focus:ring-[#f8d59b] disabled:cursor-not-allowed disabled:bg-white/60"
            disabled={!resultCards || isChatting || isMultimodalChatting}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleSendChat();
              }
            }}
            placeholder={
              resultCards
                ? "有什么健康问题一起探讨吗？"
                : "生成会诊结果后可继续追问"
            }
            type="text"
            value={chatInput}
          />
          <button
            className="h-14 rounded-full bg-white px-5 font-semibold text-[#151934] shadow-sm transition hover:bg-[#fffaf2] disabled:cursor-not-allowed disabled:text-[#b0b2bd]"
            disabled={
              !resultCards ||
              !chatInput.trim() ||
              isChatting ||
              isMultimodalChatting
            }
            onClick={handleSendChat}
            type="button"
          >
            {isChatting || isMultimodalChatting ? "回复中" : "发送"}
          </button>
        </div>
      </div>

      {isMultimodalCompareOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#171b20]/35 px-5 py-8 backdrop-blur-sm"
          role="dialog"
        >
          <div className="max-h-[86vh] w-full max-w-6xl overflow-hidden rounded-[1.5rem] border border-white/80 bg-white shadow-[0_24px_70px_rgba(23,27,32,0.22)]">
            <div className="flex flex-col gap-3 border-b border-[#edf0f5] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#151934]">
                  Qwen3-VL直出对比
                </h2>
                <p className="mt-1 text-sm text-[#7b8291]">
                  左侧为当前分层方案，右侧为 Qwen3-VL 结合主诉、症状与原始图片直接生成的结果。
                </p>
              </div>
              <button
                className="h-10 rounded-2xl bg-[#151934] px-4 text-sm font-semibold text-white transition hover:bg-[#252b4a]"
                onClick={() => setIsMultimodalCompareOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="max-h-[68vh] overflow-auto p-5">
              {isAnalyzingMultimodal ? (
                <div
                  aria-live="polite"
                  className="flex items-center gap-3 rounded-2xl bg-[#fffaf2] px-4 py-3 text-sm text-[#866237]"
                  role="status"
                >
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#f3cf8c] border-t-[#f39a40]" />
                  正在生成 Qwen3-VL 直出结果
                </div>
              ) : null}

              {displayResultCards ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-[#151934]">
                      标准分层方案
                    </h3>
                    {displayResultCards.map((card) => (
                      <article
                        className="rounded-2xl border border-[#e7f0e8] bg-[#f8fcf8] p-4"
                        key={`standard-${card.title}`}
                      >
                        <h4 className="font-semibold text-[#1e4f35]">
                          {card.title}
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-[#536057]">
                          {card.content}
                        </p>
                      </article>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-base font-semibold text-[#151934]">
                      Qwen3-VL直出方案
                    </h3>
                    {displayMultimodalResultCards ? (
                      <>
                        {displayMultimodalResultCards.map((card) => (
                          <article
                            className="rounded-2xl border border-[#e5d8f7] bg-[#fcf8ff] p-4"
                            key={`multimodal-${card.title}`}
                          >
                            <h4 className="font-semibold text-[#7e58b0]">
                              {card.title}
                            </h4>
                            <p className="mt-2 text-sm leading-6 text-[#5d506f]">
                              {card.content}
                            </p>
                          </article>
                        ))}
                        {multimodalObservationSummary ? (
                          <div className="rounded-2xl border border-[#efe6fb] bg-[#faf7fe] p-4 text-sm leading-6 text-[#695988]">
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8a69b6]">
                              Observation Summary
                            </p>
                            <p className="mt-2">{multimodalObservationSummary}</p>
                          </div>
                        ) : null}
                      </>
                    ) : !isAnalyzingMultimodal ? (
                      <div className="rounded-2xl border border-dashed border-[#eadfce] bg-[#fffaf2] px-5 py-8 text-center text-sm leading-6 text-[#7b8291]">
                        点击会诊结果中的“Qwen3-VL直出对比”后，会在这里显示多模态直出方案。
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isCompareOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#171b20]/35 px-5 py-8 backdrop-blur-sm"
          role="dialog"
        >
          <div className="max-h-[86vh] w-full max-w-6xl overflow-hidden rounded-[1.5rem] border border-white/80 bg-white shadow-[0_24px_70px_rgba(23,27,32,0.22)]">
            <div className="flex flex-col gap-3 border-b border-[#edf0f5] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#151934]">
                  模型对比
                </h2>
                <p className="mt-1 text-sm text-[#7b8291]">
                  使用同一份问诊信息、同一套提示词和同一套结构化结果规则。
                </p>
              </div>
              <button
                className="h-10 rounded-2xl bg-[#151934] px-4 text-sm font-semibold text-white transition hover:bg-[#252b4a]"
                onClick={() => setIsCompareOpen(false)}
                type="button"
              >
                关闭
              </button>
            </div>

            <div className="max-h-[68vh] overflow-auto p-5">
              {isComparing ? (
                <div
                  aria-live="polite"
                  className="flex items-center gap-3 rounded-2xl bg-[#fffaf2] px-4 py-3 text-sm text-[#866237]"
                  role="status"
                >
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#f3cf8c] border-t-[#f39a40]" />
                  正在并行调用对比模型
                </div>
              ) : null}

              {compareError ? (
                <p className="rounded-2xl bg-[#fff1ec] px-4 py-3 text-sm leading-6 text-[#9a4a2d]">
                  {compareError}
                </p>
              ) : null}

              {compareResults.length > 0 ? (
                <div className="grid min-w-[920px] gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {compareResults.map((result) => (
                    <article
                      className="rounded-2xl border border-[#edf0f5] bg-[#fbfcff] p-4"
                      key={result.model}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="font-semibold text-[#151934]">
                            {result.model}
                          </h3>
                          <p className="mt-1 text-xs text-[#8a8f9d]">
                            {result.latencyMs}ms ·{" "}
                            {result.ok ? "解析成功" : "调用失败"}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                            result.ok
                              ? "bg-[#edf8ef] text-[#2d7c47]"
                              : "bg-[#fff1ec] text-[#9a4a2d]"
                          }`}
                        >
                          {result.ok ? "OK" : "ERROR"}
                        </span>
                      </div>

                      {result.ok ? (
                        <div className="mt-4 space-y-3">
                          {result.cards.map((card) => (
                            <section
                              className="rounded-2xl border border-[#e7f0e8] bg-white p-3"
                              key={card.title}
                            >
                              <h4 className="text-sm font-semibold text-[#1e4f35]">
                                {card.title}
                              </h4>
                              <p className="mt-1 text-sm leading-6 text-[#536057]">
                                {card.content}
                              </p>
                            </section>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-4 rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-[#9a4a2d]">
                          {result.error || "模型调用失败。"}
                        </p>
                      )}
                    </article>
                  ))}
                </div>
              ) : !isComparing && !compareError ? (
                <div className="rounded-2xl border border-dashed border-[#eadfce] bg-[#fffaf2] px-5 py-8 text-center text-sm leading-6 text-[#7b8291]">
                  暂无对比结果。点击会诊结果中的“模型对比”后会显示在这里。
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {isHistoryOpen ? (
        <div
          aria-modal="true"
          className="fixed inset-0 z-30 flex items-center justify-center bg-[#171b20]/35 px-5 py-8 backdrop-blur-sm"
          role="dialog"
        >
          <div className="max-h-[82vh] w-full max-w-3xl overflow-hidden rounded-[1.5rem] border border-white/80 bg-white shadow-[0_24px_70px_rgba(23,27,32,0.22)]">
            <div className="flex flex-col gap-3 border-b border-[#edf0f5] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-[#151934]">
                  历史记录
                </h2>
                <p className="mt-1 text-sm text-[#7b8291]">
                  本地保存最近 {maxConsultationHistoryItems} 条记录，不包含原始图片。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  className="h-10 rounded-2xl border border-[#eadfce] bg-white px-4 text-sm font-semibold text-[#866237] transition hover:border-[#f0a653]"
                  onClick={clearConsultationHistory}
                  type="button"
                >
                  清空历史
                </button>
                <button
                  className="h-10 rounded-2xl bg-[#151934] px-4 text-sm font-semibold text-white transition hover:bg-[#252b4a]"
                  onClick={() => setIsHistoryOpen(false)}
                  type="button"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="max-h-[62vh] overflow-y-auto p-5">
              {consultationHistory.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {consultationHistory.map((item) => (
                    <article
                      className="rounded-2xl border border-[#edf0f5] bg-[#fbfcff] p-4"
                      key={item.id}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="line-clamp-2 font-semibold text-[#2b3440]">
                            {item.chiefComplaint || "未填写主诉"}
                          </h3>
                          <p className="mt-1 text-xs text-[#8a8f9d]">
                            {formatHistoryTime(item.createdAt)}
                            {item.selectedTopic
                              ? ` · ${item.selectedTopic}`
                              : ""}
                          </p>
                          <p className="mt-1 text-xs text-[#8a8f9d]">
                            结果来源：
                            {item.resultSources?.includes("multimodal")
                              ? "标准分层 + Qwen3-VL直出"
                              : "标准分层"}
                          </p>
                        </div>
                        <button
                          className="shrink-0 rounded-full bg-[#151934] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#252b4a]"
                          onClick={() => restoreConsultationHistory(item)}
                          type="button"
                        >
                          查看
                        </button>
                      </div>
                      <p className="mt-3 text-sm leading-6 text-[#657083]">
                        症状：
                        {item.selectedSymptoms.length > 0
                          ? item.selectedSymptoms.join("、")
                          : "未选择"}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-[#eadfce] bg-[#fffaf2] px-5 py-8 text-center text-sm leading-6 text-[#7b8291]">
                  暂无历史记录。完成一次会诊后会自动保存在这里。
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
