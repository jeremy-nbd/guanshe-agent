import type { AgentInput, AgentImage, AgentMessage } from "@/types/agent";

export function parseAgentInput(value: unknown): AgentInput {
  if (!value || typeof value !== "object") throw new Error("请求格式不正确。");
  const v = value as Record<string, unknown>;
  if (v.mode !== "demo" && v.mode !== "live") throw new Error("请选择体验或真实 AI 模式。");
  const action = v.action ?? "chat";
  if (action !== "chat" && action !== "observe") throw new Error("不支持的操作。");
  if (!Array.isArray(v.messages) || !v.messages.length || v.messages.length > 40) throw new Error("一次会话最多 20 轮，请开启新会话。");
  let total = 0;
  const messages: AgentMessage[] = v.messages.map((m, i) => {
    if (!m || m.role !== (i % 2 === 0 ? "user" : "assistant") || typeof m.content !== "string" || !m.content.trim() || m.content.length > 8000) throw new Error("对话内容或顺序不正确。");
    total += m.content.length;
    return { role: m.role, content: m.content.trim() };
  });
  if (total > 60000 || messages.at(-1)?.role !== "user") throw new Error("对话过长或缺少当前问题，请开启新会话。");
  if (!Array.isArray(v.images) || v.images.length > 3) throw new Error("最多上传三张照片。");
  const seen = new Set<string>();
  const images: AgentImage[] = v.images.map((img) => {
    if (!img || !["top", "underside", "face"].includes(img.kind) || seen.has(img.kind) || typeof img.dataUrl !== "string" || img.dataUrl.length > 2800000) throw new Error("照片格式、数量或大小不正确。");
    seen.add(img.kind);
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(img.dataUrl);
    if (!match) throw new Error("照片仅支持 JPEG、PNG、WebP。");
    const bytes = Buffer.from(match[2], "base64");
    const valid = match[1] === "jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : match[1] === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!valid) throw new Error("照片内容与格式不符，请重新选择。");
    return { kind: img.kind, dataUrl: img.dataUrl };
  });
  if (action === "observe" && v.mode === "live" && !images.length) throw new Error("请先添加一张照片，再开始观察。");
  return { messages, images, mode: v.mode, action };
}
