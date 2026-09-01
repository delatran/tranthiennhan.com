import { useLayoutEffect } from "react";
import { askNhanModalBackgroundElements } from "./components/modal-inertness.js";
import { navigateToTargetById } from "./components/navigation.js";
import { content } from "./content.js";
import {
  registerPortfolioWebMcpTools,
  waitForWebMcpState,
} from "./webmcp.js";

const PORTFOLIO_NAME = "Trần Thiện Nhân";

function frozenPublicRecord(record) {
  return Object.freeze(record);
}

function contactKindForHref(href) {
  if (href.startsWith("mailto:")) return "email";
  if (href.startsWith("https://www.linkedin.com/")) return "linkedin";
  if (href === "https://x.com/tran_thien_nhan") return "x";
  throw new TypeError("Unsupported public contact link.");
}

export function portfolioOverviewForLocale(locale) {
  if (typeof locale !== "string" || !Object.hasOwn(content, locale)) {
    throw new TypeError("Unsupported portfolio locale.");
  }
  const copy = content[locale];

  const sections = Object.freeze([
    frozenPublicRecord({ target: "top", label: copy.hero.eyebrow }),
    frozenPublicRecord({ target: "work", label: copy.work.title }),
    frozenPublicRecord({ target: "product", label: copy.product.title }),
    frozenPublicRecord({ target: "experience", label: copy.experience.title }),
    frozenPublicRecord({ target: "about", label: copy.about.title }),
    frozenPublicRecord({ target: "contact", label: copy.contact.title }),
  ]);
  const caseStudies = Object.freeze(
    copy.work.items.map((item) =>
      frozenPublicRecord({
        target: `work-${item.slug}`,
        title: item.title,
        status: item.status,
        dates: item.dates,
      }),
    ),
  );
  const contactOptions = Object.freeze(
    copy.contact.links.map((link) =>
      frozenPublicRecord({
        kind: contactKindForHref(link.href),
        label: link.label,
        value: link.value,
        href: link.href,
      }),
    ),
  );

  return frozenPublicRecord({
    status: "read",
    locale,
    path: `/${locale}`,
    profile: frozenPublicRecord({
      name: PORTFOLIO_NAME,
      role: copy.hero.role,
      location: copy.hero.location,
    }),
    sections,
    caseStudies,
    product: frozenPublicRecord({
      name: copy.product.name,
      route: "/xnhan",
      aboutRoute: "/xnhan/about",
    }),
    contactOptions,
  });
}

function visibleText(element) {
  return element?.textContent?.replace(/\s+/gu, " ").trim() ?? "";
}

export function portfolioOverviewMatchesDocument(
  overview,
  {
    documentObject = globalThis.document,
    locationObject = globalThis.location,
  } = {},
) {
  if (
    documentObject?.documentElement?.lang !== overview.locale ||
    locationObject?.pathname !== overview.path ||
    documentObject.getElementById("hero-title")?.getAttribute("aria-label") !==
      overview.profile.name ||
    visibleText(documentObject.querySelector(".hero-role")) !==
      overview.profile.role ||
    visibleText(documentObject.querySelector(".hero-location")) !==
      overview.profile.location
  ) {
    return false;
  }

  const sectionHeadingIds = [
    "hero-title",
    "work-title",
    "product-title",
    "experience-title",
    "approach-title",
    "contact-title",
  ];
  if (
    overview.sections.some(
      (section, index) =>
        !documentObject.getElementById(section.target) ||
        !documentObject.getElementById(sectionHeadingIds[index]) ||
        (section.target !== "top" &&
          visibleText(documentObject.getElementById(sectionHeadingIds[index])) !==
            section.label),
    )
  ) {
    return false;
  }

  if (
    overview.caseStudies.some(
      (caseStudy) =>
        !documentObject.getElementById(caseStudy.target) ||
        visibleText(
          documentObject.getElementById(
            `case-title-${caseStudy.target.slice("work-".length)}`,
          ),
        ) !== caseStudy.title,
    )
  ) {
    return false;
  }

  const anchors = Array.from(documentObject.querySelectorAll("a[href]"));
  return [
    overview.product.route,
    overview.product.aboutRoute,
    ...overview.contactOptions.map(({ href }) => href),
  ].every((href) =>
    anchors.some((anchor) => anchor.getAttribute("href") === href),
  );
}

