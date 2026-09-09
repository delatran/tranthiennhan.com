const ANSWER_LOCALES = new Set(["en", "vi"]);

const NEUTRAL_TOKENS = new Set([
  "ai", "api", "chatgpt", "cloudflare", "const", "css", "document", "gpt",
  "google", "html", "javascript", "json", "kienlongbank", "lora", "luna",
  "mercedes", "nhan", "openai", "openrouter", "pdf", "ptit", "react",
  "responses", "thien", "tran", "tranthiennhan", "typescript", "vietnam", "vite",
  "webmcp", "worker", "workers", "x",
]);

const ENGLISH_SIGNALS = new Set([
  "a", "about", "am", "an", "and", "answer", "any", "are", "as", "ask", "at",
  "after", "be", "because", "before", "build", "builds", "built", "by", "can", "career",
  "available", "cannot", "claim", "compare", "contact", "correct", "could", "credential", "credentials", "current", "depends", "describe", "details", "did",
  "do", "does", "done", "education", "english", "evaluate", "evidence", "explain", "experience", "for", "found", "from",
  "has", "have", "he", "help", "hidden", "his", "hosts", "how", "i", "ignore", "in",
  "instructions", "is", "it", "job", "keep",
  "language", "languages", "latest", "list", "me", "means", "more", "new", "no", "not", "nothing", "now", "of", "on",
  "or", "please", "portfolio", "probably", "project", "projects", "provide", "provided", "public", "question", "recent", "respond", "review", "role", "said", "see", "sentence", "should", "ship",
  "deployment", "shipped", "show", "specific", "stores", "string", "strongest", "summarize", "systems", "tell", "than", "that", "the", "three", "this", "translate",
  "previous", "private", "prompt", "reveal", "their", "there", "this",
  "thank", "thanks", "to", "update", "updates", "use", "user", "uses", "verify", "vietnamese", "wrote",
  "was", "website", "what", "when", "where", "which", "who", "why", "work",
  "will", "with", "worked", "works", "would", "you",
  "analyze", "analyse", "assess", "attribution", "behavior", "behaviour",
  "benchmark", "benchmarks", "caching", "check", "compatibility", "examine",
  "investigate", "latency", "performance", "quality", "regression", "response",
  "routing", "source", "topic", "unverified",
]);

const VIETNAMESE_SIGNALS = new Set([
  "anh", "ban", "ba", "bang", "bao", "bay", "biet", "boi", "cach", "cap",
  "cho", "chua", "co", "cong", "cua", "cum", "da", "dang", "dau", "day", "dinh", "do", "du", "dung",
  "duoc", "gi", "gio", "gioi", "giup", "giai", "hai", "hang", "hay", "he", "hien", "ho", "hoc", "hoat",
  "kham", "khong", "kinh", "la", "lam", "lien", "minh", "mo", "moi", "mot", "muon", "nao", "ngan",
  "nghe", "nghiem", "nghia", "nghiep", "ngon", "nhat", "nhieu", "nhung", "noi", "o",
  "phan", "phat", "phu", "qua", "sai", "sao", "so", "su", "ta", "tai", "tat", "the", "thieu", "them", "toi", "tro", "tuy",
  "thong", "tieng", "tom", "trai", "trang", "tren", "trinh", "tu",
  "va", "vai", "van", "vay", "ve", "viec", "viet", "voi", "xac", "xay", "xong",
  "bai", "bo", "chat", "danh", "dan", "dem", "do", "gia", "hieu", "khao",
  "kha", "kiem", "luong", "nang", "nho", "phan", "hoi", "sat", "that", "thich",
  "tich", "toc", "tra", "trich", "tuong", "xuat",
]);

// English and unaccented Vietnamese share short surface forms such as "the",
// "do", "to", and "an". Counting those tokens for both languages creates a
// false tie, so shared lexical entries are deliberately neutral evidence.
const SHARED_LANGUAGE_SIGNALS = new Set(
  [...ENGLISH_SIGNALS].filter((token) => VIETNAMESE_SIGNALS.has(token)),
);

const VIETNAMESE_ORTHOGRAPHY_PATTERN =
  /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/iu;
const ENGLISH_MORPHOLOGY_PATTERN =
  /(?:ing|ed|tion|sion|ment|ness|ity|ive|ous|ally|fully|less|ified|ability|ibility|ance|ence|ship|ward|wards|ize|ise|izing|ising|izations?|isations?|ology|graphy|metrics?|marks?)$/u;

