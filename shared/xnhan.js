export const XNHAN_QUERY_MAX_LENGTH = 400;
export const XNHAN_QUERY_INPUT_MAX_UTF16_LENGTH =
  XNHAN_QUERY_MAX_LENGTH * 2;
export const XNHAN_CONVERSATION_MAX_TURNS = 7;
export const XNHAN_CONVERSATION_ASSISTANT_MAX_LENGTH = 2_800;
export const XNHAN_CONVERSATION_MAX_BYTES = 12 * 1_024;
export const XNHAN_REQUEST_MAX_BYTES = 16 * 1_024;

const XNHAN_CONVERSATION_SOURCE_LIMIT = 5;
const XNHAN_CONVERSATION_SOURCE_TEXT_MAX_LENGTH = 300;
const XNHAN_CONVERSATION_ANSWER_MAX_LENGTH = 1_200;
const XNHAN_CONVERSATION_FIELDS = new Set(["assistant", "user"]);
const EMPTY_XNHAN_CONVERSATION = Object.freeze([]);
const UTF8_ENCODER = new TextEncoder();
const XNHAN_CONTEXT_REFERENCE_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(?:he|she|it|they|them|his|hers?|their|theirs|this|that|these|those|former|latter|first|second|third|fourth|fifth|last|same|other|another|both|anh ấy|anh ay|cô ấy|co ay|ông ấy|ong ay|bà ấy|ba ay|họ|ho|nó|no|người này|nguoi nay|người đó|nguoi do|cái này|cai nay|cái đó|cai do|điều này|dieu nay|điều đó|dieu do|thứ nhất|thu nhat|thứ hai|thu hai|thứ ba|thu ba|đầu tiên|dau tien|cuối cùng|cuoi cung|cả hai|ca hai|còn lại|con lai|vừa rồi|vua roi|trước đó|truoc do|ở trên|o tren)(?=$|[^\p{L}\p{N}_])/iu;
const XNHAN_CONTEXT_CONTINUATION_PATTERN =
  /^(?:what about|how about|and\b|but\b|so\b|why\b|then\b|also\b|continue\b|more\b|further\b|actually\b|correction\b|i meant\b|to clarify\b|thế còn|the con|vậy còn|vay con|còn\b|con\b|và\b|va\b|nhưng\b|nhung\b|tại sao\b|tai sao\b|sao\b|tiếp tục\b|tiep tuc\b|nói thêm\b|noi them\b|thật ra\b|that ra\b|ý tôi\b|y toi\b|ý tao\b|y tao\b|đính chính\b|dinh chinh\b)/iu;
const XNHAN_CONTEXT_ORDINAL_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(?:\d+(?:st|nd|rd|th)|thứ\s+\d+|thu\s+\d+)(?=$|[^\p{L}\p{N}_])/iu;
const XNHAN_CONTEXT_AUTHOR_REFERENT_PATTERN =
  /(?:^|[^\p{L}\p{N}_])(?:account|person|user|profile|author|poster|handle|tài khoản|tai khoan|người|nguoi|tác giả|tac gia)(?=$|[^\p{L}\p{N}_])/iu;
const XNHAN_HANDLE_PATTERN = /@([A-Za-z0-9_]{1,15})/gu;

