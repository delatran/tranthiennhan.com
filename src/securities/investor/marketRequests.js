import { createSecuritiesClient } from "../api.js";

export const MARKET_DATASETS = ["quote", "history", "company"];
export const QUOTE_REFRESH_MS = 30_000;

export function startQuoteRefresh({
  task,
  request,
  enabled,
  paused,
  isVisible = () => document.visibilityState !== "hidden",
  schedule = (callback, delay) => window.setInterval(callback, delay),
  unschedule = (timer) => window.clearInterval(timer),
}) {
  if (!enabled || paused || request.dataset !== "quote") return () => {};
  const timer = schedule(() => {
    if (isVisible() && !task.isPending()) void task.load(request);
  }, QUOTE_REFRESH_MS);
  return () => unschedule(timer);
}

export function marketPacketMatches(packet, request) {
  return (
    packet?.schemaVersion === 2 &&
    packet.provider === "vndirect_public_web" &&
    packet.access === "public" &&
    packet.symbol === request.symbol &&
    packet.dataset === request.dataset &&
    Array.isArray(packet.rows) &&
    ["ready", "empty", "unavailable"].includes(packet.status) &&
    (!request.exchange || packet.exchange === request.exchange)
  );
}

export function createMarketRequestController({ client = createSecuritiesClient(), onState }) {
  let sequence = 0,
    requestAbort = null;
  const cancel = () => {
    sequence += 1;
    requestAbort?.abort();
    requestAbort = null;
  };
  async function load(request) {
    cancel();
    const run = sequence,
      abort = new AbortController();
    requestAbort = abort;
    const identity = `${request.exchange ?? ""}:${request.symbol}:${request.dataset}`;
    onState({ identity, status: "loading", error: null });
    const params = new URLSearchParams({
      symbol: request.symbol,
      dataset: request.dataset,
      ...(request.exchange ? { exchange: request.exchange } : {}),
    });
    try {
      const packet = await client.request(`/market?${params}`, { signal: abort.signal });
      if (run !== sequence || abort.signal.aborted) return;
      if (!marketPacketMatches(packet, request))
        throw Object.assign(new Error("Mismatched public data response"), {
          code: "market_exchange_mismatch",
        });
      onState({ identity, status: "ready", packet, error: null });
    } catch (error) {
      if (run === sequence && !abort.signal.aborted)
        onState({
          identity,
          status: "error",
          error: { code: error.code ?? "market_source_unavailable" },
        });
    } finally {
      if (run === sequence) requestAbort = null;
    }
  }
  return { load, cancel, isPending: () => Boolean(requestAbort) };
}