const ENGLISH_FRAME_PATTERN =
  /\b(?:what|why|how|where|when|who|which|is|are|was|were|does|did|can|could|would|should|has|have|tell|show|describe|review|list|explain|summarize|answer|respond|provide|evaluate|compare|help)\b/gu;
const VIETNAMESE_FRAME_PATTERN =
  /\b(?:la gi|ai la|nhan la|co gi|lam gi|o dau|tai sao|vi sao|the nao|nhu the nao|bao nhieu|sao vay|hay cho|cho biet|cho them|giai thich|tom tat|tra loi|mo ta|ho so|du an|lien he|hoc van|vai tro|kinh nghiem|bang chung|phu hop|ung vien|noi bat|ngan gon|giup toi|nhan da|nhan co)\b/gu;
// Common unaccented Vietnamese words such as `nam`, `chi`, `phi`, `y`, and
// `gap` are also valid names, identifiers, or English words. Pair-level frames
// provide strong evidence without making any one ambiguous token hijack the
// page-locale fallback. The grouped forms also cover nearby natural variants,
// rather than special-casing only the exact regression strings.
const VIETNAMESE_ASCII_COMPOUND_PATTERN =
  /\b(?:(?:hom|ngay|tuan|thang|nam)\s+(?:nay|truoc|sau)|chi\s+phi|cau\s+hinh|ngu\s+canh|goi\s+y|sua\s+loi|(?:xem|doc|thu|kiem\s+tra)\s+lai|cam\s+on|xin\s+chao|hen\s+gap(?:\s+(?:lai|ban))?|rat\s+tot|hoan\s+thanh)\b/gu;
const ENGLISH_SINGLE_TOKEN_SIGNALS = new Set([
  "available", "career", "completed", "concise", "contact", "correct", "depends", "done", "education", "english", "experience", "failed", "hello", "how", "insufficient", "latest", "no", "probably", "project", "projects", "relevant", "review", "role", "succeeded", "sure", "thanks", "unavailable", "unsupported", "unverified", "updates", "verified", "what", "when", "where", "who", "why", "work", "yes",
]);
const VIETNAMESE_SINGLE_TOKEN_SIGNALS = new Set([
  "bat", "chao", "chuan", "chua", "co", "dau", "duoc", "dung", "gi", "hong", "khong", "lech", "on", "ro", "sai", "sao", "te", "tot", "tuy", "viet", "xong",
]);
const BALANCED_MIXED_PATTERN =
  /\b(?:where\s+la\s+dau|why\s+tai\s+sao|what\s+la\s+gi|current\s+vai\s+tro)\b/u;
const EXPLICIT_ENGLISH_OUTPUT_PATTERN =
  /\b(?:in|into|using|use)\s+english\b|\benglish\s+(?:answer|response|translation|version)\b/u;
const EXPLICIT_VIETNAMESE_OUTPUT_PATTERN =
  /\b(?:bang|sang|dung|su dung)\s+tieng\s+viet\b|\btieng\s+viet\s+(?:tra loi|phan hoi|ban dich|phien ban)\b/u;
const ENGLISH_OUTER_FRAME_PATTERN =
  /^(?:please\b|can\s+you\b|could\s+you\b|would\s+you\b|what\b|why\b|how\b|where\b|when\b|who\b|which\b|tell\b|show\b|explain\b|describe\b|review\b|list\b|analy[sz]e\b|assess\b|check\b|investigate\b|examine\b)/u;
const VIETNAMESE_OUTER_FRAME_PATTERN =
  /^(?:hay\b|vui\s+long\b|ban\s+co\s+the\b|cho\b|tai\s+sao\b|vi\s+sao\b|the\s+nao\b|o\s+dau\b|khi\s+nao\b|giai\s+thich\b|mo\s+ta\b|tom\s+tat\b|danh\s+gia\b|kiem\s+tra\b|phan\s+tich\b|khao\s+sat\b)/u;

function assertFallbackLocale(value) {
  return ANSWER_LOCALES.has(value) ? value : "en";
}

function normalizeForLanguage(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/https?:\/\/\S+|www\.\S+|@[\p{L}\p{N}_]+/giu, " ")
    .replace(/[`~!#$%^&*()+=\[\]{}|\\/:;,.?<>"'“”‘’—–-]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function foldToken(value) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/đ/gu, "d");
}

function stripQuotedAndCodeSpans(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .replace(/<code\b[^>]*>[\s\S]{0,800}?<\/code>/giu, " ")
    .replace(
      /`[^`\r\n]{0,800}`|“[^”\r\n]{0,800}”|"[^"\r\n]{0,800}"|‘[^’\r\n]{0,800}’/gu,
      " ",
    );
}

