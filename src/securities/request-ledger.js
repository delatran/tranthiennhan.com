const STORAGE_KEY = "securities.pending-requests.v1";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  return value;
}

async function fingerprint(path, body, method = "POST") {
  const payload =
    method === "POST" ? { path, body: canonical(body) } : { method, path, body: canonical(body) };
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Only opaque fingerprints and request IDs persist, never prompts or dossier content. */
export function createRequestLedger({ storage } = {}) {
  if (storage === undefined) {
    try {
      storage = globalThis.sessionStorage;
    } catch {
      storage = null;
    }
  }
  const pending = new Map();
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    for (const [key, value] of Object.entries(saved))
      if (/^[a-f0-9]{64}$/.test(key) && /^[a-zA-Z0-9_-]{8,96}$/.test(value))
        pending.set(key, value);
  } catch {
    /* Backend idempotency still protects in-memory request retries. */
  }
  const save = () => {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(pending)));
    } catch {
      /* Optional recovery across a browser reload. */
    }
  };

  return {
    async execute(client, path, body, { signal, method = "POST" } = {}) {
      if (!["POST", "DELETE"].includes(method)) throw new TypeError("unsupported_mutation_method");
      const candidates = [body];
      if (["vi", "en"].includes(body.locale))
        candidates.push({ ...body, locale: body.locale === "vi" ? "en" : "vi" });
      const attempts = await Promise.all(
        candidates.map(async (candidate) => ({
          body: candidate,
          key: await fingerprint(path, candidate, method),
        })),
      );
      // A locale switch must not turn an uncertain retry into another mutation.
      const attempt = attempts.find((candidate) => pending.has(candidate.key)) ?? attempts[0];
      const { key } = attempt;
      const id = pending.get(key) ?? crypto.randomUUID();
      pending.set(key, id);
      save();
      try {
        const result = await client.request(path, {
          method,
          body: { ...attempt.body, requestId: id },
          signal,
        });
        pending.delete(key);
        save();
        return result;
      } catch (error) {
        // A lost response or server timeout has an uncertain outcome. Reuse its ID.
        if (error.status >= 400 && error.status < 500 && error.status !== 408) {
          pending.delete(key);
          save();
        }
        throw error;
      }
    },
  };
}
