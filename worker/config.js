export const MODEL = "@cf/zai-org/glm-4.7-flash";
export const XNHAN_OPENAI_DEFAULT_MODEL = "gpt-5.6-luna";
export const XNHAN_MODEL = XNHAN_OPENAI_DEFAULT_MODEL;
export const XNHAN_DISCOVERY_MODEL = XNHAN_MODEL;
export const XNHAN_SYNTHESIS_MODEL = XNHAN_MODEL;
export const XNHAN_OPENROUTER_DEFAULT_MODEL = "z-ai/glm-5.3-flash";
export const SUPPORTED_LOCALES = new Set(["en", "vi"]);

const XNHAN_OPENAI_MODEL_ID_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9._:+-]{0,127})$/u;
const XNHAN_OPENAI_EXPLICIT_CACHE_MODEL_PATTERN =
  /^gpt-5\.6(?:$|[-+:.])/u;

export function isXNhanOpenAiModelId(value) {
  return (
    typeof value === "string" && XNHAN_OPENAI_MODEL_ID_PATTERN.test(value)
  );
}

export function resolveXNhanOpenAiModel(value) {
  return isXNhanOpenAiModelId(value) ? value : null;
}

export function supportsXNhanOpenAiExplicitPromptCache(value) {
  return (
    isXNhanOpenAiModelId(value) &&
    XNHAN_OPENAI_EXPLICIT_CACHE_MODEL_PATTERN.test(value)
  );
}

// OpenAI may echo either the configured alias or its dated snapshot in a
// Responses API result. Accept only that exact alias-to-snapshot relationship;
// never accept an unrelated model merely because it shares a prefix.
export function isXNhanOpenAiModelResponse(expectedModel, actualModel) {
  if (
    !isXNhanOpenAiModelId(expectedModel) ||
    !isXNhanOpenAiModelId(actualModel)
  ) {
    return false;
  }
  if (actualModel === expectedModel) return true;
  const escaped = expectedModel.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^${escaped}-\\d{4}-\\d{2}-\\d{2}$`, "u").test(
    actualModel,
  );
}
