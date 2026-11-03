# 观舌 · 网页健康观察 Agent

在原有中医会诊项目上增加了对话式 Agent 首页。原会诊表单移至 `/classic`，原有 API 和资料保持可用。

## 启动 Agent

```bash
npm ci
npm run dev -- --hostname 127.0.0.1 --port 3210
```

打开 http://127.0.0.1:3210 。默认只绑定本机。未配置密钥时为明确标注的**离线体验模式**：固定示例不识别照片、不解读健康输入、不伪造分析。

连接真实 AI：复制 `.env.example` 为 `.env.local`，填写 `LLM_API_KEY`。支持 `LLM_BASE_URL`、`LLM_DEFAULT_MODEL_ID`、`LLM_TEMPERATURE`、`LLM_TIMEOUT_S`、`VLM_DEFAULT_MODEL_ID` 和 `VLM_TIMEOUT_S`；这些配置优先于旧的 DMX / QWEN 配置，旧密钥变量仍兼容。按服务实际支持情况设置文本模型和视觉模型，然后重启服务。文本模型必须支持 Chat Completions 的 tool calling，视觉模型必须支持图片输入。密钥不得放入 `NEXT_PUBLIC_*` 变量或聊天框。

## 使用方式

1. 说说最近的感受，或点击首页话题填入输入框。
2. 可选择上传舌面、舌下或面部照片，三种照片都不是必填项。支持 JPEG、PNG、WebP，原图不超过 8MB，浏览器压缩至最长边 1200px。
3. 真实模式发送照片前勾选处理授权。Agent 按需观察照片、检索本地知识，并追问缺少的信息。
4. 可继续追问、要求总结、停止当前处理，或使用右上角按钮导出文本会话。
5. 新建会话会清除当前照片；最近 8 次会话暂存在页面内存，刷新后全部清除。切换模式也会新建会话。

手机排版中，照片区在对话区下方。首次试用可先滚动到照片区上传，再返回输入框发送。

## Agent 实现

- `src/features/agent/AgentPage.tsx`：独立对话首页、图片处理、会话上下文、过程展示、取消和错误恢复。
- `src/app/api/agent/route.ts`：GET 返回连接状态；POST 校验输入并返回 NDJSON 事件流，包含 `step`、`answer`、`error`、`done`。
- `src/services/tongueAgent.ts`：模型自主选择工具，服务端执行并将结果回传模型，再生成回复。最多 5 次决策、6 次工具调用，整体超时按 5 次文本调用预算 + 1 次视觉调用预算计算，最多 900 秒；文本默认每次 60 秒，视觉默认每次 120 秒。
- `observe_images`：调用视觉模型判断上传内容、质量和可见特征，不执行诊断；未上传部位不能推断。
- `search_knowledge`：复用项目本地中医知识索引。返回参考材料和条目标题；资料未经过本项目临床验证，不能当作诊断依据。
- `src/services/agentInput.ts`：限制角色、对话长度、图片数与大小，核对图片 MIME 和文件签名。

工具循环参考 [阿里云 Function Calling 文档](https://www.alibabacloud.com/help/en/model-studio/qwen-function-calling)。模型和供应商差异可能影响 tool calling；需要用自己的服务配置做真实联调。

## 数据与能力边界

新增 Agent 接口不将照片、对话或工具内容写入磁盘或原项目的外部监控。真实模式会向配置的模型供应商发送对话，视觉工具执行时发送照片；供应商的数据保留政策由其服务约定决定。前端的步骤列表是工具执行状态，不是模型内部推理。

这是本地试用版：没有账号、服务端历史记录、多用户隔离或公开服务配额控制，请勿直接暴露到公网。原版 `/classic` 使用原有实现和监控逻辑。新 Agent 的提示词约束其不确诊、不处方、不推荐药物剂量；这些约束不是医学可靠性保证，产品尚未经临床验证。

验证命令：

```bash
npm run build
npm run test:agent
```

自动化集成测试使用本机模拟模型服务验证真实工具调用协议、上下文、输入校验和错误恢复，不调用付费模型，不验证医学准确性。真实图片识别和回答质量需配置密钥后单独验证。

---

以下为原演示项目文档（其中部署地址、缺失文档链接和旧范围描述仅作历史参考）。

# Bitwins TCM Consultation MVP（原版）

Standalone MVP for the TCM consultation page.

## Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Deploy

Recommended production setup:

- host on `Vercel`
- send logs/metrics to `Better Stack`

Deployment guide:

- [docs/deploy-vercel-better-stack.md](/Users/lydiab/Desktop/bitwins/docs/deploy-vercel-better-stack.md)
- [docs/release-checklist.md](/Users/lydiab/Desktop/bitwins/docs/release-checklist.md)
- copy environment variables from `.env.example`

Health check endpoint:

- `/api/health`

## Current scope

The app currently implements one single-page TCM consultation flow:

- quick topic tags
- chief complaint input
- symptom tag selection
- mock follow-up questions
- loading states
- structured result cards
- mock follow-up chat

Out of scope for this MVP: homepage integration, payment, membership, real doctor integration, tongue diagnosis, pulse devices, full RAG, and PDF export.

## Project structure

```text
src/
  app/                 Next.js app entry
  features/tcm/        TCM consultation page UI
  services/            API/mock service boundary
  types/               Shared TypeScript contracts
```

## Mock service boundary

The page calls only the service functions in `src/services/tcmConsult.ts`:

- `startConsultation()`
- `submitFollowUp()`
- `continueChat()`

The shared request/response contracts live in `src/types/tcm.ts`.

The default mode uses local mock data. To use DMXAPI, create `.env.local`:

```bash
DMX_API_KEY=sk-your-dmx-key
DMX_BASE_URL=https://www.dmxapi.cn/v1
DMX_TEXT_MODEL=gpt-5-mini
DMX_VISION_MODEL=qwen3-vl-plus
DMX_COMPARE_TEXT_MODELS=qwen-max-latest,deepseek-v4-pro,gpt-5
NEXT_PUBLIC_TCM_SERVICE_MODE=dmx
```

Then restart `npm run dev`.

The legacy DashScope/Qwen variables are still supported as a fallback:

```bash
DASHSCOPE_API_KEY=sk-your-key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
QWEN_MODEL=qwen-plus
QWEN_VISION_MODEL=qwen3-vl-plus
NEXT_PUBLIC_TCM_SERVICE_MODE=qwen
```

In API mode, `submitFollowUp()` calls `/api/tcm/analyze` and `continueChat()` calls `/api/tcm/chat`. `startConsultation()` also calls `/api/tcm/start`.

`DMX_COMPARE_TEXT_MODELS` powers the internal model comparison modal on the TCM result screen. The current setup compares the latest available Qwen, DeepSeek, and GPT text models on DMXAPI. If the current homepage main model is also in this list, the compare API reuses the already generated homepage result instead of calling the same model twice.

## Verification

```bash
npm run lint
npm run build
```
