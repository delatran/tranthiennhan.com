import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { locales } from "../content.js";
import {
  closeMobileNavigationAtDesktopBreakpoint,
  navigateToTarget,
} from "./navigation.js";

const MOBILE_NAVIGATION_MEDIA_QUERY = "(max-width: 64rem)";

function LocaleSwitch({ locale, onChange, label }) {
  const handleLocaleClick = (event, nextLocale) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onChange(nextLocale);
  };

  return (
    <nav className="locale-switch" aria-label={label}>
      {locales.map((item, index) => (
        <span className="locale-option" key={item}>
          {index > 0 ? <span className="locale-divider">/</span> : null}
          <a
            href={`/${item}${window.location.hash}`}
            hrefLang={item}
            lang={item}
            translate="no"
            className={locale === item ? "is-active" : ""}
            aria-current={locale === item ? "page" : undefined}
            onClick={(event) => handleLocaleClick(event, item)}
          >
            {item.toUpperCase()}
          </a>
        </span>
      ))}
    </nav>
  );
}

export function MobileNavigationMenu({
  activeSection,
  copy,
  desktopFocusRef,
  isOpen,
  locale,
  navItems,
  onMenuChange,
  onNavigate,
  openerRef,
  openerScrollRef,
}) {
  const overlayRef = useRef(null);
  const closeButtonRef = useRef(null);
  const restoreBackgroundScrollRef = useRef(true);

  const closeAndRestoreFocus = useCallback(() => {
    restoreBackgroundScrollRef.current = true;
    onMenuChange(false);
    window.requestAnimationFrame(() => {
      openerRef.current?.focus({ preventScroll: true });
    });
  }, [onMenuChange, openerRef]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const appRoot = document.getElementById("root");
    const appRootHadInert = appRoot?.hasAttribute("inert") ?? false;
    const previousAriaHidden = appRoot?.getAttribute("aria-hidden") ?? null;
    const mobileMedia = window.matchMedia(MOBILE_NAVIGATION_MEDIA_QUERY);
    const lockedScrollX = openerScrollRef.current?.x ?? window.scrollX;
    const lockedScrollY = openerScrollRef.current?.y ?? window.scrollY;
    const previousBodyStyle = {
      left: document.body.style.left,
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      right: document.body.style.right,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    const closeOnDesktop = (event) =>
      closeMobileNavigationAtDesktopBreakpoint(
        event,
        onMenuChange,
        desktopFocusRef,
      );

    restoreBackgroundScrollRef.current = true;
    Object.assign(document.body.style, {
      left: `${-lockedScrollX}px`,
      overflow: "hidden",
      position: "fixed",
      right: "0",
      top: `${-lockedScrollY}px`,
      width: "100%",
    });
    document.documentElement.classList.add("mobile-menu-open");
    closeButtonRef.current?.focus({ preventScroll: true });
    appRoot?.setAttribute("inert", "");
    appRoot?.setAttribute("aria-hidden", "true");
    mobileMedia.addEventListener("change", closeOnDesktop);

    return () => {
      Object.assign(document.body.style, previousBodyStyle);
      document.documentElement.classList.remove("mobile-menu-open");
      mobileMedia.removeEventListener("change", closeOnDesktop);

      if (!appRootHadInert) appRoot?.removeAttribute("inert");
      if (previousAriaHidden === null) {
        appRoot?.removeAttribute("aria-hidden");
      } else {
        appRoot?.setAttribute("aria-hidden", previousAriaHidden);
      }

      if (restoreBackgroundScrollRef.current) {
        window.requestAnimationFrame(() => {
          window.scrollTo({
            left: lockedScrollX,
            top: lockedScrollY,
            behavior: "instant",
          });
        });
      }
    };
  }, [desktopFocusRef, isOpen, onMenuChange, openerScrollRef]);

  const handleOverlayKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRestoreFocus();
      return;
    }

    if (event.key !== "Tab" || !overlayRef.current) return;
    const focusable = overlayRef.current.querySelectorAll(
      'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div
      className="mobile-menu-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={copy.nav.mobileLabel}
      onKeyDown={handleOverlayKeyDown}
      ref={overlayRef}
    >
      <div className="mobile-menu-header">
        <a
          className="wordmark mobile-menu-wordmark"
          href={`/${locale}#top`}
          aria-label={copy.brand}
          onClick={(event) => {
            const handled = onNavigate(event, "top");
            if (handled) restoreBackgroundScrollRef.current = false;
          }}
        >
          {copy.brand}
        </a>
        <button
          className="mobile-menu-close"
          type="button"
          aria-label={copy.nav.close}
          onClick={closeAndRestoreFocus}
          ref={closeButtonRef}
        >
          <X size={24} aria-hidden="true" />
        </button>
      </div>

      <nav
        className="mobile-nav"
        id="mobile-navigation"
        aria-label={copy.nav.mobileLabel}
      >
        {navItems.map(([target, label], index) => (
          <a
            href={`#${target}`}
            key={target}
            aria-current={activeSection === target ? "location" : undefined}
            onClick={(event) => {
              const handled = onNavigate(event, target);
              if (handled) restoreBackgroundScrollRef.current = false;
            }}
          >
            <span className="mobile-nav-index" aria-hidden="true">
              0{index + 2}
            </span>
            <span className="nav-link-label">
              {label}
              {target === "product" ? (
                <span className="product-new-badge">{copy.product.badge}</span>
              ) : null}
            </span>
          </a>
        ))}
      </nav>
    </div>,
    document.body,
  );
}