function stripNeutralArtifacts(value) {
  const raw = String(value ?? "").normalize("NFKC").replace(/\p{Cf}+/gu, "");
  const hasArtifact =
    /https?:\/\/\S+|www\.\S+|@[\p{L}\p{N}_]+|<code\b[^>]*>[\s\S]{0,800}?<\/code>|`[^`\r\n]{0,800}`/iu.test(
      raw,
    );
  return {
    hasArtifact,
    remainder: raw
      .replace(/https?:\/\/\S+|www\.\S+|@[\p{L}\p{N}_]+/giu, " ")
      .replace(/<code\b[^>]*>[\s\S]{0,800}?<\/code>/giu, " ")
      .replace(/`[^`\r\n]{0,800}`/gu, " "),
  };
}

function isAllowlistedNeutralOutput(value) {
  const { hasArtifact, remainder } = stripNeutralArtifacts(value);
  const tokens = remainder.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  if (tokens.length === 0) return hasArtifact;
  return tokens.every((token) => {
    const folded = foldToken(token);
    return /^\d+$/u.test(folded) || NEUTRAL_TOKENS.has(folded);
  });
}

function outputProseSegments(value) {
  const unquoted = stripQuotedAndCodeSpans(value);
  const { remainder } = stripNeutralArtifacts(unquoted);
  return remainder
    .split(
      /(?:\r?\n)+|[.!?,;]+|:\s+|\s+[—–]\s+|\s+\b(?:but|however|yet|while|nhưng|nhung|tuy\s+nhiên|tuy\s+nhien)\b\s+/iu,
    )
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function containsOppositeLanguageSegment(value, expectedLocale) {
  return outputProseSegments(value).some((segment) => {
    const { detectedLocale, evidence } = classifyLanguage(segment);
    if (!detectedLocale) return evidence.en >= 3 && evidence.vi >= 3;
    return detectedLocale !== expectedLocale;
  });
}

function classifyEvidence({ en, vi }) {
  if (en >= 3 && vi >= 3 && Math.abs(en - vi) < 4) return null;
  if (vi === 0 && en >= 2) return "en";
  if (en === 0 && vi >= 2) return "vi";
  const strongest = Math.max(en, vi);
  const margin = Math.abs(en - vi);
  if (strongest < 3 || margin < 2) return null;
  return vi > en ? "vi" : "en";
}

function segmentLanguageEvidence(value) {
  const normalized = normalizeForLanguage(value);
  if (!normalized) {
    return {
      en: 0,
      vi: 0,
      neutralOnly: true,
      asciiProse: false,
      tokenCount: 0,
    };
  }

  const originalTokens = normalized.match(/[\p{L}\p{M}]+/gu) ?? [];
  let en = 0;
  let vi = 0;
  let languageTokenCount = 0;
  let unknownTokenCount = 0;
  let lowercaseUnknownTokenCount = 0;
  let asciiWordCount = 0;

  for (const originalToken of originalTokens) {
    const token = foldToken(originalToken);
    if (!token) continue;
    const sharedSignal = SHARED_LANGUAGE_SIGNALS.has(token);
    const englishSignal = ENGLISH_SIGNALS.has(token) && !sharedSignal;
    const vietnameseSignal = VIETNAMESE_SIGNALS.has(token) && !sharedSignal;
    if (englishSignal) en += 1;
    if (vietnameseSignal) vi += 1;
    if (englishSignal || vietnameseSignal) languageTokenCount += 1;
    const originalNfc = originalToken.normalize("NFC");
    const hasVietnameseOrthography = VIETNAMESE_ORTHOGRAPHY_PATTERN.test(
      originalNfc,
    );
    if (hasVietnameseOrthography && token !== "nhan") {
      vi += 2;
    }
    if (
      !hasVietnameseOrthography &&
      /^[A-Za-z]+$/u.test(originalNfc) &&
      ENGLISH_MORPHOLOGY_PATTERN.test(token)
    ) {
      en += 2;
    }
    if (/^[A-Za-z]+$/u.test(originalNfc)) asciiWordCount += 1;
    if (
      !englishSignal &&
      !vietnameseSignal &&
      !NEUTRAL_TOKENS.has(token) &&
      !/^\p{Lu}[\p{L}\p{M}]*$/u.test(originalToken)
    ) {
      unknownTokenCount += 1;
      lowercaseUnknownTokenCount += 1;
    }
  }

  if (originalTokens.length === 1) {
    const onlyToken = foldToken(originalTokens[0]);
    if (ENGLISH_SINGLE_TOKEN_SIGNALS.has(onlyToken)) en += 3;
    if (VIETNAMESE_SINGLE_TOKEN_SIGNALS.has(onlyToken)) vi += 3;
  }

  const folded = foldToken(normalized).replace(/[^\p{L}\p{N}]+/gu, " ");
  en += Math.min(4, (folded.match(ENGLISH_FRAME_PATTERN) ?? []).length * 2);
  vi += Math.min(4, (folded.match(VIETNAMESE_FRAME_PATTERN) ?? []).length * 2);
  vi += Math.min(
    4,
    (folded.match(VIETNAMESE_ASCII_COMPOUND_PATTERN) ?? []).length * 2,
  );

  return {
    en,
    vi,
    asciiProse:
      originalTokens.length >= 2 &&
      asciiWordCount === originalTokens.length &&
      lowercaseUnknownTokenCount > 0,
    neutralOnly:
      languageTokenCount === 0 &&
      unknownTokenCount === 0 &&
      originalTokens.length > 0,
    tokenCount: originalTokens.length,
  };
}

function languageEvidence(value) {
  const raw = String(value ?? "");
  const foldedRaw = foldToken(normalizeForLanguage(raw)).replace(
    /[^\p{L}\p{N}]+/gu,
    " ",
  );
  if (BALANCED_MIXED_PATTERN.test(foldedRaw)) {
    return {
      en: 3,
      vi: 3,
      neutralOnly: false,
      asciiProse: false,
      tokenCount: 2,
    };
  }
  const outerEvidence = segmentLanguageEvidence(stripQuotedAndCodeSpans(raw));
  if (classifyEvidence(outerEvidence) || outerEvidence.neutralOnly) {
    return outerEvidence;
  }
  return segmentLanguageEvidence(raw);
}

function classifyLanguage(value) {
  const evidence = languageEvidence(value);
  const outer = foldToken(normalizeForLanguage(stripQuotedAndCodeSpans(value)))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (BALANCED_MIXED_PATTERN.test(outer)) {
    return { detectedLocale: null, evidence };
  }
  if (EXPLICIT_ENGLISH_OUTPUT_PATTERN.test(outer)) {
    return { detectedLocale: "en", evidence };
  }
  if (EXPLICIT_VIETNAMESE_OUTPUT_PATTERN.test(outer)) {
    return { detectedLocale: "vi", evidence };
  }
  if (ENGLISH_OUTER_FRAME_PATTERN.test(outer)) {
    return { detectedLocale: "en", evidence };
  }
  if (VIETNAMESE_OUTER_FRAME_PATTERN.test(outer)) {
    return { detectedLocale: "vi", evidence };
  }
  const detectedLocale = classifyEvidence(evidence);
  if (detectedLocale) return { detectedLocale, evidence };

  // The product supports exactly English and Vietnamese. Once Vietnamese
  // orthographic/lexical evidence has been ruled out, multi-word ASCII prose is
  // a conservative English default; identifiers and proper-name-only fragments
  // remain ambiguous and continue to use the page fallback.
  if (evidence.asciiProse && evidence.vi === 0) {
    return { detectedLocale: "en", evidence };
  }
  if (evidence.vi > evidence.en) {
    return { detectedLocale: "vi", evidence };
  }
  if (evidence.en > evidence.vi) {
    return { detectedLocale: "en", evidence };
  }
  return { detectedLocale: null, evidence };
}

/**
 * Resolve answer language from the user's text. Page locale is deliberately
 * only a fallback for code/model identifiers, proper names, very short text,
 * or balanced English/Vietnamese input. The conservative margin prevents a
 * single name such as "Nhân" from overriding an otherwise English question.
 */
export function resolveAnswerLocale(value, pageLocale = "en") {
  const fallback = assertFallbackLocale(pageLocale);
  return classifyLanguage(value).detectedLocale ?? fallback;
}

/**
 * Validate generated prose without rejecting neutral product names, handles,
 * code, or a short answer whose language cannot be determined safely.
 */
export function answerMatchesLocale(value, expectedLocale) {
  if (!ANSWER_LOCALES.has(expectedLocale)) return false;
  if (containsOppositeLanguageSegment(value, expectedLocale)) return false;
  const { detectedLocale, evidence } = classifyLanguage(value);
  if (!detectedLocale && evidence.en >= 3 && evidence.vi >= 3) return false;
  if (!detectedLocale) {
    return evidence.neutralOnly && isAllowlistedNeutralOutput(value);
  }
  return detectedLocale === expectedLocale;
}

export const ANSWER_LANGUAGE_PROFILE = "en-vi";
