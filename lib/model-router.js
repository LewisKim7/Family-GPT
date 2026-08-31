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
const DEEP_EXPLICIT = /(깊게|심층|철저|최대한.{0,12}(고민|분석|검토)|복잡|고난도|전략적|논리적으로|단계별|근거.{0,8}비교|시나리오|모델링|디버그|디버깅|코드\s*리뷰|아키텍처|root\s*cause|trade-?off|prove|proof|증명|최적화)/i;
const COMPLEX_DOMAIN = /(재무\s*모델|valuation|밸류에이션|포트폴리오|투자\s*전략|알고리즘|자료구조|선형대수|확률|통계|수학|typescript|python|next\.?js|react|sql)/i;
const EXPLICIT_WEB = /(검색|검색해|검색해서|찾아봐|찾아줘|찾아 줘|확인해|확인해서|알아봐|웹에서|인터넷|레딧|reddit|구글|google)/i;
const FRESH_INFO = /(최신|최근|오늘|현재|지금|요즘|방금|이번\s*(주|달|분기|해|년도)|뉴스|속보|출연작|개봉|방영|상영|가격|주가|환율|날씨|기온|일정|영업시간|운영시간|재고|판매처|출시|업데이트|최신\s*버전|공식\s*발표)/i;

export function latestUserText(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .reverse()
    .find((item) => item?.role === "user" && typeof item.content === "string")
    ?.content?.trim() ?? "";
}

export function requiresFreshWebSearch(messages) {
  const latest = latestUserText(messages);
  if (!latest) return false;
  const currentYear = String(new Date().getFullYear());
  return EXPLICIT_WEB.test(latest) || FRESH_INFO.test(latest) || latest.includes(currentYear);
}

export function usagePressure(usage) {
  const values = [usage?.primary?.usedPercent, usage?.secondary?.usedPercent]
    .map(Number)
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : 0;
}

export function routeModel({ requestedModel, messages, usage }) {
  const requested = typeof requestedModel === "string" ? requestedModel.toLowerCase() : "auto";

  // Auto is a real, separate mode. Any concrete model key is an explicit override.
  if (requested === "luna" || requested === "terra" || requested === "sol") {
    return {
      key: requested,
      reason: `manual-${requested}`,
      automatic: false,
      usagePercent: usagePressure(usage),
    };
  }

  const latest = latestUserText(messages);
  const used = usagePressure(usage);
  const currentInfo = requiresFreshWebSearch(messages);
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

  // Protect the shared Plus quota before quality collapses from hitting a hard limit.
  // Fresh/current questions still stay on Terra because a weak ungrounded answer defeats
  // the purpose of enabling search in the first place.
  if (used >= 90) {
    if (deep || currentInfo) {
      return {
        key: "terra",
        reason: deep ? "quota-critical-deep" : "quota-critical-current",
        automatic: true,
        usagePercent: used,
      };
    }
    return { key: "luna", reason: "quota-critical", automatic: true, usagePercent: used };
  }

  if (used >= 80) {
    if (deep || currentInfo) {
      return {
        key: "terra",
        reason: deep ? "quota-high-deep" : "quota-high-current",
        automatic: true,
        usagePercent: used,
      };
    }
    if (light) return { key: "luna", reason: "quota-high-light", automatic: true, usagePercent: used };
    return { key: "terra", reason: "quota-high-balanced", automatic: true, usagePercent: used };
  }

  if (deep) return { key: "sol", reason: "deep-task", automatic: true, usagePercent: used };
  if (currentInfo) return { key: "terra", reason: "current-info", automatic: true, usagePercent: used };
  if (light) return { key: "luna", reason: "light-task", automatic: true, usagePercent: used };
  return { key: "terra", reason: "balanced-default", automatic: true, usagePercent: used };
}
