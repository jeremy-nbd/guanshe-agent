export type FollowUpQuestion = {
  answerMode?: "single" | "multi";
  exclusiveOptions?: string[];
  id: string;
  maxSelections?: number;
  allowOther?: boolean;
  question: string;
  options: string[];
};

export type FollowUpAnswerValue = string | string[];

export type ResultCard = {
  title: string;
  content: string;
};

export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

export type ObservationState =
  | "idle"
  | "uploading"
  | "analyzing"
  | "success"
  | "error";

export type TongueImageStatus =
  | "no_tongue_detected"
  | "poor_quality"
  | "usable";

export type FaceImageStatus =
  | "no_face_detected"
  | "poor_quality"
  | "usable";

export type TongueAnalysisResult = {
  imageStatus: TongueImageStatus;
  imageQuality: string;
  qualityMessage: string;
  tongueBodyColor: string;
  tongueCoatColor: string;
  tongueCoatThickness: string;
  tongueShape: string;
  teethMarks: string;
  cracks: string;
  moisture: string;
  sublingualVessels: string;
};

export type FaceAnalysisResult = {
  imageStatus: FaceImageStatus;
  imageQuality: string;
  qualityMessage: string;
  complexion: string;
  luster: string;
  localColor: string;
  eyeArea: string;
  lipColor: string;
  facialExpression: string;
};

export type ConsultationObservation = {
  face?: FaceAnalysisResult;
  hasFaceInput: boolean;
  hasTongueInput: boolean;
  tongue?: TongueAnalysisResult;
};

export type StartConsultationRequest = {
  chiefComplaint: string;
  selectedSymptoms: string[];
  selectedTopic: string | null;
};

export type SubmitFollowUpRequest = StartConsultationRequest & {
  followUpAnswers: Record<string, FollowUpAnswerValue>;
  observation?: ConsultationObservation;
};

export type ConsistencyIssue = {
  id: string;
  message: string;
  options: string[];
};

export type ConsistencyCheckResponse = {
  needsClarification: boolean;
  issues: ConsistencyIssue[];
};

export type ContinueChatRequest = {
  question: string;
  resultCards: ResultCard[];
  previousMessages: ChatMessage[];
};

export type MultimodalAnalyzeResponse = {
  cards: ResultCard[];
  observationSummary: string;
};

export type ContinueMultimodalChatRequest = {
  chiefComplaint: string;
  followUpAnswers: Record<string, FollowUpAnswerValue>;
  observationSummary: string;
  previousMessages: ChatMessage[];
  question: string;
  resultCards: ResultCard[];
  selectedSymptoms: string[];
  selectedTopic: string | null;
};

export type ModelCompareRequest = {
  currentResultCards?: ResultCard[];
  request: SubmitFollowUpRequest;
};

export type ModelCompareResult = {
  cards: ResultCard[];
  error?: string;
  latencyMs: number;
  model: string;
  ok: boolean;
};

export type ModelCompareResponse = {
  results: ModelCompareResult[];
};

export type ConsultationHistoryItem = {
  id: string;
  createdAt: string;
  chiefComplaint: string;
  selectedTopic: string | null;
  selectedSymptoms: string[];
  followUpAnswers: Record<string, FollowUpAnswerValue>;
  observation?: ConsultationObservation;
  resultCards: ResultCard[];
  chatMessages: ChatMessage[];
  multimodalChatMessages?: ChatMessage[];
  multimodalObservationSummary?: string | null;
  multimodalResultCards?: ResultCard[] | null;
  resultSources?: ("standard" | "multimodal")[];
};

export type TcmConsultService = {
  startConsultation(
    request: StartConsultationRequest,
  ): Promise<FollowUpQuestion[]>;
  checkConsultationConsistency(
    request: SubmitFollowUpRequest,
  ): Promise<ConsistencyCheckResponse>;
  submitFollowUp(request: SubmitFollowUpRequest): Promise<ResultCard[]>;
  continueChat(request: ContinueChatRequest): Promise<string>;
};
