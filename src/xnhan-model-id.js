const OPENAI_MODEL_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:+-]{0,127})$/u;
const OPENROUTER_MODEL_ID_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{0,63})\/[A-Za-z0-9](?:[A-Za-z0-9._:+-]{0,127})$/u;
const OPENROUTER_LATEST_MODEL_ID_PATTERN =
  /^~[a-z0-9](?:[a-z0-9._-]{0,63})\/[A-Za-z0-9](?:[A-Za-z0-9._:+-]{0,127})-latest$/u;

export function isXNhanModelId(value, provider) {
  if (typeof value !== "string") return false;
  if (provider === "openai") return OPENAI_MODEL_ID_PATTERN.test(value);
  if (provider === "openrouter") {
    return (
      OPENROUTER_MODEL_ID_PATTERN.test(value) ||
      OPENROUTER_LATEST_MODEL_ID_PATTERN.test(value)
    );
  }
  return false;
}
