// TCM RAG — lightweight keyword retrieval from structured TCM knowledge index
// Index built by ft/buildRagIndex.mjs from CPT_tcmKnowledge_source2_12889.json

import tcmIndex from "@/services/tcmRagIndex.json";

type RagEntry = {
  category: string;
  title: string;
  description?: string;
  symptoms?: string;
  causes?: string;
  indications?: string;
  suitable?: string;
  effects?: string;
  functions?: string;
  function_?: string;
  location?: string;
  technique?: string;
  usage?: string;
  formula?: string;
  source?: string;
  meridian?: string;
  relatedDiseases?: string;
  fullText: string;
};

type IndexData = {
  entries: RagEntry[];
  keywordIndex: Record<string, number[]>;
  titleIndex: Record<string, number[]>;
};

const index = tcmIndex as unknown as IndexData;

function tokenize(str: string): string[] {
  const cleaned = str.replace(/[^一-鿿\w]/g, "");
  const tokens: string[] = [];
  for (let i = 0; i < cleaned.length - 1; i++) {
    tokens.push(cleaned.slice(i, i + 2));
  }
  return [...new Set(tokens)];
}

function scoreEntry(entry: RagEntry, query: string): number {
  let score = 0;
  const q = query.toLowerCase();

  // Title exact match
  if (entry.title && entry.title.includes(query)) score += 10;

  // Description match
  if (entry.description && entry.description.includes(query)) score += 3;
  if (entry.symptoms && entry.symptoms.includes(query)) score += 5;
  if (entry.causes && entry.causes.includes(query)) score += 3;
  if (entry.indications && entry.indications.includes(query)) score += 5;
  if (entry.suitable && entry.suitable.includes(query)) score += 5;
  if (entry.effects && entry.effects.includes(query)) score += 3;
  if (entry.functions && entry.functions.includes(query)) score += 3;
  if (entry.function_ && entry.function_.includes(query)) score += 3;

  return score;
}

function selectTop(items: { idx: number; score: number }[], limit: number): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const { idx } of items.sort((a, b) => b.score - a.score)) {
    if (!seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
      if (result.length >= limit) break;
    }
  }
  return result;
}

/** Search index by keyword token matching, return top entries per category */
function searchByKeywords(queryText: string, maxPerCategory: number = 3): Record<string, RagEntry[]> {
  const tokens = tokenize(queryText);
  const scored: Record<number, number> = {};

  for (const token of tokens) {
    const hits = index.keywordIndex[token];
    if (hits) {
      for (const idx of hits) {
        const entry = index.entries[idx];
        const bonus = scoreEntry(entry, queryText);
        scored[idx] = (scored[idx] || 0) + 1 + bonus;
      }
    }
  }

  // Group by category
  const byCategory: Record<string, { idx: number; score: number }[]> = {};
  for (const [idxStr, score] of Object.entries(scored)) {
    const idx = parseInt(idxStr, 10);
    const cat = index.entries[idx].category;
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push({ idx, score });
  }

  // Pick top per category
  const result: Record<string, RagEntry[]> = {};
  for (const [cat, items] of Object.entries(byCategory)) {
    result[cat] = selectTop(items, maxPerCategory).map((i) => index.entries[i]);
  }

  return result;
}

/** Format retrieved entries as prompt-ready reference text */
function formatEntries(entries: RagEntry[]): string {
  return entries
    .map((e) => {
      const lines = [`【${e.category}】${e.title}`];
      if (e.description) lines.push(`  概述: ${e.description.slice(0, 200)}`);
      if (e.symptoms) lines.push(`  相关症状: ${e.symptoms}`);
      if (e.causes) lines.push(`  常见原因: ${e.causes}`);
      if (e.indications) lines.push(`  主治: ${e.indications}`);
      if (e.suitable) lines.push(`  适用人群: ${e.suitable}`);
      if (e.effects) lines.push(`  功效: ${e.effects}`);
      if (e.functions) lines.push(`  功用: ${e.functions}`);
      if (e.function_) lines.push(`  功能: ${e.function_}`);
      if (e.formula) lines.push(`  配方: ${e.formula}`);
      if (e.usage) lines.push(`  用法: ${e.usage}`);
      if (e.technique) lines.push(`  操作: ${e.technique}`);
      if (e.location) lines.push(`  定位: ${e.location}`);
      if (e.meridian) lines.push(`  归经: ${e.meridian}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Main entry: retrieve and format TCM knowledge for a consultation */
export function retrieveTcmKnowledge(input: {
  chiefComplaint: string;
  selectedSymptoms: string[];
  selectedTopic?: string;
}): {
  referenceText: string | undefined;
  summary: string;
} {
  const queryText = [
    input.chiefComplaint,
    ...(input.selectedSymptoms || []),
    input.selectedTopic || "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!queryText.trim()) {
    return { referenceText: undefined, summary: "未检索到相关中医知识参考。" };
  }

  const results = searchByKeywords(queryText, 3);

  const parts: string[] = [];

  // Symptom knowledge → feeds 中医分析
  if (results["症状"]?.length) {
    parts.push("### 症状参考");
    parts.push(formatEntries(results["症状"]));
  }

  // Disease knowledge → feeds 中医分析
  if (results["疾病"]?.length) {
    parts.push("### 相关中医疾病参考");
    parts.push(formatEntries(results["疾病"]));
  }

  // Dietary therapy → feeds 调理建议
  if (results["药膳食疗"]?.length) {
    parts.push("### 药膳食疗参考");
    parts.push(formatEntries(results["药膳食疗"]));
  }

  // Acupoint massage → feeds 调理建议
  if (results["穴位"]?.length) {
    parts.push("### 穴位按摩参考");
    parts.push(formatEntries(results["穴位"]));
  }

  // Supplements → feeds 调理建议 (辅助)
  if (results["保健品"]?.length) {
    parts.push("### 保健品参考（仅展示，不主动推荐）");
    parts.push(formatEntries(results["保健品"]));
  }

  const referenceText = parts.length > 0 ? parts.join("\n\n") : undefined;

  const foundCategories = Object.keys(results).filter((k) => results[k].length > 0);
  const summary =
    foundCategories.length > 0
      ? `检索到 ${foundCategories.join("、")} 领域共 ${
          foundCategories.reduce((s, k) => s + results[k].length, 0)
        } 条相关中医知识参考。`
      : "未检索到相关中医知识参考。";

  return { referenceText, summary };
}
