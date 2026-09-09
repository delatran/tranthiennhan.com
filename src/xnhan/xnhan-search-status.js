export function createXNhanSearchStatus(
  phase,
  activeProvider = null,
  visibleResults = null,
) {
  const visibleSearchId = visibleResults?.searchId ?? null;
  return Object.freeze({
    phase,
    active: phase === "searching",
    activeProvider: phase === "searching" ? activeProvider : null,
    visibleSearchId,
    visibleResultProvider:
      visibleSearchId === null ? null : visibleResults?.provider ?? null,
    visibleResultCount:
      visibleSearchId === null ? 0 : visibleResults?.total ?? 0,
  });
}
