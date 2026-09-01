import { useCallback, useEffect, useLayoutEffect } from "react";

export function resizeAutosizeTextarea(input, maximumHeight = 160) {
  if (!input?.style || !Number.isFinite(maximumHeight) || maximumHeight <= 0) {
    return false;
  }
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, maximumHeight)}px`;
  return true;
}

export function observeAutosizeTextarea(
  input,
  onResize,
  ResizeObserverClass = globalThis.ResizeObserver,
) {
  if (
    !input ||
    typeof onResize !== "function" ||
    typeof ResizeObserverClass !== "function"
  ) {
    return () => {};
  }

  const observer = new ResizeObserverClass(onResize);
  observer.observe(input.parentElement ?? input);
  return () => observer.disconnect();
}

export function useAutosizeTextarea(inputRef, value, maximumHeight = 160) {
  const resize = useCallback(
    () => resizeAutosizeTextarea(inputRef.current, maximumHeight),
    [inputRef, maximumHeight],
  );

  useLayoutEffect(() => {
    resize();
  }, [resize, value]);

  useEffect(() => {
    const input = inputRef.current;
    return observeAutosizeTextarea(input, resize);
  }, [inputRef, resize]);
}
