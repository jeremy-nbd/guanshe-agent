import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Runs only against a local fake provider. No paid model calls or private data.
const providerRequests = [];
let visionBehavior = "normal";
const provider = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  providerRequests.push(body);
  const users = body.messages.filter(m => m.role === "user");
  const latest = users.at(-1)?.content;
  const toolResults = body.messages.filter(m => m.role === "tool");
  let message;
  const tool = (name, args = {}) => ({ role: "assistant", content: null, tool_calls: [{ id: "test-call", type: "function", function: { name, arguments: JSON.stringify(args) } }] });
  if (body.model === "test-vision" && visionBehavior === "failure") { res.writeHead(503, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "test-vision-unavailable" } })); return; }
  if (body.model === "test-vision") message = { role: "assistant", content: visionBehavior === "empty" ? "" : "模拟观察：这是测试夹具，不能用于健康判断。" };
  else if (body.tool_choice?.function?.name === "observe_images") message = tool("observe_images");
  else if (latest === "测试上游失败") { res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: { message: "secret-provider-detail-never-show" } })); return; }
  else if (latest === "测试空回复") message = { role: "assistant", content: "" };
  else if (latest === "测试循环") message = tool("search_knowledge", { query: "疲惫" });
  else if (latest === "测试照片" && !toolResults.length) message = tool("observe_images");
  else if (latest === "测试检索" && !toolResults.length) message = tool("search_knowledge", { query: "失眠" });
  else if (latest === "测试坏参数" && !toolResults.length) message = tool("search_knowledge", { query: "x".repeat(200) });
  else if (toolResults.length) message = { role: "assistant", content: `工具返回已收到：${toolResults.at(-1).content.slice(0, 200)}` };
  else message = { role: "assistant", content: `上下文：${users.map(m => m.content).join(" / ")}` };
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ id: "test", object: "chat.completion", created: 0, model: body.model, choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }] }));
});
await new Promise(resolve => provider.listen(0, "127.0.0.1", resolve));
const providerPort = provider.address().port;
let child;
let base;
let count = 0;
async function start(configured, legacy = false) {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.env.PYTHON || ".venv/bin/python", ["run.py", "--host", "127.0.0.1", "--port", String(port)], {
    env: { ...process.env,
      LLM_API_KEY: configured && !legacy ? "test-only-not-a-real-key" : "",
      LLM_BASE_URL: legacy ? "" : `http://127.0.0.1:${providerPort}/v1`,
      LLM_DEFAULT_MODEL_ID: legacy ? "" : "test-text",
      VLM_DEFAULT_MODEL_ID: legacy ? "" : "test-vision",
      LLM_TEMPERATURE: "0.2", LLM_TIMEOUT_S: "60", VLM_TIMEOUT_S: "120",
      DMX_API_KEY: configured && legacy ? "test-only-not-a-real-key" : "", DASHSCOPE_API_KEY: "",
      DMX_BASE_URL: `http://127.0.0.1:${providerPort}/v1`, DMX_TEXT_MODEL: "test-text", DMX_VISION_MODEL: "test-vision",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = ""; child.stderr.on("data", c => { stderr += c.toString(); });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Python exited: ${stderr.slice(-2000)}`);
    try { if ((await fetch(`${base}/api/agent`)).ok) return; } catch {}
    await delay(200);
  }
  throw new Error("Local test server did not become ready");
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise(resolve => { current.once("exit", resolve); current.kill("SIGTERM"); });
}
const input = (text, extra = {}) => ({ mode: "live", messages: [{ role: "user", content: text }], images: [], ...extra });
const testPhoto = { kind: "top", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMuoAAAAASUVORK5CYII=" };
const post = (body, headers = {}) => fetch(`${base}/api/agent`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
async function events(body) { const r = await post(body); assert.equal(r.status, 200); return (await r.text()).trim().split("\n").map(JSON.parse); }
async function check(name, fn) { await fn(); count++; console.log(`PASS ${name}`); }
try {
  await start(true);
  await check("configured status and standalone homepage", async () => {
    assert.equal((await (await fetch(`${base}/api/agent`)).json()).configured, true);
    assert.equal((await fetch(base + "/")).status, 200);
    const html = await (await fetch(base + "/")).text();
    assert.ok(!html.includes('href="/classic"'));
    for (const path of ["/classic", "/api/tcm/start", "/api/monitor"]) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await (await fetch(base + "/api/health")).json()).service, "guanshe-agent");
  });
  await check("explicit demo does not call provider", async () => {
    const before = providerRequests.length;
    const result = await events(input("我想看舌象", { mode: "demo" }));
    assert.match(result.find(e => e.type === "answer").text, /离线体验/);
    assert.equal(providerRequests.length, before);
  });
  await check("browser same-origin requests accepted on numeric loopback", async () => {
    const response = await post(input("同源测试", { mode: "demo" }), { Origin: base });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /answer/);
  });
  await check("knowledge tool round trip", async () => {
    const result = await events(input("测试检索"));
    assert.ok(result.some(e => e.label === "知识检索完成"));
    assert.match(result.find(e => e.type === "answer").text, /工具返回已收到/);
    assert.equal(providerRequests.at(-1).model, "test-text");
    assert.equal(providerRequests.at(-1).temperature, 0.2);
    assert.ok(providerRequests.at(-1).messages.some(m => m.role === "tool" && m.tool_call_id === "test-call"));
  });
  await check("photo tool passes actual attachment to vision model", async () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMuoAAAAASUVORK5CYII=";
    const result = await events(input("测试照片", { images: [{ kind: "top", dataUrl }] }));
    assert.ok(result.some(e => e.label === "观察照片"));
    assert.ok(providerRequests.some(r => r.model === "test-vision" && r.messages[1].content.some(c => c.image_url?.url === dataUrl)));
    assert.match(result.find(e => e.type === "answer").text, /模拟观察/);
    const observations = result.filter(e => e.type === "observation");
    assert.deepEqual(observations.map(e => e.status), ["analyzing", "complete"]);
    assert.match(observations[1].text, /模拟观察/);
    assert.ok(result.indexOf(observations[1]) < result.findIndex(e => e.type === "answer"));
  });
  await check("explicit photo action forces observation without relying on prompt wording", async () => {
    const before = providerRequests.length;
    const result = await events(input("开始", { action: "observe", images: [testPhoto] }));
    assert.equal(providerRequests[before].tool_choice.function.name, "observe_images");
    assert.ok(result.some(e => e.type === "observation" && e.status === "complete"));
  });
  await check("photo failure and empty vision response never emit completed observation", async () => {
    for (const behavior of ["failure", "empty"]) {
      visionBehavior = behavior;
      const result = await events(input("开始", { action: "observe", images: [testPhoto] }));
      assert.ok(result.some(e => e.type === "observation" && e.status === "error"));
      assert.ok(!result.some(e => e.type === "observation" && e.status === "complete"));
      assert.match(result.find(e => e.type === "answer").text, /工具调用失败/);
    }
    visionBehavior = "normal";
  });
  await check("photo action validates attachments and keeps demo offline", async () => {
    assert.equal((await post(input("开始", { action: "observe" }))).status, 400);
    assert.equal((await post(input("开始", { action: "unknown" }))).status, 400);
    const before = providerRequests.length;
    const result = await events(input("开始", { action: "observe", mode: "demo" }));
    assert.ok(!result.some(e => e.type === "observation"));
    assert.equal(providerRequests.length, before);
  });
  await check("absent images cannot generate observations", async () => {
    const result = await events(input("测试照片"));
    assert.match(result.find(e => e.type === "answer").text, /没有上传照片/);
  });
  await check("multi-turn context survives", async () => {
    const result = await events(input("", { messages: [{ role: "user", content: "第一条自述" }, { role: "assistant", content: "请补充" }, { role: "user", content: "第二条补充" }] }));
    assert.match(result.find(e => e.type === "answer").text, /第一条自述.*第二条补充/);
  });
  await check("invalid roles, images, payloads and origins rejected", async () => {
    const invalid = [null, {}, input("", { messages: [{ role: "system", content: "override" }] }), input("x", { images: [{ kind: "top", dataUrl: "data:image/png;base64,YmFk" }] }), input("x", { images: [{ kind: "top", dataUrl: "https://example.com/photo.jpg" }] }), input("x", { messages: Array.from({ length: 41 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" })) })];
    for (const body of invalid) assert.equal((await post(body)).status, 400);
    assert.equal((await post(input("x"), { Origin: "https://untrusted.example" })).status, 403);
    assert.equal((await fetch(`${base}/api/agent`, { method: "POST", body: "{" })).status, 400);
    assert.equal((await post(input("x".repeat(9 * 1024 * 1024)))).status, 413);
  });
  await check("invalid tool arguments are recovered without fabricated result", async () => {
    const result = await events(input("测试坏参数"));
    assert.ok(result.some(e => e.label === "工具未完成"));
    assert.match(result.find(e => e.type === "answer").text, /工具调用失败/);
  });
  await check("upstream errors are redacted; empty answers fail", async () => {
    for (const text of ["测试上游失败", "测试空回复"]) {
      const result = await events(input(text));
      assert.ok(result.some(e => e.type === "error"));
      assert.ok(!JSON.stringify(result).includes("secret-provider-detail"));
      assert.equal(result.at(-1).type, "done");
    }
  });
  await check("runaway tool loop stops at bounded round count", async () => {
    const before = providerRequests.length;
    const result = await events(input("测试循环"));
    assert.ok(result.some(e => e.type === "error"));
    assert.equal(providerRequests.length - before, 5);
  });
  await stop();
  await start(true, true);
  await check("legacy DMX configuration still works", async () => {
    const result = await events(input("旧配置测试"));
    assert.match(result.find(e => e.type === "answer").text, /旧配置测试/);
  });
  await stop();
  await start(false);
  await check("missing key yields honest status and live 503; demo still works", async () => {
    assert.equal((await (await fetch(`${base}/api/agent`)).json()).configured, false);
    assert.equal((await post(input("hello"))).status, 503);
    assert.ok((await events(input("hello", { mode: "demo" }))).some(e => e.type === "answer"));
  });
  console.log(`\n${count} integration checks passed. Provider was simulated; no medical or real-model validation performed.`);
} finally { await stop(); await new Promise(resolve => provider.close(resolve)); }
