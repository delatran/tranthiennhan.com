import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AskNhan } from "../components/AskNhan.jsx";
import { Header } from "../components/Header.jsx";
import { navigateToTarget } from "../components/navigation.js";
import { content } from "../content.js";
import { usePortfolioWebMcp } from "../portfolio-webmcp.js";
import { useVisitorCount } from "../use-visitor-count.js";
import { PortfolioSections } from "./PortfolioSections.jsx";
import { PortfolioFooter } from "./layout/PortfolioFooter.jsx";
import { usePortfolioLocale } from "./hooks/usePortfolioLocale.js";
import { usePortfolioMetadata } from "./hooks/usePortfolioMetadata.js";
import { usePortfolioReveal } from "./hooks/usePortfolioReveal.js";
import {
  useActivePortfolioSection,
  usePortfolioHashAlignment,
} from "./hooks/usePortfolioScroll.js";
import { usePortfolioVisitorTracking } from "./hooks/usePortfolioVisitorTracking.js";

const UNMOUNTED_PORTFOLIO_WEBMCP_BRIDGE = Object.freeze({ mounted: false });

export function PortfolioRoute() {
  const [locale, setLocale] = usePortfolioLocale();
  const [chatOpen, setChatOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const askPrivateStateRef = useRef(false);
  const webMcpBridgeRef = useRef(UNMOUNTED_PORTFOLIO_WEBMCP_BRIDGE);
  const copy = useMemo(() => content[locale], [locale]);

  usePortfolioMetadata(locale, copy);
  usePortfolioHashAlignment(locale);
  const activeSection = useActivePortfolioSection(locale);
  const visitorCount = useVisitorCount();
  usePortfolioReveal(locale);
  usePortfolioVisitorTracking(locale);

  const openChat = useCallback(() => {
    setMenuOpen(false);
    setChatOpen(true);
  }, []);

  const handleAskPrivacyStateChange = useCallback((hasPrivateState) => {
    askPrivateStateRef.current = hasPrivateState === true;
  }, []);

  useLayoutEffect(() => {
    webMcpBridgeRef.current = Object.freeze({
      mounted: true,
      chatOpen,
      locale,
      changeLocale: setLocale,
      openChat,
      setChatOpen,
      setMenuOpen,
    });

    return () => {
      webMcpBridgeRef.current = UNMOUNTED_PORTFOLIO_WEBMCP_BRIDGE;
    };
  }, [chatOpen, locale, openChat, setLocale]);

  const setNavigationOpen = useCallback((nextOpen) => {
    setMenuOpen(nextOpen);
    if (nextOpen) setChatOpen(false);
  }, []);

  usePortfolioWebMcp({
    askPrivateStateRef,
    bridgeRef: webMcpBridgeRef,
  });

  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => navigateToTarget(event, "main-content")}
      >
        {copy.skip}
      </a>
      <Header
        activeSection={activeSection}
        copy={copy}
        locale={locale}
        menuOpen={menuOpen}
        onLocaleChange={setLocale}
        onMenuChange={setNavigationOpen}
      />
      <PortfolioSections copy={copy} locale={locale} />
      <PortfolioFooter copy={copy} locale={locale} visitorCount={visitorCount} />
      <AskNhan
        copy={copy}
        locale={locale}
        isOpen={chatOpen}
        onOpen={openChat}
        onClose={() => setChatOpen(false)}
        onPrivacyStateChange={handleAskPrivacyStateChange}
        suppressed={menuOpen}
      />
    </>
  );
}
