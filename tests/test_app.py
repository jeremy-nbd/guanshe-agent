"""Exercise the Python API with a simulated provider, never a real model."""

import asyncio
import json
import os
import subprocess
import sys
import unittest
from dataclasses import replace
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from guanshe import server
from guanshe.agent import run_agent
from guanshe.config import Settings, number
from guanshe.validation import parse_input

PHOTO = {
    'kind': 'top',
    'dataUrl': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMuoAAAAASUVORK5CYII=',
}
CONFIG = Settings(api_key='test-only', base_url='https://model.invalid/v1',
                  text_model='test-text', vision_model='test-vision')


def payload(text='你好', **changes):
    return {'mode': 'live', 'messages': [{'role': 'user', 'content': text}], 'images': [], **changes}


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.behavior = 'normal'
        self.settings_patch = patch.object(server, 'settings', CONFIG)
        self.settings_patch.start()
        self.addCleanup(self.settings_patch.stop)
        self.client = self.enterContext(TestClient(server.app))
        fake = httpx.AsyncClient(transport=httpx.MockTransport(self.provider))
        server.app.state.client = fake
        self.addCleanup(lambda: asyncio.run(fake.aclose()))

    def provider(self, request):
        data = json.loads(request.content)
        self.calls.append(data)
        if self.behavior == 'error':
            return httpx.Response(401, json={'error': 'secret-must-not-appear'})
        if data['model'] == 'test-vision':
            content = '' if self.behavior == 'empty-vision' else '模拟照片观察结果'
            message = {'role': 'assistant', 'content': content}
        elif data.get('tool_choice') == {'type': 'function', 'function': {'name': 'observe_images'}}:
            message = self.tool('observe_images', {})
        elif self.behavior == 'loop':
            message = self.tool('search_knowledge', {'query': '失眠'})
        elif self.behavior == 'knowledge' and not any(item['role'] == 'tool' for item in data['messages']):
            message = self.tool('search_knowledge', {'query': '失眠'})
        else:
            message = {'role': 'assistant', 'content': '模拟回复'}
        return httpx.Response(200, json={'choices': [{'message': message}]})

    @staticmethod
    def tool(name, arguments):
        return {'role': 'assistant', 'content': None, 'tool_calls': [
            {'id': 'tool-1', 'type': 'function', 'function': {'name': name, 'arguments': json.dumps(arguments)}}
        ]}

    def events(self, data):
        response = self.client.post('/api/agent', json=data)
        self.assertEqual(response.status_code, 200)
        return [json.loads(line) for line in response.text.splitlines()]

    def test_static_entry_and_assets(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('观舌', response.text)
        self.assertEqual(self.client.get('/api/health').json()['service'], 'guanshe-agent')
        self.assertEqual(self.client.get('/.env.local').status_code, 404)
        self.assertEqual(self.client.get('/classic').status_code, 404)

    def test_demo_turns_and_missing_key(self):
        with patch.object(server, 'settings', replace(CONFIG, api_key='')):
            self.assertFalse(self.client.get('/api/agent').json()['configured'])
            self.assertEqual(self.client.post('/api/agent', json=payload()).status_code, 503)
            history = []
            for turn in range(3):
                history.append({'role': 'user', 'content': f'体验第 {turn} 轮'})
                events = self.events(payload(mode='demo', messages=history))
                answer = next(event['text'] for event in events if event['type'] == 'answer')
                history.append({'role': 'assistant', 'content': answer})
            self.assertIn('体验报告结构', answer)
            self.assertFalse(self.calls)

    def test_forced_vision_and_event_order(self):
        events = self.events(payload('开始', action='observe', images=[PHOTO]))
        observations = [event for event in events if event['type'] == 'observation']
        self.assertEqual([event['status'] for event in observations], ['analyzing', 'complete'])
        self.assertLess(events.index(observations[-1]), next(i for i, event in enumerate(events) if event['type'] == 'answer'))
        self.assertEqual(self.calls[1]['messages'][1]['content'][1]['image_url']['url'], PHOTO['dataUrl'])
        self.assertEqual(self.calls[-1]['messages'][-1]['role'], 'tool')

    def test_empty_vision_recovery(self):
        self.behavior = 'empty-vision'
        events = self.events(payload('开始', action='observe', images=[PHOTO]))
        self.assertTrue(any(event.get('status') == 'error' for event in events))
        self.assertFalse(any(event.get('status') == 'complete' for event in events))
        self.assertIn('工具调用失败', self.calls[-1]['messages'][-1]['content'])

    def test_history_is_preserved_without_cross_request_state(self):
        history = [
            {'role': 'user', 'content': '第一次输入'},
            {'role': 'assistant', 'content': '请补充'},
            {'role': 'user', 'content': '第二次输入'},
        ]
        self.events(payload(messages=history))
        self.assertEqual(self.calls[-1]['messages'][1:4], history)
        self.events(payload('另一个会话'))
        self.assertNotIn('第一次输入', json.dumps(self.calls[-1], ensure_ascii=False))

    def test_cached_observations_do_not_leak_between_requests(self):
        for _ in range(2):
            events = self.events(payload('开始', action='observe', images=[PHOTO]))
            self.assertTrue(any(event.get('status') == 'complete' for event in events))
        self.assertEqual(sum(call['model'] == 'test-vision' for call in self.calls), 2)

    def test_knowledge_loop_and_redaction(self):
        self.behavior = 'knowledge'
        events = self.events(payload())
        self.assertTrue(any(event.get('label') == '知识检索完成' for event in events))
        self.assertIn('【', self.calls[-1]['messages'][-1]['content'])
        self.behavior = 'loop'
        before = len(self.calls)
        events = self.events(payload())
        self.assertEqual(len(self.calls) - before, 5)
        self.assertEqual(events[-2]['type'], 'error')
        self.behavior = 'error'
        events = self.events(payload())
        self.assertNotIn('secret-must-not-appear', str(events))
        self.assertEqual(events[-1]['type'], 'done')

    def test_input_origin_size_and_photo_validation(self):
        for data in [None, {}, payload(action='observe'), payload(images=[PHOTO, PHOTO]),
                     payload(messages=[{'role': 'system', 'content': 'override'}]),
                     payload(images=[{**PHOTO, 'dataUrl': 'data:image/png;base64,YmFk'}])]:
            self.assertEqual(self.client.post('/api/agent', json=data).status_code, 400)
        self.assertEqual(self.client.post('/api/agent', content=b'{').status_code, 400)
        self.assertEqual(self.client.post('/api/agent', content=b'x' * (server.MAX_BODY + 1)).status_code, 413)
        self.assertEqual(self.client.post('/api/agent', json=payload(), headers={'origin': 'https://evil.invalid'}).status_code, 403)
        self.assertEqual(self.client.post('/api/agent', json=payload(mode='demo'), headers={'origin': 'http://testserver'}).status_code, 200)


class AsyncTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancellation_reaches_pending_model_request(self):
        entered, cancelled = asyncio.Event(), asyncio.Event()

        async def waiting_provider(request):
            entered.set()
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.set()

        async with httpx.AsyncClient(transport=httpx.MockTransport(waiting_provider)) as client:
            async def consume():
                async for _ in run_agent(parse_input(payload()), CONFIG, client):
                    pass
            task = asyncio.create_task(consume())
            await asyncio.wait_for(entered.wait(), 1)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertTrue(cancelled.is_set())

    async def test_overall_timeout_emits_error_and_done(self):
        async def waiting_provider(request):
            await asyncio.sleep(60)

        short = replace(CONFIG, text_timeout=0.01, vision_timeout=0.01)
        async with httpx.AsyncClient(transport=httpx.MockTransport(waiting_provider)) as client:
            with patch.object(server, 'settings', short):
                result = [json.loads(line) async for line in server.stream_events(parse_input(payload()), client)]
        self.assertEqual([event['type'] for event in result][-2:], ['error', 'done'])


class SettingsTests(unittest.TestCase):
    def test_legacy_environment_and_primary_precedence(self):
        # A child interpreter exercises dotenv loading at the normal import entry point.
        environment = dict(os.environ)
        environment.update({
            'LLM_API_KEY': '', 'LLM_BASE_URL': '', 'LLM_DEFAULT_MODEL_ID': '',
            'VLM_DEFAULT_MODEL_ID': '', 'DASHSCOPE_API_KEY': '',
            'DMX_API_KEY': 'test-legacy', 'DMX_BASE_URL': 'https://legacy.invalid/v1',
            'DMX_TEXT_MODEL': 'legacy-text', 'DMX_VISION_MODEL': 'legacy-vision',
        })
        program = (
            'import json; from guanshe.config import Settings; s = Settings(); '
            'print(json.dumps([s.api_key == "test-legacy", s.base_url, s.text_model, s.vision_model]))'
        )
        result = subprocess.run([sys.executable, '-c', program], env=environment,
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout),
                         [True, 'https://legacy.invalid/v1', 'legacy-text', 'legacy-vision'])
        environment.update({'LLM_API_KEY': 'test-primary', 'LLM_BASE_URL': 'https://primary.invalid/v1',
                            'LLM_DEFAULT_MODEL_ID': 'primary-text', 'VLM_DEFAULT_MODEL_ID': 'primary-vision'})
        result = subprocess.run([sys.executable, '-c', program], env=environment,
                                capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(result.stdout),
                         [False, 'https://primary.invalid/v1', 'primary-text', 'primary-vision'])

    def test_invalid_numbers_fall_back(self):
        for raw in ['nan', 'inf', '-1', '999', 'bad']:
            with patch.dict('os.environ', {'LLM_TIMEOUT_S': raw}):
                self.assertEqual(number('LLM_TIMEOUT_S', 60, 1, 300), 60)


if __name__ == '__main__':
    unittest.main()
