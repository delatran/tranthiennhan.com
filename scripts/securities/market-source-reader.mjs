import { createHash } from "node:crypto";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import {
  publicResearchUrl,
  publicResearchRedirectUrl,
} from "../../worker/securities/market-research.js";
import { SECURITIES_SOURCE_POLICY } from "../../shared/securities/source-contract.js";
import { nodeMarketResearchFetch } from "./source-network.mjs";

const TIMEOUT_MS = 20_000;
const TEXT_LIMIT = 250_000;
const MAX_PAGES = 300;
const READ_PAGES = 20;
const EXCLUDED = new Set(["script", "style", "head", "template", "noscript"]);
const RAW_TEXT = new Set(["script", "style", "noscript"]);
const ENTITIES = Object.freeze({
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  hellip: "…",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  times: "×",
  divide: "÷",
  minus: "−",
  aacute: "á",
  agrave: "à",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  euml: "ë",
  iacute: "í",
  igrave: "ì",
  icirc: "î",
  iuml: "ï",
  ntilde: "ñ",
  oacute: "ó",
  ograve: "ò",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  oslash: "ø",
  uacute: "ú",
  ugrave: "ù",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  yuml: "ÿ",
});
const fail = (code) =>
  Object.assign(new Error(code), {
    code,
    status: code === "source_timeout" ? 504 : code === "source_cancelled" ? 499 : 502,
  });
const aborted = (signal) =>
  fail(signal.reason?.name === "TimeoutError" ? "source_timeout" : "source_cancelled");
const cancelBody = (response) => {
  void response.body?.cancel().catch(() => {});
};
const normalize = (text) =>
  text
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