const QUERY_CONTROL_PATTERN =
  /[\p{Cf}\p{Cs}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu;

export function xNhanQueryLength(value) {
  if (typeof value !== "string") {
    throw new TypeError("X Nhân query length requires a string.");
  }
  return Array.from(value).length;
}

export function normalizeXNhanQuery(value) {
  if (typeof value !== "string") return "";

  return value
    .normalize("NFKC")
    .replace(QUERY_CONTROL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

export function readXNhanSearchQuery(value) {
  const normalizedQuery = normalizeXNhanQuery(value);
  const queryLength = xNhanQueryLength(normalizedQuery);
  return Object.freeze({
    normalizedQuery,
    queryLength,
    queryTooLong: queryLength > XNHAN_QUERY_MAX_LENGTH,
    valid: normalizedQuery !== "" && queryLength <= XNHAN_QUERY_MAX_LENGTH,
  });
}

function truncateCodePoints(value, maxLength) {
  return Array.from(value).slice(0, maxLength).join("");
}

function normalizeConversationText(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(QUERY_CONTROL_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function hasExactConversationFields(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const fields = Object.keys(value);
  return (
    fields.length === XNHAN_CONVERSATION_FIELDS.size &&
    fields.every((field) => XNHAN_CONVERSATION_FIELDS.has(field))
  );
}

export function normalizeXNhanConversationHistory(value) {
  if (!Array.isArray(value) || value.length > XNHAN_CONVERSATION_MAX_TURNS) {
    return null;
  }
  if (value.length === 0) return EMPTY_XNHAN_CONVERSATION;

  const normalized = [];
  for (const turn of value) {
    if (!hasExactConversationFields(turn)) return null;
    const user = normalizeXNhanQuery(turn.user);
    const assistant = normalizeConversationText(turn.assistant);
    if (
      !user ||
      xNhanQueryLength(user) > XNHAN_QUERY_MAX_LENGTH ||
      !assistant ||
      Array.from(assistant).length >
        XNHAN_CONVERSATION_ASSISTANT_MAX_LENGTH
    ) {
      return null;
    }
    normalized.push(Object.freeze({ user, assistant }));
  }

  if (
    UTF8_ENCODER.encode(JSON.stringify(normalized)).byteLength >
    XNHAN_CONVERSATION_MAX_BYTES
  ) {
    return null;
  }
  return Object.freeze(normalized);
}

export function buildXNhanContextualRankingQuery(query, history) {
  const currentQuery = normalizeXNhanQuery(query);
  const conversation = normalizeXNhanConversationHistory(history);
  const currentWords = currentQuery.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const contextDependent =
    XNHAN_CONTEXT_REFERENCE_PATTERN.test(currentQuery) ||
    XNHAN_CONTEXT_ORDINAL_PATTERN.test(currentQuery) ||
    (currentWords.length <= 12 &&
      XNHAN_CONTEXT_CONTINUATION_PATTERN.test(currentQuery));
  if (
    !currentQuery ||
    conversation === null ||
    conversation.length === 0 ||
    !contextDependent
  ) {
    return currentQuery;
  }

  // Only the user's immediately preceding question participates in the local
  // lexical rank. Prior assistant text remains non-evidentiary model context.
  return `${conversation.at(-1).user} ${currentQuery}`;
}

export function resolveXNhanContextualAuthorHandle(query, history) {
  const currentQuery = normalizeXNhanQuery(query);
  const conversation = normalizeXNhanConversationHistory(history);
  if (
    !currentQuery ||
    conversation === null ||
    conversation.length === 0 ||
    !XNHAN_CONTEXT_AUTHOR_REFERENT_PATTERN.test(currentQuery) ||
    /@[A-Za-z0-9_]{1,15}/u.test(currentQuery)
  ) {
    return null;
  }

  const handles = [];
  const seen = new Set();
  for (const match of conversation.at(-1).user.matchAll(XNHAN_HANDLE_PATTERN)) {
    const handle = match[1];
    const key = handle.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    handles.push(handle);
  }
  if (handles.length === 0) return null;

  const normalized = currentQuery.toLowerCase();
  let ordinalIndex = null;
  if (/(?:^|[^\p{L}\p{N}_])(?:former|first|thứ nhất|thu nhat|đầu tiên|dau tien)(?=$|[^\p{L}\p{N}_])/iu.test(normalized)) {
    ordinalIndex = 0;
  } else if (/(?:^|[^\p{L}\p{N}_])(?:latter|last|cuối cùng|cuoi cung)(?=$|[^\p{L}\p{N}_])/iu.test(normalized)) {
    ordinalIndex = handles.length - 1;
  } else {
    const wordOrdinals = [
      [/(?:^|[^\p{L}\p{N}_])(?:second|thứ hai|thu hai)(?=$|[^\p{L}\p{N}_])/iu, 1],
      [/(?:^|[^\p{L}\p{N}_])(?:third|thứ ba|thu ba)(?=$|[^\p{L}\p{N}_])/iu, 2],
      [/(?:^|[^\p{L}\p{N}_])fourth(?=$|[^\p{L}\p{N}_])/iu, 3],
      [/(?:^|[^\p{L}\p{N}_])fifth(?=$|[^\p{L}\p{N}_])/iu, 4],
    ];
    for (const [pattern, index] of wordOrdinals) {
      if (!pattern.test(normalized)) continue;
      ordinalIndex = index;
      break;
    }
    if (ordinalIndex === null) {
      const numeric = /(?:^|[^\p{L}\p{N}_])(?:(\d+)(?:st|nd|rd|th)|(?:thứ|thu)\s+(\d+))(?=$|[^\p{L}\p{N}_])/iu.exec(
        normalized,
      );
      const oneBased = Number(numeric?.[1] ?? numeric?.[2]);
      if (Number.isSafeInteger(oneBased) && oneBased > 0) {
        ordinalIndex = oneBased - 1;
      }
    }
  }
  return Number.isSafeInteger(ordinalIndex) && handles[ordinalIndex]
    ? handles[ordinalIndex]
    : null;
}

export function buildXNhanAuthorFocusedSearchQuery(
  contextualQuery,
  authorHandle,
) {
  const normalizedQuery = normalizeXNhanQuery(contextualQuery);
  if (!/^[A-Za-z0-9_]{1,15}$/u.test(authorHandle) || !normalizedQuery) {
    return normalizedQuery;
  }
  const topicContext = normalizeXNhanQuery(
    normalizedQuery.replace(XNHAN_HANDLE_PATTERN, " "),
  );
  return [
    `Find direct public X status posts authored by @${authorHandle}.`,
    `Search X using from:${authorHandle}.`,
    `Return only x.com/${authorHandle}/status URLs.`,
    topicContext ? `Topic context: ${topicContext}` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function boundedMemoryText(value, maxLength) {
  return truncateCodePoints(normalizeConversationText(value), maxLength);
}

function buildAssistantMemory(response) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return "";
  }

  const parts = [];
  const answer = boundedMemoryText(
    response.answer,
    XNHAN_CONVERSATION_ANSWER_MAX_LENGTH,
  );
  if (answer) parts.push(`Previous answer: ${answer}`);

  const posts = Array.isArray(response.posts)
    ? response.posts.slice(0, XNHAN_CONVERSATION_SOURCE_LIMIT)
    : [];
  posts.forEach((post, index) => {
    if (!post || typeof post !== "object" || Array.isArray(post)) return;
    const handle = /^[A-Za-z0-9_]{1,15}$/u.test(post.author?.handle)
      ? `@${post.author.handle}`
      : "unknown author";
    const text = boundedMemoryText(
      post.text,
      XNHAN_CONVERSATION_SOURCE_TEXT_MAX_LENGTH,
    );
    const url = boundedMemoryText(post.url, 256);
    if (!text && !url) return;
    parts.push(
      `Previous result ${index + 1}: ${handle}${text ? ` — ${text}` : ""}${
        url ? ` — ${url}` : ""
      }`,
    );
  });

  if (parts.length === 0) {
    parts.push("Previous result: no X source was selected for that turn.");
  }
  return truncateCodePoints(
    normalizeConversationText(parts.join(" | ")),
    XNHAN_CONVERSATION_ASSISTANT_MAX_LENGTH,
  );
}

export function buildXNhanConversationHistory(turns) {
  if (!Array.isArray(turns) || turns.length === 0) {
    return EMPTY_XNHAN_CONVERSATION;
  }

  const candidates = turns.flatMap((turn) => {
    const user = normalizeXNhanQuery(turn?.submittedQuery);
    const assistant = buildAssistantMemory(turn?.response);
    return user && xNhanQueryLength(user) <= XNHAN_QUERY_MAX_LENGTH && assistant
      ? [{ user, assistant }]
      : [];
  });
  const selected = [];
  for (
    let index = candidates.length - 1;
    index >= 0 && selected.length < XNHAN_CONVERSATION_MAX_TURNS;
    index -= 1
  ) {
    selected.unshift(candidates[index]);
    if (normalizeXNhanConversationHistory(selected) === null) {
      selected.shift();
      break;
    }
  }

  return normalizeXNhanConversationHistory(selected) ?? EMPTY_XNHAN_CONVERSATION;
}

export function isXNhanPath(pathname) {
  if (typeof pathname !== "string") return false;
  const pathOnly = pathname.split(/[?#]/u, 1)[0];
  const normalized = pathOnly.replace(/\/+$/u, "") || "/";
  return normalized === "/xnhan" || normalized === "/xnhan.html";
}

export function isXNhanAboutPath(pathname) {
  if (typeof pathname !== "string") return false;
  const pathOnly = pathname.split(/[?#]/u, 1)[0];
  const normalized = pathOnly.replace(/\/+$/u, "") || "/";
  return normalized === "/xnhan/about" || normalized === "/xnhan-about.html";
}
