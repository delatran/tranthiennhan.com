import { registerImperativeWebMcpCatalog } from "./webmcp-registration.js";
import {
  createSerializedWebMcpActionRunner,
  readExactWebMcpResultArray,
  readExactWebMcpResultObject,
  requireBoundedWebMcpString,
  requireWebMcpAction,
  resolveWebMcpLifecycleSignal,
  validateExactWebMcpInput,
} from "./webmcp-runtime.js";

export const XNHAN_ABOUT_WEBMCP_TOOL_NAMES = Object.freeze({
  readOverview: "read_xnhan_about_overview",
  setLocale: "set_xnhan_about_locale",
});

// Kept as the locale-tool alias for callers that predate the two-tool catalog.
export const XNHAN_ABOUT_WEBMCP_TOOL_NAME =
  XNHAN_ABOUT_WEBMCP_TOOL_NAMES.setLocale;

const XNHAN_ABOUT_WEBMCP_CATALOG = Object.freeze({ name: "xnhan-about" });
const LOCALES = Object.freeze(["en", "vi"]);
const ABOUT_PATHS = Object.freeze([
  "/xnhan/about",
  "/xnhan/about/",
  "/xnhan-about.html",
]);
const OVERVIEW_SECTIONS = Object.freeze([
  Object.freeze({ id: "origin", highlightCount: 1 }),
  Object.freeze({ id: "principles", highlightCount: 3 }),
  Object.freeze({ id: "how", highlightCount: 3 }),
  Object.freeze({ id: "boundary", highlightCount: 2 }),
]);
const OVERVIEW_MAX_SERIALIZED_LENGTH = 7_000;
const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({}),
  required: Object.freeze([]),
  additionalProperties: false,
});
const LOCALE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: Object.freeze({
    locale: Object.freeze({
      type: "string",
      description: "Visible About page language: English or Vietnamese.",
      enum: LOCALES,
    }),
  }),
  required: Object.freeze(["locale"]),
  additionalProperties: false,
});
const MUTATING_LOCAL_ANNOTATIONS = Object.freeze({
  readOnlyHint: false,
  untrustedContentHint: false,
});
const READ_ONLY_TRUSTED_ANNOTATIONS = Object.freeze({
  readOnlyHint: true,
  untrustedContentHint: false,
});

function normalizeOverviewResult(result) {
  const overview = readExactWebMcpResultObject(result, [
    "status",
    "locale",
    "path",
    "title",
    "hero",
    "sections",
    "routes",
  ]);
  const stringOptions = { maxLength: 1_200 };
  const status = requireBoundedWebMcpString(overview.status, {
    ...stringOptions,
    allowedValues: ["read"],
  });
  const locale = requireBoundedWebMcpString(overview.locale, {
    ...stringOptions,
    allowedValues: LOCALES,
  });
  const path = requireBoundedWebMcpString(overview.path, {
    ...stringOptions,
    allowedValues: ABOUT_PATHS,
  });
  const title = requireBoundedWebMcpString(overview.title, stringOptions);

  const heroInput = readExactWebMcpResultObject(overview.hero, [
    "eyebrow",
    "titleLines",
    "lede",
    "thesis",
  ]);
  const titleLineInputs = readExactWebMcpResultArray(heroInput.titleLines, 2);
  const hero = Object.freeze({
    eyebrow: requireBoundedWebMcpString(heroInput.eyebrow, stringOptions),
    titleLines: Object.freeze(
      titleLineInputs.map((titleLine) =>
        requireBoundedWebMcpString(titleLine, stringOptions)
      ),
    ),
    lede: requireBoundedWebMcpString(heroInput.lede, stringOptions),
    thesis: requireBoundedWebMcpString(heroInput.thesis, stringOptions),
  });

  const sectionInputs = readExactWebMcpResultArray(
    overview.sections,
    OVERVIEW_SECTIONS.length,
  );
  const sections = Object.freeze(
    sectionInputs.map((value, index) => {
      const expected = OVERVIEW_SECTIONS[index];
      const section = readExactWebMcpResultObject(value, [
        "id",
        "title",
        "highlights",
      ]);
      const highlightInputs = readExactWebMcpResultArray(
        section.highlights,
        expected.highlightCount,
      );
      return Object.freeze({
        id: requireBoundedWebMcpString(section.id, {
          ...stringOptions,
          allowedValues: [expected.id],
        }),
        title: requireBoundedWebMcpString(section.title, stringOptions),
        highlights: Object.freeze(
          highlightInputs.map((highlight) =>
            requireBoundedWebMcpString(highlight, stringOptions)
          ),
        ),
      });
    }),
  );

  const routeInput = readExactWebMcpResultObject(overview.routes, [
    "product",
    "portfolio",
  ]);
  const routes = Object.freeze({
    product: requireBoundedWebMcpString(routeInput.product, {
      ...stringOptions,
      allowedValues: [`/xnhan?lang=${locale}`],
    }),
    portfolio: requireBoundedWebMcpString(routeInput.portfolio, {
      ...stringOptions,
      allowedValues: [`/${locale}`],
    }),
  });

  const normalized = Object.freeze({
    status,
    locale,
    path,
    title,
    hero,
    sections,
    routes,
  });
  if (JSON.stringify(normalized).length > OVERVIEW_MAX_SERIALIZED_LENGTH) {
    throw new TypeError("WebMCP action returned an unsupported result.");
  }
  return normalized;
}