async function bounded(promise, signal) {
  let cancel;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        cancel = () => reject(aborted(signal));
        if (signal.aborted) cancel();
        else signal.addEventListener("abort", cancel, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function entities(text) {
  return text.replace(
    /&(#(?:x[\da-f]{1,8}|\d{1,10})|[a-z][a-z0-9]{1,31});/giu,
    (original, name) => {
      if (name.startsWith("#")) {
        const hexadecimal = name[1].toLowerCase() === "x";
        const code = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
          ? String.fromCodePoint(code)
          : "�";
      }
      if (Object.hasOwn(ENTITIES, name)) return ENTITIES[name];
      const lower = name.toLowerCase();
      if (["AMP", "LT", "GT", "QUOT"].includes(name)) return ENTITIES[lower];
      if (
        /^[A-Z][a-z]+$/u.test(name) &&
        Object.hasOwn(ENTITIES, lower) &&
        ENTITIES[lower].length === 1
      )
        return ENTITIES[lower].toUpperCase();
      return original;
    },
  );
}

/** Static HTML text only; no DOM, script, style, hidden template or browser execution. */
function htmlText(html) {
  const pieces = [],
    excluded = [];
  const startTag = /<(\/?)([a-z][a-z0-9:-]*)\b/iy;
  const lower = html.toLowerCase();
  let position = 0,
    incomplete = false;
  while (position < html.length) {
    if (RAW_TEXT.has(excluded.at(-1))) {
      const name = excluded.at(-1);
      const close = new RegExp(`</${name}\\s*>`, "igu");
      close.lastIndex = position;
      const match = close.exec(html);
      if (!match) {
        incomplete = true;
        break;
      }
      position = close.lastIndex;
      excluded.pop();
      pieces.push(" ");
      continue;
    }
    const next = html.indexOf("<", position);
    if (next === -1) {
      if (!excluded.length) pieces.push(html.slice(position));
      break;
    }
    if (!excluded.length) pieces.push(html.slice(position, next));
    if (lower.startsWith("<!--", next)) {
      const end = html.indexOf("-->", next + 4);
      if (end === -1) {
        incomplete = true;
        break;
      }
      position = end + 3;
      pieces.push(" ");
      continue;
    }
    startTag.lastIndex = next;
    const tag = startTag.exec(html);
    if (!tag && !/^<!|^<\?/u.test(html.slice(next, next + 2))) {
      if (!excluded.length) pieces.push("<");
      position = next + 1;
      continue;
    }
    let end = tag ? startTag.lastIndex : next + 2,
      quote = null;
    for (; end < html.length; end++) {
      const character = html[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === ">") break;
    }
    if (end === html.length) {
      incomplete = true;
      break;
    }
    position = end + 1;
    if (tag) {
      const name = tag[2].toLowerCase(),
        closing = Boolean(tag[1]);
      if (EXCLUDED.has(name)) {
        if (!closing) excluded.push(name);
        else {
          const index = excluded.lastIndexOf(name);
          if (index >= 0) {
            if (index !== excluded.length - 1) incomplete = true;
            excluded.splice(index);
          }
        }
      }
    }
    pieces.push(" ");
  }
  const text = normalize(entities(pieces.join("")));
  return {
    text: text.slice(0, TEXT_LIMIT),
    extraction: {
      method: "static_html",
      partial: incomplete || excluded.length > 0 || text.length > TEXT_LIMIT || !text,
      pagesRead: null,
      totalPages: null,
    },
  };
}

function rejectHtmlGate(html, text, url) {
  const title = normalize(
    entities(
      /<title\b[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html)?.[1].replace(/<[^>]*>/gu, " ") ?? "",
    ),
  );
  const beginning = text.slice(0, 2500);
  if (
    /captcha|access (?:denied|restricted)|permission denied|checking your browser|verify (?:that )?you are human|cloudflare ray id|(?:403|404|503)\s+(?:forbidden|not found|service unavailable)|truy cập bị từ chối|không tìm thấy trang|trang không tồn tại/iu.test(
      `${title}\n${beginning}`,
    ) ||
    /(?:request (?:was )?blocked|please enable (?:javascript|cookies) to continue)/iu.test(
      beginning,
    )
  )
    throw fail("source_access_challenge");
  const login = /(?:sign[ -]?in|log[ -]?in|đăng nhập|authentication required)/iu;
  if (
    login.test(title) ||
    /\/(?:login|signin|sign-in|dang-nhap)(?:\/|$)/iu.test(new URL(url).pathname) ||
    (/<input\b[^>]*type\s*=\s*["']?password\b/iu.test(html) &&
      text.length < 2000 &&
      login.test(beginning))
  )
    throw fail("source_login_required");
}

async function readBytes(response, limit, signal) {
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > limit)) {
    cancelBody(response);
    throw fail("source_too_large");
  }
  const reader = response.body?.getReader();
  if (!reader) throw fail("source_invalid_content");
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await bounded(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw fail("source_too_large");
      chunks.push(value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (!size || (declared !== null && Number(declared) !== size))
    throw fail("source_partial_content");
  return Buffer.concat(chunks, size);
}

async function extractPdf(bytes, signal) {
  if (signal.aborted) throw aborted(signal);
  const data = Uint8Array.from(bytes);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { kind: "market-source-pdf-text", bytes: data.buffer },
    transferList: [data.buffer],
    resourceLimits: { maxOldGenerationSizeMb: 256 },
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = async (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      await worker.terminate().catch(() => {});
      if (error) reject(error);
      else resolve(value);
    };
    const cancel = () => {
      void finish(aborted(signal));
    };
    worker.once("message", (message) => {
      void finish(
        message?.ok
          ? null
          : fail(
              message?.code === "source_page_limit" ? "source_page_limit" : "source_parse_failed",
            ),
        message?.value,
      );
    });
    worker.once("error", () => {
      void finish(fail("source_parse_failed"));
    });
    worker.once("exit", () => {
      if (!settled) void finish(fail("source_parse_failed"));
    });
    if (signal.aborted) cancel();
    else signal.addEventListener("abort", cancel, { once: true });
  });
}

/** Downloaded source text verifies excerpt containment only, never a whole filing or its figures. */
export async function readMarketResearchSource({
  url,
  domains,
  signal,
  fetchImpl = nodeMarketResearchFetch,
  now = () => new Date().toISOString(),
} = {}) {
  const target = publicResearchUrl(url, domains);
  if (target !== url) throw fail("unsafe_source_url");
  const deadline = new AbortController();
  const timer = setTimeout(
    () => deadline.abort(new DOMException("Source read timed out", "TimeoutError")),
    TIMEOUT_MS,
  );
  const combined = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal;
  const access = { requestedUrl: target, resolvedUrl: target, attempts: [], redirects: [] };
  const seen = new Set([target]);
  try {
    let response;
    while (true) {
      if (combined.aborted) throw aborted(combined);
      const current = access.resolvedUrl;
      const attempt = { url: current, status: null };
      access.attempts.push(attempt);
      response = await bounded(
        fetchImpl(current, {
          // Each accepted hop is independently URL-validated and DNS-pinned by
          // the transport. No credentials or caller headers reach a source.
          domains: [new URL(current).hostname],
          signal: combined,
          method: "GET",
          redirect: "manual",
          credentials: "omit",
        }),
        combined,
      );
      attempt.status = response.status;
      if (response.url && response.url !== current) {
        cancelBody(response);
        throw fail("source_redirect_rejected");
      }
      if (response.status < 300 || response.status >= 400) break;
      cancelBody(response);
      if (![301, 302, 303, 307, 308].includes(response.status))
        throw fail("source_redirect_rejected");
      if (access.redirects.length >= SECURITIES_SOURCE_POLICY.maxRedirects)
        throw fail("source_redirect_limit");
      const location = response.headers.get("location");
      if (!location || location.length > 2000 || /[\\\s\u0000-\u001f\u007f]/u.test(location))
        throw fail("source_redirect_rejected");
      let next;
      try {
        next = publicResearchRedirectUrl(new URL(location, current).href, target);
      } catch {
        throw fail("source_redirect_rejected");
      }
      if (seen.has(next)) throw fail("source_redirect_loop");
      seen.add(next);
      access.redirects.push({ from: current, to: next, status: response.status });
      access.resolvedUrl = next;
    }
    if (!response.ok) {
      cancelBody(response);
      throw fail(
        response.status === 401 || response.status === 403
          ? "source_access_challenge"
          : "source_fetch_failed",
      );
    }
    if (response.status === 206 || response.headers.has("content-range")) {
      cancelBody(response);
      throw fail("source_partial_content");
    }
    const mime = (response.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
    if (!["text/html", "application/pdf"].includes(mime)) {
      cancelBody(response);
      throw fail("source_invalid_type");
    }
    if (
      response.headers.get("content-encoding") &&
      response.headers.get("content-encoding").toLowerCase() !== "identity"
    ) {
      cancelBody(response);
      throw fail("source_unsupported_encoding");
    }
    const bytes = await readBytes(
      response,
      mime === "text/html"
        ? SECURITIES_SOURCE_POLICY.maxHtmlBytes
        : SECURITIES_SOURCE_POLICY.maxBytes,
      combined,
    );
    const hash = createHash("sha256").update(bytes).digest("hex");
    const fetchedAt = new Date(now()).toISOString();
    let extracted;
    if (mime === "text/html") {
      const encoding =
        /charset\s*=\s*["']?([a-z0-9._-]+)/iu.exec(response.headers.get("content-type"))?.[1] ??
        "utf-8";
      let html;
      try {
        html = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      } catch {
        throw fail("source_invalid_encoding");
      }
      if (
        !/<(?:!doctype\s+html|html|head|body|main|article|section|div|p|table|h[1-6])\b/iu.test(
          html,
        )
      )
        throw fail("source_invalid_content");
      extracted = htmlText(html);
      rejectHtmlGate(html, extracted.text, access.resolvedUrl);
    } else {
      if (
        !bytes.subarray(0, 8).toString("ascii").startsWith("%PDF-") ||
        !bytes.subarray(Math.max(0, bytes.length - 4096)).includes(Buffer.from("%%EOF"))
      )
        throw fail("source_invalid_content");
      extracted = await extractPdf(bytes, combined);
    }
    if (combined.aborted) throw aborted(combined);
    return {
      schemaVersion: 1,
      url: target,
      hash,
      byteLength: bytes.length,
      fetchedAt,
      contentType: mime,
      access,
      ...extracted,
    };
  } catch (error) {
    const failure = combined.aborted
      ? aborted(combined)
      : error && typeof error === "object"
        ? error
        : fail("source_fetch_failed");
    failure.sourceAccess = access;
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

// PDF parsing runs in an owned thread so the deadline can stop CPU-bound input.
if (!isMainThread && workerData?.kind === "market-source-pdf-text") {
  const parse = async () => {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(workerData.bytes),
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      disableAutoFetch: true,
      disableRange: true,
      disableStream: true,
      enableXfa: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      verbosity: 0,
      stopAtErrors: true,
    });
    try {
      const document = await loading.promise;
      if (
        !Number.isInteger(document.numPages) ||
        document.numPages < 1 ||
        document.numPages > MAX_PAGES
      )
        throw fail("source_page_limit");
      const parts = [];
      let pagesRead = 0,
        characters = 0,
        partial = false;
      for (let number = 1; number <= Math.min(READ_PAGES, document.numPages); number++) {
        const page = await document.getPage(number);
        try {
          const content = await page.getTextContent();
          const pageText = normalize(
            content.items
              .filter((item) => typeof item.str === "string")
              .map((item) => item.str)
              .join(" "),
          );
          pagesRead += 1;
          if (!pageText) partial = true;
          const remaining = Math.max(0, TEXT_LIMIT - characters - (parts.length ? 1 : 0));
          parts.push(pageText.slice(0, remaining));
          characters += Math.min(pageText.length, remaining) + (parts.length > 1 ? 1 : 0);
          if (pageText.length > remaining) {
            partial = true;
            break;
          }
        } finally {
          page.cleanup();
        }
      }
      return {
        text: normalize(parts.join(" ")).slice(0, TEXT_LIMIT),
        extraction: {
          method: "pdf_text",
          partial: partial || pagesRead < document.numPages,
          pagesRead,
          totalPages: document.numPages,
        },
      };
    } finally {
      await loading.destroy();
    }
  };
  try {
    parentPort.postMessage({ ok: true, value: await parse() });
  } catch (error) {
    parentPort.postMessage({ ok: false, code: error?.code ?? "source_parse_failed" });
  } finally {
    parentPort.close();
  }
}