function askNhanModalCleanupFinished(documentObject) {
  return (
    documentObject.body.style.overflow !== "hidden" &&
    !documentObject.getElementById("main-content")?.hasAttribute("inert") &&
    askNhanModalBackgroundElements(documentObject).every(
      (element) => !element.hasAttribute("inert") && !element.hasAttribute("aria-hidden"),
    )
  );
}

function focusAskNhanInput(documentObject) {
  const input = documentObject.getElementById("ask-nhan-input");
  if (!input) return false;
  if (documentObject.activeElement !== input) input.focus({ preventScroll: true });
  return documentObject.activeElement === input;
}

function askNhanModalOpenFinished(dialog, documentObject) {
  if (!dialog || !focusAskNhanInput(documentObject)) return false;
  if (dialog.getAttribute("aria-modal") !== "true") return true;

  return (
    documentObject.body.style.overflow === "hidden" &&
    askNhanModalBackgroundElements(documentObject).every(
      (element) =>
        element.hasAttribute("inert") &&
        element.getAttribute("aria-hidden") === "true",
    )
  );
}

function abortIfUnavailable(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = new Error("WebMCP route lifecycle was aborted.");
  error.name = "AbortError";
  throw error;
}

function committedPortfolioBridge(bridgeRef, signal) {
  abortIfUnavailable(signal);
  const bridge = bridgeRef.current;
  if (!bridge || bridge.mounted !== true) {
    throw new Error("webmcp_bridge_unmounted");
  }
  return bridge;
}