function normalizeLocaleResult(result, locale) {
  const localeResult = readExactWebMcpResultObject(result, [
    "status",
    "locale",
    "path",
  ]);
  const status = requireBoundedWebMcpString(localeResult.status, {
    allowedValues: ["changed", "unchanged"],
  });
  const returnedLocale = requireBoundedWebMcpString(localeResult.locale, {
    allowedValues: [locale],
  });
  const path = requireBoundedWebMcpString(localeResult.path, {
    allowedValues: ABOUT_PATHS,
  });
  return Object.freeze({ status, locale: returnedLocale, path });
}

export function createXNhanAboutWebMcpTools(actions, { signal } = {}) {
  const readXNhanAboutOverview = requireWebMcpAction(
    actions,
    "readXNhanAboutOverview",
  );
  const setXNhanAboutLocale = requireWebMcpAction(
    actions,
    "setXNhanAboutLocale",
  );
  const lifecycleSignal = resolveWebMcpLifecycleSignal(signal);
  const runSerializedAction =
    createSerializedWebMcpActionRunner(lifecycleSignal);

  return Object.freeze([
    Object.freeze({
      name: XNHAN_ABOUT_WEBMCP_TOOL_NAMES.readOverview,
      title: "Read X Nhân About overview · Đọc tổng quan Về X Nhân",
      description:
        "Read one bounded snapshot of the public editorial copy currently rendered on X Nhân About, after its locale, route, title, and visible copy commit. It does not read chat transcripts, browser storage, provider data, analytics, private prompts, or credentials. Đọc một ảnh chụp giới hạn của nội dung biên tập công khai đang hiển thị trên trang Về X Nhân; công cụ không đọc hội thoại, bộ nhớ trình duyệt, dữ liệu nhà cung cấp, phân tích, prompt riêng hay thông tin xác thực.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: READ_ONLY_TRUSTED_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        validateExactWebMcpInput(input, null);
        return await runSerializedAction(
          readXNhanAboutOverview,
          [],
          executionSignal,
          normalizeOverviewResult,
        );
      },
    }),
    Object.freeze({
      name: XNHAN_ABOUT_WEBMCP_TOOL_NAMES.setLocale,
      title: "Set X Nhân About locale",
      description:
        "Switch the visible X Nhân About article between English and Vietnamese, wait for its page language and editorial copy to update, preserve the current route, and attempt to save the same language preference used by the portfolio and X Nhân when browser storage is available.",
      inputSchema: LOCALE_INPUT_SCHEMA,
      annotations: MUTATING_LOCAL_ANNOTATIONS,
      async execute(input, { signal: executionSignal } = {}) {
        const locale = validateExactWebMcpInput(input, "locale", LOCALES);
        return await runSerializedAction(
          setXNhanAboutLocale,
          [locale],
          executionSignal,
          (result) => normalizeLocaleResult(result, locale),
        );
      },
    }),
  ]);
}

export function registerXNhanAboutWebMcpTools({
  actions,
  documentObject = globalThis.document,
  onRegistrationError,
} = {}) {
  return registerImperativeWebMcpCatalog({
    catalogKey: XNHAN_ABOUT_WEBMCP_CATALOG,
    createTools: (signal) => createXNhanAboutWebMcpTools(actions, { signal }),
    documentObject,
    onRegistrationError,
  });
}
