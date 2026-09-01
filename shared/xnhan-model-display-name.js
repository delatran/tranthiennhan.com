export const XNHAN_MODEL_DISPLAY_NAME_MAX_LENGTH = 80;
export const XNHAN_MODEL_DISPLAY_NAME_FALLBACK = "X Nhân";

const UNSAFE_MODEL_DISPLAY_NAME_PATTERN =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export function normalizeXNhanModelDisplayName(value) {
  if (typeof value !== "string") return null;

  let normalized;
  try {
    normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  } catch {
    return null;
  }

  const characters = Array.from(normalized);
  if (
    characters.length < 1 ||
    characters.length > XNHAN_MODEL_DISPLAY_NAME_MAX_LENGTH ||
    UNSAFE_MODEL_DISPLAY_NAME_PATTERN.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function resolveXNhanModelDisplayName(value) {
  return (
    normalizeXNhanModelDisplayName(value) ?? XNHAN_MODEL_DISPLAY_NAME_FALLBACK
  );
}