export function createPortfolioRouteWebMcpActions({
  askPrivateStateRef,
  bridgeRef,
  documentObject = globalThis.document,
  navigate = navigateToTargetById,
  waitForState = waitForWebMcpState,
  windowObject = globalThis.window,
}) {
  return {
    async readPortfolioOverview({ signal } = {}) {
      const bridge = committedPortfolioBridge(bridgeRef, signal);
      const overview = portfolioOverviewForLocale(bridge.locale);
      await waitForState(
        () => {
          const current = committedPortfolioBridge(bridgeRef, signal);
          return (
            current.locale === overview.locale &&
            portfolioOverviewMatchesDocument(overview, {
              documentObject,
              locationObject: windowObject.location,
            })
          );
        },
        { signal },
      );
      committedPortfolioBridge(bridgeRef, signal);
      return overview;
    },
    async navigatePortfolioSection(target, { signal } = {}) {
      committedPortfolioBridge(bridgeRef, signal).setMenuOpen(false);
      committedPortfolioBridge(bridgeRef, signal).setChatOpen(false);
      await waitForState(
        () => {
          committedPortfolioBridge(bridgeRef, signal);
          return (
            !documentObject.getElementById("ask-nhan-dialog") &&
            !documentObject.querySelector(".mobile-menu-overlay") &&
            askNhanModalCleanupFinished(documentObject)
          );
        },
        { signal },
      );
      committedPortfolioBridge(bridgeRef, signal);
      const navigation = await navigate(
        target,
        () => committedPortfolioBridge(bridgeRef, signal),
        { signal },
      );

      if (!navigation) throw new Error("webmcp_navigation_unavailable");

      const current = committedPortfolioBridge(bridgeRef, signal);
      return {
        status: "navigated",
        target,
        focusId: navigation.focusId,
        focused: navigation.focused,
        locale: current.locale,
        path: windowObject.location.pathname,
        hash: windowObject.location.hash,
      };
    },
    async setPortfolioLocale(nextLocale, { signal } = {}) {
      const previousLocale = committedPortfolioBridge(bridgeRef, signal).locale;
      const preservedHash = windowObject.location.hash;
      if (nextLocale !== previousLocale) {
        committedPortfolioBridge(bridgeRef, signal).changeLocale(nextLocale);
      }

      await waitForState(
        () => {
          const current = committedPortfolioBridge(bridgeRef, signal);
          return (
            current.locale === nextLocale &&
            documentObject.documentElement.lang === nextLocale &&
            windowObject.location.pathname === `/${nextLocale}` &&
            windowObject.location.hash === preservedHash
          );
        },
        { signal },
      );

      committedPortfolioBridge(bridgeRef, signal);
      return {
        status: nextLocale === previousLocale ? "unchanged" : "changed",
        locale: nextLocale,
        path: windowObject.location.pathname,
      };
    },
    async openAskNhan({ signal } = {}) {
      const bridge = committedPortfolioBridge(bridgeRef, signal);
      if (askPrivateStateRef.current) {
        throw new Error("webmcp_ask_private_state_present");
      }

      const existingDialog = documentObject.getElementById("ask-nhan-dialog");
      if (bridge.chatOpen && existingDialog) {
        committedPortfolioBridge(bridgeRef, signal);
        focusAskNhanInput(documentObject);
        await waitForState(
          () => {
            const current = committedPortfolioBridge(bridgeRef, signal);
            const dialog = documentObject.getElementById("ask-nhan-dialog");
            return Boolean(
              current.chatOpen &&
                dialog &&
                askNhanModalOpenFinished(dialog, documentObject),
            );
          },
          { signal },
        );
        const current = committedPortfolioBridge(bridgeRef, signal);
        return {
          status: "already_open",
          locale: current.locale,
          dialogId: existingDialog.id,
          focusId: "ask-nhan-input",
          focused: true,
        };
      }

      committedPortfolioBridge(bridgeRef, signal).openChat();
      await waitForState(
        () => {
          const current = committedPortfolioBridge(bridgeRef, signal);
          const dialog = documentObject.getElementById("ask-nhan-dialog");
          return Boolean(
            current.chatOpen &&
              dialog &&
              askNhanModalOpenFinished(dialog, documentObject),
          );
        },
        { signal },
      );

      const current = committedPortfolioBridge(bridgeRef, signal);
      return {
        status: "opened",
        locale: current.locale,
        dialogId: "ask-nhan-dialog",
        focusId: "ask-nhan-input",
        focused: true,
      };
    },
    async closeAskNhan({ signal } = {}) {
      const bridge = committedPortfolioBridge(bridgeRef, signal);
      const wasOpen = Boolean(
        bridge.chatOpen || documentObject.getElementById("ask-nhan-dialog"),
      );

      if (!wasOpen) {
        await waitForState(
          () => {
            committedPortfolioBridge(bridgeRef, signal);
            return askNhanModalCleanupFinished(documentObject);
          },
          { signal },
        );
        const current = committedPortfolioBridge(bridgeRef, signal);
        return {
          status: "already_closed",
          locale: current.locale,
          dialogId: "ask-nhan-dialog",
          open: false,
          focusRestored: false,
        };
      }

      committedPortfolioBridge(bridgeRef, signal).setChatOpen(false);
      await waitForState(
        () => {
          const current = committedPortfolioBridge(bridgeRef, signal);
          return (
            !current.chatOpen &&
            !documentObject.getElementById("ask-nhan-dialog") &&
            askNhanModalCleanupFinished(documentObject)
          );
        },
        { signal },
      );

      const launcher = documentObject.querySelector(".chat-launcher");
      committedPortfolioBridge(bridgeRef, signal);
      launcher?.focus({ preventScroll: true });
      await waitForState(
        () => {
          committedPortfolioBridge(bridgeRef, signal);
          return documentObject.activeElement === launcher;
        },
        { signal },
      );

      const current = committedPortfolioBridge(bridgeRef, signal);
      return {
        status: "closed",
        locale: current.locale,
        dialogId: "ask-nhan-dialog",
        open: false,
        focusRestored: true,
      };
    },
  };
}

export function usePortfolioWebMcp({
  askPrivateStateRef,
  bridgeRef,
}) {
  useLayoutEffect(() => {
    const registration = registerPortfolioWebMcpTools({
      actions: createPortfolioRouteWebMcpActions({
        askPrivateStateRef,
        bridgeRef,
      }),
    });

    return registration.cleanup;
  }, [askPrivateStateRef, bridgeRef]);
}
