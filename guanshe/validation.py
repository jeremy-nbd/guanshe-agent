"""Validate the existing browser protocol before any provider request."""

import base64
import binascii
import re


def parse_input(value):
    if not isinstance(value, dict):
        raise ValueError('请求格式不正确。')
    if value.get('mode') not in ('demo', 'live'):
        raise ValueError('请选择体验或真实 AI 模式。')
    action = value.get('action', 'chat')
    if action not in ('chat', 'observe'):
        raise ValueError('不支持的操作。')
    history = value.get('messages')
    if not isinstance(history, list) or not 1 <= len(history) <= 40:
        raise ValueError('一次会话最多 20 轮，请开启新会话。')
    messages = []
    total = 0
    for index, message in enumerate(history):
        role = 'assistant' if index % 2 else 'user'
        if not isinstance(message, dict):
            raise ValueError('对话内容或顺序不正确。')
        content = message.get('content')
        if message.get('role') != role or not isinstance(content, str) or not content.strip() or len(content) > 8000:
            raise ValueError('对话内容或顺序不正确。')
        total += len(content)
        messages.append({'role': role, 'content': content.strip()})
    if total > 60000 or messages[-1]['role'] != 'user':
        raise ValueError('对话过长或缺少当前问题，请开启新会话。')
    photos = value.get('images')
    if not isinstance(photos, list) or len(photos) > 3:
        raise ValueError('最多上传三张照片。')
    images = []
    seen = set()
    for photo in photos:
        if not isinstance(photo, dict):
            raise ValueError('照片格式不正确。')
        kind, url = photo.get('kind'), photo.get('dataUrl')
        if kind not in ('top', 'underside', 'face') or kind in seen or not isinstance(url, str) or len(url) > 2800000:
            raise ValueError('照片格式、数量或大小不正确。')
        match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})', url)
        if not match:
            raise ValueError('照片仅支持 JPEG、PNG、WebP。')
        try:
            raw = base64.b64decode(match[2], validate=True)
        except binascii.Error as error:
            raise ValueError('照片编码不正确。') from error
        signatures = {
            'jpeg': raw.startswith(b'\xff\xd8\xff'),
            'png': raw.startswith(b'\x89PNG\r\n\x1a\n'),
            'webp': raw[:4] == b'RIFF' and raw[8:12] == b'WEBP',
        }
        if not signatures[match[1]]:
            raise ValueError('照片内容与格式不符，请重新选择。')
        seen.add(kind)
        images.append({'kind': kind, 'dataUrl': url})
    if action == 'observe' and value['mode'] == 'live' and not images:
        raise ValueError('请先添加一张照片，再开始观察。')
    return {'mode': value['mode'], 'action': action, 'messages': messages, 'images': images}