export function Header({
  activeSection,
  copy,
  locale,
  menuOpen,
  onLocaleChange,
  onMenuChange,
}) {
  const desktopFirstLinkRef = useRef(null);
  const menuButtonRef = useRef(null);
  const menuButtonScrollRef = useRef(null);
  const navItems = [
    ["work", copy.nav.work],
    ["product", copy.nav.product],
    ["experience", copy.nav.experience],
    ["about", copy.nav.about],
    ["contact", copy.nav.contact],
  ];

  const closeMenuAtDestination = (event, target) =>
    navigateToTarget(event, target, () => onMenuChange(false));

  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <a
            className="wordmark"
            href={`/${locale}#top`}
            aria-label={copy.brand}
            onClick={(event) =>
              navigateToTarget(event, "top", () => onMenuChange(false))
            }
          >
            {copy.brand}
          </a>

          <nav className="desktop-nav" aria-label={copy.nav.primaryLabel}>
            {navItems.map(([target, label], index) => (
              <a
                href={`#${target}`}
                key={target}
                aria-current={activeSection === target ? "location" : undefined}
                onClick={(event) => navigateToTarget(event, target)}
                ref={index === 0 ? desktopFirstLinkRef : undefined}
              >
                <span className="nav-link-label">
                  {label}
                  {target === "product" ? (
                    <span className="product-new-badge">
                      {copy.product.badge}
                    </span>
                  ) : null}
                </span>
              </a>
            ))}
          </nav>

          <div className="header-actions">
            <LocaleSwitch locale={locale} onChange={onLocaleChange} label={copy.language} />
            <button
              className="menu-button"
              type="button"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? "mobile-navigation" : undefined}
              aria-label={copy.nav.open}
              onClick={() => {
                menuButtonScrollRef.current = {
                  x: window.scrollX,
                  y: window.scrollY,
                };
                onMenuChange(true);
              }}
              ref={menuButtonRef}
            >
              <List size={25} aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <MobileNavigationMenu
        activeSection={activeSection}
        copy={copy}
        desktopFocusRef={desktopFirstLinkRef}
        isOpen={menuOpen}
        locale={locale}
        navItems={navItems}
        onMenuChange={onMenuChange}
        onNavigate={closeMenuAtDestination}
        openerRef={menuButtonRef}
        openerScrollRef={menuButtonScrollRef}
      />
    </>
  );
}
