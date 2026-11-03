import { parseJsonObject } from "@/services/jsonResponse";
import { sanitizeUnsupportedObservationTerms } from "@/services/tcmTextSanitizer";
import type { ResultCard } from "@/types/tcm";

type AnalyzeResponse = {
  cards: ResultCard[];
};

function ensureSymptomsInUnderstanding(
  cards: ResultCard[],
  selectedSymptoms?: string[],
) {
  if (!selectedSymptoms || selectedSymptoms.length === 0) {
    return cards;
  }

  const symptoms = selectedSymptoms.join("、");
  const symptomIntro = `结合你选择的${symptoms}等表现，`;

  return cards.map((card) => {
    if (
      card.title !== "症状理解" ||
      selectedSymptoms.every((symptom) => card.content.includes(symptom))
    ) {
      return card;
    }

    return {
      ...card,
      content: `${symptomIntro}${card.content}`,
    };
  });
}

export function parseAnalyzeResponse(
  content: string,
  selectedSymptoms?: string[],
): AnalyzeResponse {
  const parsed = parseJsonObject<Partial<AnalyzeResponse>>(content);

  if (!Array.isArray(parsed.cards)) {
    throw new Error("Invalid analysis response: missing cards");
  }

  const cards = parsed.cards
    .map((card) => ({
      title: String(card.title ?? ""),
      content: sanitizeUnsupportedObservationTerms(String(card.content ?? "")),
    }))
    .filter((card) => card.title !== "会诊摘要");

  const normalizedCards = ensureSymptomsInUnderstanding(cards, selectedSymptoms);

  if (normalizedCards.some((card) => !card.title || !card.content)) {
    throw new Error("Invalid analysis response: empty card field");
  }

  return { cards: normalizedCards };
}
