"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentEvent, AgentImage, AgentMessage } from "@/types/agent";
import styles from "./agent.module.css";

type Step = { label: string; detail: string };
type Message = AgentMessage & { steps?: Step[] };
type Session = { id: string; title: string; messages: Message[]; mode: "demo" | "live" };
const photoLabels = { top: "舌面照片", underside: "舌下照片", face: "面部照片" };
const starters = [
  { icon: "moon", title: "最近睡得不太好", desc: "从睡眠和白天的感受聊起", text: "最近睡得不太好，想梳理一下可能需要关注的生活习惯。" },
  { icon: "cup", title: "吃完饭总觉得胀", desc: "一起了解饮食与消化状态", text: "最近吃完饭总觉得胀，你需要了解哪些情况？" },
  { icon: "spark", title: "想看看我的舌象", desc: "上传照片，了解可见的特征", text: "我想了解自己的舌象，请引导我拍照并补充必要的信息。" },
];

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    leaf: <><path d="M19 4c-8-1-14 3-14 9 0 4 4 6 7 4 4-2 6-7 7-13Z"/><path d="M4 21 15 9M8 16l-1-5m5 1 4-1"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    chat: <path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/>,
    arrow: <path d="m6 12 6-6 6 6M12 6v13"/>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1.4"/><path d="m3 17 6-6 4 4 3-3 5 5"/></>,
    moon: <path d="M20 14A9 9 0 0 1 10 3a9 9 0 1 0 10 11Z"/>,
    cup: <><path d="M4 9h13v6a6.5 6.5 0 0 1-13 0V9Zm13 1h2a3 3 0 0 1 0 6h-2M7 3v2m5-2v2"/></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/></>,
    check: <path d="m5 12 4 4L19 6"/>,
    close: <path d="m6 6 12 12M18 6 6 18"/>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 17v4h16v-4"/>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>,
    chevron: <path d="m9 5 7 7-7 7"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.leaf}</svg>;
}

async function preparePhoto(file: File): Promise<string> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("请选择 JPG、PNG 或 WebP 照片。");
  if (file.size > 8 * 1024 * 1024) throw new Error("原始照片不能超过 8MB。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前浏览器无法处理图片。");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.82);
    if (url.length > 2800000) throw new Error("照片压缩后仍然过大，请选择较小的照片。");
    return url;
  } finally { bitmap.close(); }
}

