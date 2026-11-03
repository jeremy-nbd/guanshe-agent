export type AgentMessage = { role: "user" | "assistant"; content: string };
export type AgentImage = { kind: "top" | "underside" | "face"; dataUrl: string };
export type AgentInput = { messages: AgentMessage[]; images: AgentImage[]; mode: "demo" | "live" };
export type AgentEvent =
  | { type: "step"; label: string; detail: string }
  | { type: "answer"; text: string }
  | { type: "error"; message: string }
  | { type: "done" };
