import { useEffect, useRef, useState } from "react";
import { stockKey } from "../StockPicker.jsx";
import { createMarketRequestController, startQuoteRefresh } from "./marketRequests.js";

const emptySnapshot = { packet: null, status: "idle", error: null };

export function usePageVisibility() {
  const [visible, setVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState !== "hidden",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

export function useMarketSnapshot({ security, dataset, active, suspended }) {
  const [refreshCount, setRefreshCount] = useState(0),
    [paused, setPaused] = useState(false);
  const [state, setState] = useState(emptySnapshot),
    task = useRef(null),
    lastRequest = useRef(null);
  const identity = `${stockKey(security)}:${dataset}`;
  const enabled = Boolean(active && security?.symbol && !suspended);
  if (!task.current)
    task.current = createMarketRequestController({
      onState: (next) =>
        setState((current) => ({
          ...next,
          packet: next.packet ?? (current.identity === next.identity ? current.packet : null),
        })),
    });

  useEffect(() => {
    const currentTask = task.current;
    const selectedNewData = lastRequest.current?.identity !== identity;
    const requestedRefresh = lastRequest.current?.refreshCount !== refreshCount;
    if (enabled && (dataset !== "quote" || !paused || selectedNewData || requestedRefresh)) {
      lastRequest.current = { identity, refreshCount };
      void currentTask.load({ symbol: security.symbol, exchange: security.exchange, dataset });
    } else currentTask.cancel();
    return () => currentTask.cancel();
  }, [enabled, paused, identity, security?.symbol, security?.exchange, dataset, refreshCount]);
  useEffect(
    () =>
      startQuoteRefresh({
        task: task.current,
        enabled,
        paused,
        request: { symbol: security?.symbol, exchange: security?.exchange, dataset },
      }),
    [enabled, paused, security?.symbol, security?.exchange, dataset],
  );

  function togglePaused() {
    if (!paused) {
      task.current.cancel();
      setState((current) => ({ ...current, status: current.packet ? "ready" : "idle" }));
    } else setRefreshCount((count) => count + 1);
    setPaused((current) => !current);
  }
  return {
    ...(state.identity === identity ? state : emptySnapshot),
    identity,
    paused,
    togglePaused,
    refresh: () => setRefreshCount((count) => count + 1),
  };
}
