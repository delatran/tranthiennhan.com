const MAX_BODY_BYTES = 4_096;
const SAFE_ERROR_NAMES = new Set([
  "AbortError",
  "AggregateError",
  "Error",
  "NetworkError",
  "RangeError",
  "SyntaxError",
  "TimeoutError",
  "TypeError",
]);

const API_HEADERS = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Content-Type": "application/json; charset=utf-8",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), publickey-credentials-get=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const HTML_CSP_NONCE_BYTES = 16;
const SCRIPT_SRC_DIRECTIVE = /(^|;)[ \t]*script-src(?=[ \t]|;|$)[^;]*/iu;

function createCspNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(HTML_CSP_NONCE_BYTES));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function isSuccessfulHtmlResponse(response) {
  if (!response.ok) return false;

  const contentType = response.headers.get("Content-Type");
  return contentType?.split(";", 1)[0].trim().toLowerCase() === "text/html";
}

export function withHtmlCspNonce(response) {
  if (!isSuccessfulHtmlResponse(response)) return response;

  const existingPolicy = response.headers.get("Content-Security-Policy");
  const scriptDirective = existingPolicy?.match(SCRIPT_SRC_DIRECTIVE);
  if (!existingPolicy || !scriptDirective || scriptDirective.index === undefined) {
    return response;
  }

  const nonce = createCspNonce();
  const directiveEnd =
    scriptDirective.index + scriptDirective[0].trimEnd().length;
  const policy = `${existingPolicy.slice(0, directiveEnd)} 'nonce-${nonce}'${existingPolicy.slice(directiveEnd)}`;
  const headers = new Headers(response.headers);
  headers.set("Content-Security-Policy", policy);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function jsonResponse(payload, { status = 200, requestId, headers } = {}) {
  const responseHeaders = new Headers(API_HEADERS);
  if (requestId) responseHeaders.set("X-Request-ID", requestId);
  Object.entries(headers ?? {}).forEach(([name, value]) => {
    responseHeaders.set(name, value);
  });

  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders,
  });
}

export function errorResponse(code, status, requestId, headers) {
  return jsonResponse({ error: code, requestId }, { status, requestId, headers });
}

export function streamResponse(readable, { requestId, headers } = {}) {
  const responseHeaders = new Headers(API_HEADERS);
  responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
  responseHeaders.set("Connection", "keep-alive");
  if (requestId) responseHeaders.set("X-Request-ID", requestId);
  Object.entries(headers ?? {}).forEach(([name, value]) => {
    responseHeaders.set(name, value);
  });

  return new Response(readable, { status: 200, headers: responseHeaders });
}

export function noContentResponse() {
  const headers = new Headers(API_HEADERS);
  headers.delete("Content-Type");
  return new Response(null, { status: 204, headers });
}

export function safeErrorName(error) {
  if (!(error instanceof Error)) return "OtherError";
  return SAFE_ERROR_NAMES.has(error.name) ? error.name : "OtherError";
}

export const WORKER_FETCH_REDIRECT = "manual";

export function isUpstreamRedirectResponse(response) {
  return response.status >= 300 && response.status < 400;
}

export function isSameOrigin(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function hasStrictSameOriginEvidence(request) {
  if (request.headers.has("Origin")) return isSameOrigin(request);
  return request.headers.get("Sec-Fetch-Site") === "same-origin";
}

export async function readBoundedRequestBody(request, maxBytes = MAX_BODY_BYTES) {
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
      return { tooLarge: true, text: "" };
    }
  }

  if (!request.body) return { tooLarge: false, text: "" };

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel("request_body_too_large");
        return { tooLarge: true, text: "" };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return { tooLarge: false, text: new TextDecoder().decode(bytes) };
}
