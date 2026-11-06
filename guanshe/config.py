"""Load server-only settings without overwriting the process environment."""

import math
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / '.env.local', override=False)


def env(*names, default=''):
    for name in names:
        value = os.environ.get(name, '').strip()
        if value:
            return value
    return default


def number(name, default, low, high):
    try:
        value = float(env(name, default=str(default)))
    except ValueError:
        return default
    return value if math.isfinite(value) and low <= value <= high else default


@dataclass(frozen=True)
class Settings:
    api_key: str = env('LLM_API_KEY', 'DMX_API_KEY', 'DASHSCOPE_API_KEY')
    base_url: str = env(
        'LLM_BASE_URL', 'DMX_BASE_URL', 'QWEN_BASE_URL',
        default='https://www.dmxapi.cn/v1' if env('DMX_API_KEY') and not env('LLM_API_KEY')
        else 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    )
    text_model: str = env('LLM_DEFAULT_MODEL_ID', 'DMX_TEXT_MODEL', 'QWEN_MODEL', default='qwen3.5-plus')
    vision_model: str = env('VLM_DEFAULT_MODEL_ID', 'DMX_VISION_MODEL', 'QWEN_VISION_MODEL', default='qwen3-vl-plus')
    temperature: float = number('LLM_TEMPERATURE', 0.2, 0, 2)
    text_timeout: float = number('LLM_TIMEOUT_S', 60, 1, 300)
    vision_timeout: float = number('VLM_TIMEOUT_S', 120, 1, 300)

    @property
    def agent_timeout(self):
        return min(900, 5 * self.text_timeout + self.vision_timeout)
