import { parseAgentInput } from "@/services/agentInput";
import { runTongueAgent } from "@/services/tongueAgent";
import { hasQwenConfig, agentTimeoutMs } from "@/services/qwenClient";
import type { AgentEvent } from "@/types/agent";

export const runtime = "nodejs";
export const maxDuration = 900;
const configured = hasQwenConfig;

export function GET() {
  return Response.json({ configured: configured(), defaultMode: configured() ? "live" : "demo" }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize request.url to localhost even when the browser uses 127.0.0.1.
  // The HTTP Host is the actual browser destination; never trust X-Forwarded-Host here.
  if (origin) {
    let sameOrigin = false;
    try {
      const source = new URL(origin);
      sameOrigin = source.host === request.headers.get("host") && source.protocol === new URL(request.url).protocol;
    } catch { /* Reject malformed and opaque origins. */ }
    if (!sameOrigin) return Response.json({ error: "不允许跨站请求。" }, { status: 403 });
  }
  let input;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("缺少请求内容。");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 9 * 1024 * 1024) { await reader.cancel(); return Response.json({ error: "上传内容过大，请压缩照片。" }, { status: 413 }); }
      chunks.push(value);
    }
    input = parseAgentInput(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "请求不是有效 JSON。" : error instanceof Error ? error.message : "请求格式不正确。" }, { status: 400 });
  }
  if (input.mode === "live" && !configured()) return Response.json({ error: "尚未配置模型密钥。请在 .env.local 中设置 LLM_API_KEY，重启服务后使用真实 AI（兼容 DASHSCOPE_API_KEY 和 DMX_API_KEY）。" }, { status: 503 });
  const timeout = AbortSignal.timeout(agentTimeoutMs);
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, timeout, controller.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(output) {
      const emit = (event: AgentEvent) => { if (!controller.signal.aborted) output.enqueue(encoder.encode(JSON.stringify(event) + "\n")); };
      try { await runTongueAgent(input, emit, signal); }
      catch { emit({ type: "error", message: timeout.aborted ? "本次处理超时，请重试或减少照片。" : "模型暂时无法完成请求，请检查密钥、模型名称和网络连接后重试。" }); }
      finally { if (!controller.signal.aborted) { emit({ type: "done" }); output.close(); } }
    },
    cancel() { controller.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
