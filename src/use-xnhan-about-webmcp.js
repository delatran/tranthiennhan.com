import { useLayoutEffect } from "react";
import { waitForWebMcpState } from "./webmcp.js";
import { registerXNhanAboutWebMcpTools } from "./xnhan-about-webmcp.js";
import { xNhanHref } from "./xnhan-locale.js";

function normalizedText(element) {
  if (!element || typeof element.textContent !== "string") return null;
  return element.textContent.replace(/\s+/gu, " ").trim();
}

function exactText(documentObject, selector, expected) {
  return normalizedText(documentObject.querySelector(selector)) === expected;
}

function exactTextList(documentObject, selector, expected) {
  const actual = Array.from(documentObject.querySelectorAll(selector), normalizedText);
  return (
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function freezeSection(id, title, highlights) {
  return Object.freeze({
    id,
    title,
    highlights: Object.freeze([...highlights]),
  });
}

export function createXNhanAboutOverview({ locale, copy, path }) {
  return Object.freeze({
    status: "read",
    locale,
    path,
    title: copy.meta.title,
    hero: Object.freeze({
      eyebrow: copy.hero.eyebrow,
      titleLines: Object.freeze([...copy.hero.titleLines]),
      lede: copy.hero.lede,
      thesis: copy.hero.thesis,
    }),
    sections: Object.freeze([
      freezeSection("origin", copy.origin.title, [copy.origin.paragraphs[0]]),
      freezeSection(
        "principles",
        copy.principles.title,
        copy.principles.items.map((item) => item.title),
      ),
      freezeSection(
        "how",
        copy.how.title,
        copy.how.stages.map((stage) => stage.title),
      ),
      freezeSection("boundary", copy.boundary.title, [
        copy.boundary.intro,
        copy.boundary.conclusion,
      ]),
    ]),
    routes: Object.freeze({
      product: xNhanHref("/xnhan", locale),
      portfolio: `/${locale}`,
    }),
  });
}

export function xNhanAboutOverviewMatchesDocument(
  overview,
  {
    documentObject = globalThis.document,
    locationObject = globalThis.window?.location,
  } = {},
) {
  try {
    if (
      !documentObject ||
      !locationObject ||
      documentObject.documentElement?.lang !== overview.locale ||
      documentObject.title !== overview.title ||
      locationObject.pathname !== overview.path
    ) {
      return false;
    }

    const [origin, principles, how, boundary] = overview.sections;
    const productLink = documentObject.querySelector(
      ".xnhan-about-product-link",
    );
    const portfolioLink = documentObject.querySelector(".xnhan-about-owner");
    return (
      exactText(documentObject, ".xnhan-about-eyebrow", overview.hero.eyebrow) &&
      exactTextList(
        documentObject,
        "#xnhan-about-title [data-title-line]",
        overview.hero.titleLines,
      ) &&
      exactText(documentObject, ".xnhan-about-lede", overview.hero.lede) &&
      exactText(
        documentObject,
        ".xnhan-about-hero-aside blockquote",
        overview.hero.thesis,
      ) &&
      exactText(documentObject, "#xnhan-about-origin h2", origin.title) &&
      exactTextList(
        documentObject,
        "#xnhan-about-origin .xnhan-about-prose > p:first-child",
        origin.highlights,
      ) &&
      exactText(
        documentObject,
        "#xnhan-about-principles h2",
        principles.title,
      ) &&
      exactTextList(
        documentObject,
        "#xnhan-about-principles h3",
        principles.highlights,
      ) &&
      exactText(documentObject, "#xnhan-about-how h2", how.title) &&
      exactTextList(
        documentObject,
        "#xnhan-about-how h3",
        how.highlights,
      ) &&
      exactText(documentObject, "#xnhan-about-boundary h2", boundary.title) &&
      exactTextList(
        documentObject,
        "#xnhan-about-boundary > .xnhan-about-section-intro, #xnhan-about-boundary > .xnhan-about-boundary-note",
        boundary.highlights,
      ) &&
      productLink?.getAttribute("href") === overview.routes.product &&
      portfolioLink?.getAttribute("href") === overview.routes.portfolio
    );
  } catch {
    return false;
  }
}

function abortIfUnavailable(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("WebMCP route lifecycle was aborted.");
  error.name = "AbortError";
  throw error;
}

function committedXNhanAboutBridge(bridgeRef, signal) {
  abortIfUnavailable(signal);
  const bridge = bridgeRef.current;
  if (!bridge || bridge.mounted !== true) {
    throw new Error("webmcp_bridge_unmounted");
  }
  return bridge;
}

export function createXNhanAboutRouteWebMcpActions({
  bridgeRef,
  documentObject = globalThis.document,
  waitForState = waitForWebMcpState,
  windowObject = globalThis.window,
}) {
  return {
    async readXNhanAboutOverview({ signal } = {}) {
      const bridge = committedXNhanAboutBridge(bridgeRef, signal);
      const overview = createXNhanAboutOverview({
        locale: bridge.locale,
        copy: bridge.copy,
        path: windowObject.location.pathname,
      });
      await waitForState(
        () => {
          committedXNhanAboutBridge(bridgeRef, signal);
          return xNhanAboutOverviewMatchesDocument(overview, {
            documentObject,
            locationObject: windowObject.location,
          });
        },
        { signal },
      );
      committedXNhanAboutBridge(bridgeRef, signal);
      return overview;
    },
    async setXNhanAboutLocale(nextLocale, { signal } = {}) {
      const previousLocale = committedXNhanAboutBridge(bridgeRef, signal).locale;
      const preservedPath = windowObject.location.pathname;
      if (nextLocale !== previousLocale) {
        committedXNhanAboutBridge(bridgeRef, signal).changeLocale(nextLocale);
      }
      await waitForState(
        () => {
          const bridge = committedXNhanAboutBridge(bridgeRef, signal);
          if (bridge.locale !== nextLocale) return false;
          return xNhanAboutOverviewMatchesDocument(
            createXNhanAboutOverview({
              locale: bridge.locale,
              copy: bridge.copy,
              path: preservedPath,
            }),
            { documentObject, locationObject: windowObject.location },
          );
        },
        { signal },
      );
      committedXNhanAboutBridge(bridgeRef, signal);
      return {
        status: nextLocale === previousLocale ? "unchanged" : "changed",
        locale: nextLocale,
        path: windowObject.location.pathname,
      };
    },
  };
}

export function useXNhanAboutWebMcp({ bridgeRef }) {
  useLayoutEffect(() => {
    const registration = registerXNhanAboutWebMcpTools({
      actions: createXNhanAboutRouteWebMcpActions({ bridgeRef }),
    });
    return registration.cleanup;
  }, [bridgeRef]);
}
