const unsupportedObservationTerms = [
  "四诊合参",
  "四诊",
  "望闻问切",
  "闻诊",
  "切诊",
  "腹部按诊",
  "腹诊",
  "脉诊",
  "脉象",
  "切脉",
  "把脉",
  "按腹",
];

const lowConfidenceDisclaimers = [
  "需线下医生结合动态问诊进一步辨证，不可单凭舌面或面色定论。",
  "需线下医生结合动态问诊进一步辨证，不可单凭舌面或面色定论",
  "不可单凭舌面或面色定论。",
  "不可单凭舌面或面色定论",
  "仅供参考，不能替代医生诊断。",
  "仅供参考，不能替代医生诊断",
  "仅供参考，不能替代专业医生诊断。",
  "仅供参考，不能替代专业医生诊断",
];

export function sanitizeUnsupportedObservationTerms(text: string) {
  const withoutUnsupportedTerms = unsupportedObservationTerms.reduce(
    (current, term) => current.replaceAll(term, "现有观察线索"),
    text,
  );

  return lowConfidenceDisclaimers
    .reduce(
      (current, phrase) => current.replaceAll(phrase, ""),
      withoutUnsupportedTerms,
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}
