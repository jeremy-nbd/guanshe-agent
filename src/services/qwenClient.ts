import OpenAI from "openai";

const env = (name: string) => process.env[name]?.trim() || undefined;
const llmApiKey = env("LLM_API_KEY");
const dmxApiKey = env("DMX_API_KEY");
const dashscopeApiKey = env("DASHSCOPE_API_KEY");
const isUsingDmx = Boolean(dmxApiKey);

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = env(name);
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export const llmTemperature = numberEnv("LLM_TEMPERATURE", 0.2, 0, 2);
export const llmTimeoutMs = numberEnv("LLM_TIMEOUT_S", 60, 1, 300) * 1000;
export const vlmTimeoutMs = numberEnv("VLM_TIMEOUT_S", 120, 1, 300) * 1000;
export const agentTimeoutMs = Math.min(900000, 5 * llmTimeoutMs + vlmTimeoutMs);

export function hasQwenConfig() {
  return Boolean(llmApiKey || dmxApiKey || dashscopeApiKey);
}

export const qwenModel =
  env("LLM_DEFAULT_MODEL_ID") ?? env("DMX_TEXT_MODEL") ?? env("QWEN_MODEL") ?? "qwen3.5-plus";
export const qwenVisionModel =
  env("VLM_DEFAULT_MODEL_ID") ??
  env("DMX_VISION_MODEL") ??
  env("QWEN_VISION_MODEL") ??
  "qwen3-vl-plus";

let qwenClient: OpenAI | null = null;

export function assertQwenConfig() {
  if (!hasQwenConfig()) {
    throw new Error("Missing LLM_API_KEY, DMX_API_KEY or DASHSCOPE_API_KEY");
  }
}

export function getQwenClient() {
  assertQwenConfig();

  qwenClient ??= new OpenAI({
    apiKey: llmApiKey ?? dmxApiKey ?? dashscopeApiKey,
    timeout: llmTimeoutMs,
    baseURL:
      env("LLM_BASE_URL") ??
      env("DMX_BASE_URL") ??
      env("QWEN_BASE_URL") ??
      (!llmApiKey && isUsingDmx
        ? "https://www.dmxapi.cn/v1"
        : "https://dashscope.aliyuncs.com/compatible-mode/v1"),
  });

  return qwenClient;
}