export default function AgentPage() {
  const [configured, setConfigured] = useState(false);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<AgentImage[]>([]);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionId, setSessionId] = useState("initial");
  const [showSettings, setShowSettings] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const bottom = useRef<HTMLDivElement>(null);
  const photoPanel = useRef<HTMLElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch("/api/agent").then(r => { if (!r.ok) throw new Error(); return r.json(); }).then(data => {
      setConfigured(data.configured); setMode(data.configured ? "live" : "demo"); setReady(true);
    }).catch(() => { setError("暂时无法连接本地服务，请刷新重试。"); });
    return () => { abort.current?.abort(); };
  }, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy, steps]);

  function remember() {
    if (messages.length) setSessions(prev => [{ id: sessionId, title: messages[0].content.slice(0, 16), messages, mode }, ...prev.filter(s => s.id !== sessionId)].slice(0, 8));
  }
  function newSession(nextMode = mode) {
    remember(); setSessionId(crypto.randomUUID()); setMessages([]); setImages([]); setSteps([]); setError(""); setDraft(""); setConsent(false); setMode(nextMode);
  }
  function restore(s: Session) {
    if (s.id === sessionId) return;
    remember(); setSessionId(s.id); setMessages(s.messages); setMode(s.mode); setImages([]); setSteps([]); setError(""); setDraft(""); setConsent(false);
  }

  async function upload(file: File | undefined, kind: AgentImage["kind"]) {
    if (!file || locked.current) return;
    locked.current = true; setPhotoBusy(true); setError("");
    try { const dataUrl = await preparePhoto(file); setImages(prev => [...prev.filter(i => i.kind !== kind), { kind, dataUrl }]); }
    catch (e) { setError(e instanceof Error ? e.message : "照片读取失败，请换一张照片。"); }
    finally { locked.current = false; setPhotoBusy(false); }
  }

  async function send(text = draft) {
    if (!text.trim() || locked.current || !ready) return;
    if (messages.length >= 40) { setError("本次会话已达 20 轮，请新建会话继续。"); return; }
    if (mode === "live" && images.length && !consent) { setError("发送照片前，请勾选照片处理授权；也可以移除照片，仅用文字咨询。"); return; }
    locked.current = true; setBusy(true); setError(""); setDraft(""); setSteps([]);
    const previous = messages;
    const next: Message[] = [...messages, { role: "user", content: text.trim() }];
    setMessages(next);
    const controller = new AbortController(); abort.current = controller;
    const trace: Step[] = [];
    let answer = "";
    let doneReceived = false;
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })), images: mode === "live" ? images : [], mode }), signal: controller.signal });
      if (!response.ok) { const body = await response.json(); throw new Error(body.error || "请求失败。"); }
      if (!response.body) throw new Error("浏览器不支持流式响应。");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      function receive(line: string) {
        if (!line.trim()) return;
        const event = JSON.parse(line) as AgentEvent;
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "step") { trace.push({ label: event.label, detail: event.detail }); setSteps([...trace]); }
        if (event.type === "answer") answer = event.text;
        if (event.type === "done") doneReceived = true;
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() || "";
        lines.forEach(receive);
      }
      buffer += decoder.decode(); receive(buffer);
      if (!doneReceived || !answer) throw new Error("回复未完整返回，请重试。");
      setMessages([...next, { role: "assistant", content: answer, steps: trace }]);
    } catch (e) {
      controller.abort();
      setMessages(previous); setDraft(text);
      setError(e instanceof Error && e.name !== "AbortError" ? e.message : "已停止。本次输入已保留，可修改后重新发送。");
    } finally { setBusy(false); locked.current = false; abort.current = null; }
  }

  function download() {
    const text = `观舌 · ${mode === "demo" ? "体验会话（非真实分析）" : "健康观察会话"}\n${new Date().toLocaleString("zh-CN")}\n仅供健康信息参考，不替代医生面诊。\n\n` + messages.map(m => `${m.role === "user" ? "我" : "观舌 Agent"}\n${m.content}`).join("\n\n────────────\n\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `观舌-会话记录-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className={styles.app}>
    <aside className={styles.sidebar} inert={showSettings}>
      <a href="/" className={styles.brand}><span className={styles.brandMark}><Icon name="leaf" size={28}/></span><span>观舌<small>GUANSHE · HEALTH AGENT</small></span></a>
      <button className={styles.newChat} onClick={() => newSession()} disabled={busy || photoBusy}><Icon name="plus"/>开启新对话<span>↗</span></button>
      <div className={styles.sideLabel}>工作空间</div>
      <div className={styles.activeNav}><Icon name="chat"/>健康对话<span className={styles.dot}/></div>
      <button className={styles.navButton} onClick={() => setShowSettings(true)}><Icon name="info"/>使用与连接设置</button>
      <div className={styles.history}><div className={styles.sideLabel}>本次浏览记录 <span>{sessions.length ? String(sessions.length).padStart(2, "0") : ""}</span></div>
        {!sessions.length ? <p>一段对话，一次更细致的了解。<br/>开启新对话后，记录会留在这里。</p> : sessions.map(s => <button disabled={busy || photoBusy} key={s.id} onClick={() => restore(s)} className={s.id === sessionId ? styles.currentHistory : ""}><Icon name="chat" size={15}/><span>{s.title}</span></button>)}
      </div>
      <div className={styles.sideNote}><span className={styles.smallLeaf}><Icon name="leaf"/></span><strong>让观察，成为关心的开始。</strong><p>从一张舌照、一句近况，<br/>慢慢了解自己的身体。</p></div>
      <div className={styles.localProfile}><span>本</span><div>本地工作空间<small>记录仅在当前页面内保留</small></div><i className={styles.dot}/></div>
    </aside>

    <main className={styles.main} inert={showSettings}>
      <header className={styles.header}><div><span className={styles.mobileBrand}>观舌 / </span>健康对话 <span className={styles.headerSlash}>/</span><span className={styles.muted}> {messages.length ? "进行中的观察" : "新的一次了解"}</span></div>
        <div className={styles.headerActions}><button className={styles.modeBadge} onClick={() => setShowSettings(true)}><span className={styles.dot}/>{!ready ? "连接中" : mode === "demo" ? "体验模式" : "真实 AI"}<Icon name="chevron" size={13}/></button><button className={styles.iconButton} aria-label="导出会话记录" title="导出会话记录" onClick={download} disabled={!messages.length || busy}><Icon name="download"/></button><button className={styles.mobileNew} disabled={busy || photoBusy} onClick={() => newSession()} aria-label="开启新对话"><Icon name="plus"/></button></div>
      </header>
      <div className={styles.workspace}>
        <section className={styles.conversation} aria-label="健康对话">
          <div className={styles.scrollArea}>
            {!messages.length ? <div className={styles.welcome}>
              <div className={styles.eyebrow}><span/> 观察 · 倾听 · 理解</div>
              <div className={styles.heroSymbol}><div/><span><Icon name="leaf" size={49}/></span><i>✧</i></div>
              <h1>身体的近况，<br/>我们慢慢聊。</h1>
              <p className={styles.intro}>我是你的舌象健康观察 Agent。<br/>从最近的感受开始，也可以上传一张舌照。<br/><span>我会帮你梳理线索，找到值得关注的日常习惯。</span></p>
              <div className={styles.starterGrid}>{starters.map(s => <button key={s.title} onClick={() => { setDraft(s.text); draftRef.current?.focus(); }}><span className={styles.starterIcon}><Icon name={s.icon}/></span><strong>{s.title}</strong><small>{s.desc}</small><span className={styles.starterArrow}>↗</span></button>)}</div>
              <div className={styles.flow}><span><b>01</b>说说近况</span><i>—</i><span><b>02</b>补充观察</span><i>—</i><span><b>03</b>一起梳理</span></div>
            </div> : <div className={styles.messages}>
              <div className={styles.sessionCaption}>本次健康观察 · {mode === "demo" ? "离线体验" : "AI 辅助"}</div>
              {messages.map((m, index) => <article key={index} className={m.role === "user" ? styles.userMessage : styles.assistantMessage}>
                {m.role === "assistant" && <div className={styles.assistantLabel}><span><Icon name="leaf" size={17}/></span>观舌 <small>HEALTH AGENT</small></div>}
                {m.steps?.length ? <details className={styles.trace}><summary><Icon name="check" size={14}/>{mode === "demo" ? "体验流程" : `已完成 ${m.steps.length} 个处理步骤`}</summary>{m.steps.map((s, i) => <div key={i}><strong>{s.label}</strong><span>{s.detail}</span></div>)}</details> : null}
                <div className={styles.messageText}>{m.content}</div>
              </article>)}
              {busy && <article className={styles.assistantMessage}><div className={styles.assistantLabel}><span className={styles.pulse}><Icon name="leaf" size={17}/></span>观舌正在处理</div><div className={styles.liveSteps} aria-live="polite">{steps.length ? steps.map((s, i) => <div key={i}><span className={styles.dot}/><strong>{s.label}</strong><small>{s.detail}</small></div>) : <p>正在连接…</p>}</div></article>}
              <div ref={bottom}/>
            </div>}
          </div>
          <div className={styles.composerArea}>
            {mode === "demo" && <div className={styles.demoNotice}><Icon name="info" size={14}/>当前为离线流程体验，不识别照片、不生成个人健康判断。<button onClick={() => setShowSettings(true)}>连接 AI ↗</button></div>}
            {error && <div role="alert" className={styles.error}>{error}<button aria-label="关闭提示" onClick={() => setError("")}><Icon name="close" size={14}/></button></div>}
            <form className={styles.composer} onSubmit={e => { e.preventDefault(); void send(); }}>
              <textarea ref={draftRef} value={draft} maxLength={4000} rows={2} onChange={e => setDraft(e.target.value)} placeholder="说说你最近的感受，例如：这几天容易疲惫，睡醒也没精神…" aria-label="输入健康问题" disabled={busy} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }}/>
              <div className={styles.composerBottom}><button type="button" className={styles.attachButton} disabled={busy || photoBusy} onClick={() => { photoPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" }); photoPanel.current?.focus({ preventScroll: true }); }}><Icon name="image" size={16}/>{images.length ? `${images.length} 张照片` : "添加照片"}</button><span className={styles.composerHint}>不用一次说完整</span>{busy ? <button type="button" className={styles.send} onClick={() => abort.current?.abort()} aria-label="停止生成"><Icon name="stop"/></button> : <button className={styles.send} type="submit" disabled={!draft.trim() || photoBusy || !ready} aria-label="发送消息"><Icon name="arrow"/></button>}</div>
            </form>
            <p className={styles.disclaimer}>仅供健康信息参考，不替代医生诊断与治疗。<span>Enter 发送 · Shift + Enter 换行</span></p>
          </div>
        </section>

        <aside className={styles.observation} ref={photoPanel} tabIndex={-1}>
          <div className={styles.panelTitle}><span><Icon name="image"/>观察资料</span><small>可选</small></div>
          <p className={styles.panelIntro}>一张清晰的照片，<br/>让沟通多一份参考。</p>
          <div className={styles.photoMain}>
            {images.find(i => i.kind === "top") ? <div className={styles.photoPreview}><img src={images.find(i => i.kind === "top")!.dataUrl} alt="已选择的舌面照片"/><button aria-label="移除舌面照片" disabled={busy || photoBusy} onClick={() => setImages(prev => prev.filter(i => i.kind !== "top"))}><Icon name="close" size={15}/></button><span>舌面照片 · 已就绪</span></div> : <label className={styles.uploadArea}>
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || photoBusy} onChange={e => { void upload(e.target.files?.[0], "top"); e.target.value = ""; }}/><div className={styles.photoGuide}><svg viewBox="0 0 84 70" fill="none" aria-hidden="true"><path d="M12 22V11h13m34 0h13v11M12 48v11h13m34 0h13V48" stroke="currentColor" strokeWidth="1.4"/><path d="M27 26c0-10 30-10 30 0v13c0 21-30 21-30 0V26Z" stroke="currentColor" strokeWidth="1.3"/><path d="M42 28v16" stroke="currentColor" opacity=".5"/></svg></div><strong>{photoBusy ? "正在处理照片…" : "上传舌面照片"}</strong><span>点击选择 · JPG / PNG / WebP</span><small><Icon name="plus" size={14}/> 添加照片</small>
            </label>}
          </div>
          <div className={styles.extraPhotos}>{(["underside", "face"] as const).map(kind => {
            const photo = images.find(i => i.kind === kind);
            return <div key={kind}>{photo ? <><img src={photo.dataUrl} alt={photoLabels[kind]}/><span>{photoLabels[kind]}</span><button disabled={busy || photoBusy} onClick={() => setImages(prev => prev.filter(i => i.kind !== kind))} aria-label={`移除${photoLabels[kind]}`}><Icon name="close" size={13}/></button></> : <label><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || photoBusy} onChange={e => { void upload(e.target.files?.[0], kind); e.target.value = ""; }}/><Icon name="plus" size={18}/><span>{photoLabels[kind]}</span></label>}</div>;
          })}</div>
          {images.length > 0 && mode === "live" && <label className={styles.consent}><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} disabled={busy}/>我同意将本次照片和对话发送至配置的 AI 服务进行处理。</label>}
          <div className={styles.tips}><h3>拍照时，留意这三点</h3><p><span>01</span>自然光下拍摄，关闭美颜与滤镜</p><p><span>02</span>舌头自然伸出，让舌面完整入镜</p><p><span>03</span>保持清晰，避免食物染色后拍摄</p></div>
          <div className={styles.privacy}><Icon name="leaf" size={18}/><p>照片仅保留在当前页面内。真实 AI 模式会发送至所配置的模型服务；新建会话或刷新将清除照片。</p></div>
        </aside>
      </div>
    </main>

    {showSettings && <div className={styles.modalBackdrop} onClick={e => { if (e.target === e.currentTarget) setShowSettings(false); }}><section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={e => {
      if (e.key === "Escape") setShowSettings(false);
      if (e.key === "Tab") {
        const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
        const first = buttons[0], last = buttons.at(-1);
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <button autoFocus className={styles.modalClose} aria-label="关闭设置" onClick={() => setShowSettings(false)}><Icon name="close"/></button><div className={styles.eyebrow}>YOUR HEALTH WORKSPACE</div><h2 id="settings-title">选择一种开始方式</h2><p>体验模式用于了解流程。真实 AI 会根据输入调用照片观察与本地知识检索。</p>
      <div className={styles.modeOptions}><button disabled={busy || photoBusy} onClick={() => { if (mode !== "demo") newSession("demo"); setShowSettings(false); }}><strong>离线体验 <span>{mode === "demo" ? "当前模式" : "无需密钥"}</span></strong><small>固定示例对话，不识别照片或提供个性化判断。</small></button><button disabled={!configured || busy || photoBusy} onClick={() => { if (mode !== "live") newSession("live"); setShowSettings(false); }}><strong>真实 AI <span>{configured ? "已配置" : "待连接"}</span></strong><small>多轮追问、图片观察、知识检索与健康信息整理。</small></button></div>
      {!configured && <div className={styles.configHelp}><strong>本地连接说明</strong><p>在项目根目录复制 .env.example 为 .env.local，填入 LLM_API_KEY，重启开发服务后刷新。兼容原有 DASHSCOPE_API_KEY 和 DMX_API_KEY。密钥只存放在服务端，请勿粘贴到聊天框。</p></div>}
      <p className={styles.modalFoot}>切换模式会开始新会话。记录最多保留最近 8 次，刷新页面后清除。此版本用于本地试用。</p>
    </section></div>}
  </div>;
}
