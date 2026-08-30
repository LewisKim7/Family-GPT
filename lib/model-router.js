export const MODEL_CONFIGS = {
  luna: {
    id: "gpt-5.6-luna",
    reasoning: "medium",
    searchContextSize: "low",
  },
  terra: {
    id: "gpt-5.6-terra",
    reasoning: "medium",
    searchContextSize: "medium",
  },
  sol: {
    id: "gpt-5.6-sol",
    reasoning: "medium",
    searchContextSize: "medium",
  },
};

const LIGHT_TASK = /(번역|translate|맞춤법|오타|교정|문장.{0,8}(다듬|고쳐)|한\s*줄|짧게|간단히|요약|제목.{0,8}추천|이름.{0,8}추천|뜻.{0,8}(뭐|알려)|단위.{0,8}변환|계산해|몇\s*(시|분|개|원|퍼센트|%))/i;
const SIMPLE_CURRENT = /(오늘.{0,8}(날씨|기온|환율|주가|시간)|지금.{0,8}(날씨|기온|환율|주가|시간)|현재.{0,8}(날씨|기온|환율|주가|시간))/i;
const DEEP_EXPLICIT = /(깊게|심층|철저|최대한.{0,12}(고민|분석|검토)|복잡|고난도|전략적|논리적으로|단계별|근거.{0,8}비교|시나리오|모델링|디버그|디버깅|코드\s*리뷰|아키텍처|root\s*cause|trade-?off|prove|proof|증명|최적화)/i;
const COMPLEX_DOMAIN = /(재무\s*모델|valuation|밸류에이션|포트폴리오|투자\s*전략|알고리즘|자료구조|선형대수|확률|통계|수학|typescript|python|next\.?js|react|sql)/i;

export function usagePressure(usage) {
  const values = [usage?.primary?.usedPercent, usage?.secondary?.usedPercent]
    .map(Number)
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

export function routeModel({ requestedModel, messages, usage }) {
  const requested = typeof requestedModel === "string" ? requestedModel.toLowerCase() : "auto";

  // Luna and Sol are explicit overrides. Terra/default is the parent-friendly Auto mode.
  if (requested === "luna" || requested === "sol") {
    return {
      key: requested,
      reason: `manual-${requested}`,
      automatic: false,
      usagePercent: usagePressure(usage),
    };
  }

  const latest = [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((item) => item?.role === "user" && typeof item.content === "string")
    ?.content?.trim() ?? "";

  const used = usagePressure(usage);
  const questionCount = (latest.match(/[?？]/g) || []).length;
  const lineCount = latest.split(/\n/).filter((line) => line.trim()).length;
  const structuralComplexity =
    latest.length >= 1400 ||
    (latest.length >= 650 && questionCount >= 3) ||
    lineCount >= 12;
  const deep =
    DEEP_EXPLICIT.test(latest) ||
    structuralComplexity ||
    (latest.length >= 750 && COMPLEX_DOMAIN.test(latest));
  const light = latest.length <= 700 && LIGHT_TASK.test(latest);
  const simpleCurrent = latest.length <= 220 && SIMPLE_CURRENT.test(latest);

  // Protect the shared Plus quota before quality collapses from hitting a hard limit.
  if (used >= 90) {
    if (deep) return { key: "terra", reason: "quota-critical-deep", automatic: true, usagePercent: used };
    return { key: "luna", reason: "quota-critical", automatic: true, usagePercent: used };
  }

  if (used >= 80) {
    if (deep) return { key: "terra", reason: "quota-high-deep", automatic: true, usagePercent: used };
    if (light || simpleCurrent) return { key: "luna", reason: "quota-high-light", automatic: true, usagePercent: used };
    return { key: "terra", reason: "quota-high-balanced", automatic: true, usagePercent: used };
  }

  if (deep) return { key: "sol", reason: "deep-task", automatic: true, usagePercent: used };
  if (light || simpleCurrent) return { key: "luna", reason: "light-task", automatic: true, usagePercent: used };
  return { key: "terra", reason: "balanced-default", automatic: true, usagePercent: used };
}
