import { useCallback, useEffect, useRef, useState } from "react";
import { createSecuritiesClient } from "../api.js";
import { stockKey } from "../StockPicker.jsx";

export const publicResearchKey = ({ security, query = "", locale = "vi" }) =>
  JSON.stringify([stockKey(security), locale, query.trim()]);
const emptyResearch = { status: "idle", result: null, error: null };

export function createPublicResearchController({ client = createSecuritiesClient(), onState }) {
  let sequence = 0,
    requestAbort = null;
  const cancel = () => {
    sequence += 1;
    requestAbort?.abort();
    requestAbort = null;
  };
  async function search({ security, query, locale }) {
    cancel();
    const run = sequence,
      abort = new AbortController(),
      identity = stockKey(security);
    const requestKey = publicResearchKey({ security, query, locale });
    const context = { identity, requestKey, query: query.trim(), locale };
    requestAbort = abort;
    onState({ ...context, status: "loading", result: null, error: null });
    try {
      const result = await client.request("/market/research", {
        method: "POST",
        signal: abort.signal,
        body: { symbol: security.symbol, exchange: security.exchange, query: query.trim(), locale },
      });
      if (run !== sequence || abort.signal.aborted) return;
      if (
        result?.symbol !== security.symbol ||
        result?.exchange !== security.exchange ||
        !Array.isArray(result.sources) ||
        !["ready", "partial", "unavailable"].includes(result.status)
      )
        throw new Error("Mismatched research response");
      onState({ ...context, status: "ready", result, error: null });
    } catch (error) {
      if (run === sequence && !abort.signal.aborted)
        onState({
          ...context,
          status: "error",
          result: null,
          error: { code: error.code ?? "market_research_unavailable" },
        });
    } finally {
      if (run === sequence) requestAbort = null;
    }
  }
  return { search, cancel };
}

export function usePublicResearch({
  security,
  query,
  locale = "vi",
  enabled = false,
  active = true,
}) {
  const identity = stockKey(security),
    requestKey = publicResearchKey({ security, query, locale });
  const [state, setState] = useState(emptyResearch);
  const task = useRef(null);
  if (!task.current) task.current = createPublicResearchController({ onState: setState });
  useEffect(() => {
    task.current.cancel();
    setState(emptyResearch);
    return () => task.current.cancel();
  }, [requestKey, active, enabled]);
  const search = useCallback(
    (nextQuery = query ?? "") => {
      if (enabled && active && security?.symbol && security?.exchange)
        return task.current.search({ security, query: nextQuery, locale });
      return Promise.resolve();
    },
    [active, enabled, locale, security, query],
  );
  const current =
    active &&
    state.identity === identity &&
    state.locale === locale &&
    (query === undefined || state.requestKey === requestKey)
      ? state
      : emptyResearch;
  return {
    ...current,
    search,
    cancel: () => {
      task.current.cancel();
      setState(emptyResearch);
    },
  };
}
