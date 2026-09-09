export class SecuritiesApiError extends Error {
  constructor(code, message, details, status) {
    super(message || code);
    this.name = "SecuritiesApiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

async function acceptedJob(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new SecuritiesApiError("invalid_response");
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) throw new SecuritiesApiError("invalid_response");
      text += decoder.decode(value, { stream: true });
      const end = text.indexOf("\n");
      if (end < 0) {
        if (text.length > 128_000) throw new SecuritiesApiError("invalid_response");
        continue;
      }
      if (end > 128_000) throw new SecuritiesApiError("invalid_response");
      const payload = JSON.parse(text.slice(0, end));
      if (
        payload.event !== "accepted" ||
        payload.ok !== true ||
        typeof payload.data?.job?.id !== "string" ||
        payload.data.job.id !== response.headers.get("X-Securities-Job-ID")
      )
        throw new SecuritiesApiError("invalid_response");
      // Returning the accepted job enables progress polling and cancellation.
      // Keep consuming the response so its Worker invocation stays active until
      // the persisted terminal result. Status polling remains authoritative.
      void (async () => {
        try {
          while (!(await reader.read()).done) {
            // Heartbeats and the final result need no second in-memory copy.
          }
        } catch {
          // Status polling reports the persisted outcome after a transport failure.
        } finally {
          reader.releaseLock();
        }
      })();
      return payload.data;
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
    if (error.name === "AbortError") throw error;
    throw new SecuritiesApiError("invalid_response", undefined, null, response.status);
  }
}

export function createSecuritiesClient({
  fetchImpl = globalThis.fetch,
  base = "/api/securities",
} = {}) {
  async function request(path, { method = "GET", body, signal } = {}) {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        signal,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept:
            method === "POST" && /^\/dossiers\/[^/]+\/(analyze|chat|refresh)$/u.test(path)
              ? "application/x-ndjson, application/json"
              : "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new SecuritiesApiError(
        "connection_failed",
        "The local research service is unreachable.",
      );
    }
    if (
      response.ok &&
      response.headers.get("Content-Type")?.split(";", 1)[0].trim() === "application/x-ndjson"
    )
      return acceptedJob(response);
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new SecuritiesApiError(
        "invalid_response",
        "The service did not return a valid response.",
        null,
        response.status,
      );
    }
    if (!response.ok || payload.ok !== true) {
      const error = payload.error ?? {};
      throw new SecuritiesApiError(
        error.code ?? "request_failed",
        error.message,
        error.details,
        response.status,
      );
    }
    return payload.data;
  }

  async function download({ dossierId, revision, format, signal }) {
    const response = await fetchImpl(
      `${base}/dossiers/${encodeURIComponent(dossierId)}/export?revision=${encodeURIComponent(revision)}&format=${encodeURIComponent(format)}`,
      {
        signal,
        credentials: "same-origin",
        cache: "no-store",
      },
    );
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new SecuritiesApiError(
        payload.error?.code ?? "export_failed",
        payload.error?.message,
        payload.error?.details,
        response.status,
      );
    }
    const blob = await response.blob();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    const filename =
      disposition.match(/filename="?([^";]+)"?/i)?.[1] ??
      `nhan-securities-${dossierId}-revision-${revision}.${format}`;
    return { blob, filename: filename.replace(/[\\/:*?"<>|]/g, "_"), revision, format };
  }

  return { request, download };
}
