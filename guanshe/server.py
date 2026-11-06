"""Single Python service for the browser UI and NDJSON Agent API."""

import asyncio
import json
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .agent import run_agent
from .config import ROOT, Settings
from .validation import parse_input

settings = Settings()
MAX_BODY = 9 * 1024 * 1024


@asynccontextmanager
async def lifespan(app):
    async with httpx.AsyncClient() as client:
        app.state.client = client
        yield


app = FastAPI(title='观舌 Agent', lifespan=lifespan)


@app.get('/api/health')
async def health():
    return {'service': 'guanshe-agent', 'status': 'ok'}


@app.get('/api/agent')
async def status():
    configured = bool(settings.api_key)
    return JSONResponse({'configured': configured, 'defaultMode': 'live' if configured else 'demo'},
                        headers={'Cache-Control': 'no-store'})


def event_line(event):
    return json.dumps(event, ensure_ascii=False) + '\n'


async def stream_events(data, client):
    try:
        async with asyncio.timeout(settings.agent_timeout):
            async for event in run_agent(data, settings, client):
                yield event_line(event)
    except TimeoutError:
        yield event_line({'type': 'error', 'message': '本次处理超时，请重试或减少照片。'})
    except Exception:
        yield event_line({'type': 'error', 'message': '模型暂时无法完成请求，请检查密钥、模型名称和网络连接后重试。'})
    yield event_line({'type': 'done'})


@app.post('/api/agent')
async def agent(request: Request):
    origin = request.headers.get('origin')
    if origin:
        try:
            source = urlsplit(origin)
            same_origin = source.netloc == request.headers.get('host') and source.scheme == request.url.scheme
        except ValueError:
            same_origin = False
        if not same_origin:
            return JSONResponse({'error': '不允许跨站请求。'}, status_code=403)
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY:
            return JSONResponse({'error': '上传内容过大，请压缩照片。'}, status_code=413)
        body.extend(chunk)
    try:
        data = parse_input(json.loads(body))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return JSONResponse({'error': '请求不是有效 JSON。'}, status_code=400)
    except ValueError as error:
        return JSONResponse({'error': str(error)}, status_code=400)
    if data['mode'] == 'live' and not settings.api_key:
        return JSONResponse({'error': '请在 .env.local 中设置 LLM_API_KEY，重启服务后使用真实 AI。'}, status_code=503)
    # StreamingResponse cancels the async generator on client disconnection.
    return StreamingResponse(stream_events(data, request.app.state.client),
                             media_type='application/x-ndjson',
                             headers={'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no'})


app.mount('/', StaticFiles(directory=ROOT / 'web', html=True), name='web')
