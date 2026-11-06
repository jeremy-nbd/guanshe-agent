"""Keyword retrieval using the project's existing structured knowledge index."""

import json
import re
from collections import defaultdict
from functools import lru_cache

from .config import ROOT

WEIGHTS = {'title': 10, 'description': 3, 'symptoms': 5, 'causes': 3,
           'indications': 5, 'suitable': 5, 'effects': 3, 'functions': 3, 'function_': 3}
FIELDS = {'description': '概述', 'symptoms': '相关症状', 'causes': '常见原因',
          'indications': '主治', 'suitable': '适用人群', 'effects': '功效',
          'functions': '功用', 'function_': '功能', 'formula': '配方', 'usage': '用法',
          'technique': '操作', 'location': '定位', 'meridian': '归经'}
CATEGORIES = ('症状', '疾病', '药膳食疗', '穴位', '保健品')


@lru_cache(maxsize=1)
def load_index():
    return json.loads((ROOT / 'data/tcmRagIndex.json').read_text(encoding='utf-8'))


def retrieve(query):
    index = load_index()
    cleaned = re.sub(r'[^一-鿿a-zA-Z0-9_]', '', query)
    tokens = dict.fromkeys(cleaned[i:i + 2] for i in range(len(cleaned) - 1))
    scores = defaultdict(int)
    for token in tokens:
        for position in index['keywordIndex'].get(token, []):
            entry = index['entries'][position]
            bonus = sum(weight for field, weight in WEIGHTS.items() if query in entry.get(field, '') and entry.get(field))
            scores[position] += 1 + bonus
    groups = defaultdict(list)
    # Position breaks ties just as numeric keys did in the original JavaScript index.
    for position in sorted(scores, key=lambda pos: (-scores[pos], pos)):
        entry = index['entries'][position]
        if len(groups[entry['category']]) < 3:
            groups[entry['category']].append(entry)
    summary = '未检索到相关中医知识参考。'
    if groups:
        summary = f"检索到 {'、'.join(groups)} 领域共 {sum(map(len, groups.values()))} 条相关中医知识参考。"
    parts = []
    for category in CATEGORIES:
        for entry in groups.get(category, []):
            lines = [f"【{category}】{entry['title']}"]
            for field, label in FIELDS.items():
                if entry.get(field):
                    value = entry[field][:200] if field == 'description' else entry[field]
                    lines.append(f'  {label}: {value}')
            parts.append('\n'.join(lines))
    return summary, '\n\n'.join(parts)
