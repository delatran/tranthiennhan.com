// Dashboard/API-managed plain-text bindings are intentionally absent from
// wrangler.jsonc so `keep_vars` can preserve model and UI-label changes across
// code deploys. Display names are optional and fall back to the neutral
// hardcoded label "X Nhân" until the owner configures them.
declare namespace Cloudflare {
  interface Env {
    XNHAN_OPENAI_MODEL: string;
    XNHAN_OPENROUTER_MODEL: string;
    XNHAN_OPENAI_MODEL_DISPLAY_NAME?: string;
    XNHAN_OPENROUTER_MODEL_DISPLAY_NAME?: string;
  }
}

interface Env {
  XNHAN_OPENAI_MODEL: string;
  XNHAN_OPENROUTER_MODEL: string;
  XNHAN_OPENAI_MODEL_DISPLAY_NAME?: string;
  XNHAN_OPENROUTER_MODEL_DISPLAY_NAME?: string;
}

declare namespace NodeJS {
  interface ProcessEnv {
    XNHAN_OPENAI_MODEL: string;
    XNHAN_OPENROUTER_MODEL: string;
    XNHAN_OPENAI_MODEL_DISPLAY_NAME?: string;
    XNHAN_OPENROUTER_MODEL_DISPLAY_NAME?: string;
  }
}
