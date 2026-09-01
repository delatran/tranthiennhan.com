import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import {
  XNHAN_DEFAULT_LOCALE,
  XNHAN_LOCALES,
} from "./xnhan-content.js";
import { xnhanAboutContent } from "./xnhan-about-content.js";
import { useXNhanAboutWebMcp } from "./use-xnhan-about-webmcp.js";
import { LocaleFlag, localeName } from "./components/LocaleFlag.jsx";
import { XNhanLogo } from "./XNhanLogo.jsx";
import {
  readInitialXNhanLocale,
  replaceXNhanLocaleInUrl,
  writeStoredXNhanLocale,
  xNhanHref,
} from "./xnhan-locale.js";
import "./xnhan-about.css";

const XNHAN_ABOUT_CANONICAL_URL = "https://tranthiennhan.com/xnhan/about";
const UNMOUNTED_XNHAN_ABOUT_WEBMCP_BRIDGE = Object.freeze({ mounted: false });

function setMetaContent(selector, content) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("content", content);
}

function setLinkHref(selector, href) {
  const element = document.querySelector(selector);
  if (element) element.setAttribute("href", href);
}

function useAboutMetadata(locale, copy) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.meta.title;
    setLinkHref('link[rel="canonical"]', XNHAN_ABOUT_CANONICAL_URL);
    setMetaContent('meta[name="description"]', copy.meta.description);
    setMetaContent('meta[property="og:url"]', XNHAN_ABOUT_CANONICAL_URL);
    setMetaContent('meta[property="og:title"]', copy.meta.title);
    setMetaContent('meta[property="og:description"]', copy.meta.description);
    setMetaContent('meta[property="og:locale"]', locale === "vi" ? "vi_VN" : "en_US");
    setMetaContent(
      'meta[property="og:locale:alternate"]',
      locale === "vi" ? "en_US" : "vi_VN",
    );
    setMetaContent('meta[name="twitter:title"]', copy.meta.title);
    setMetaContent('meta[name="twitter:description"]', copy.meta.description);
  }, [copy, locale]);
}

function useAboutReveal() {
  useEffect(() => {
    const nodes = [...document.querySelectorAll("[data-about-reveal]")];
    if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
      typeof IntersectionObserver !== "function"
    ) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8%", threshold: 0.08 },
    );

    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, []);
}

function SectionHeading({ section }) {
  return (
    <header className="xnhan-about-section-heading" data-about-reveal>
      <div className="xnhan-about-section-label">
        <span>{section.index}</span>
        <p>{section.eyebrow}</p>
      </div>
      <h2>{section.title}</h2>
    </header>
  );
}

export function XNhanAboutApp() {
  const [locale, setLocale] = useState(readInitialXNhanLocale);
  const copy = useMemo(() => xnhanAboutContent[locale], [locale]);
  const webMcpBridgeRef = useRef(UNMOUNTED_XNHAN_ABOUT_WEBMCP_BRIDGE);

  useAboutMetadata(locale, copy);
  useAboutReveal();

  const changeLocale = useCallback(
    (nextLocale) => {
      if (!XNHAN_LOCALES.includes(nextLocale) || nextLocale === locale) return;
      writeStoredXNhanLocale(nextLocale);
      replaceXNhanLocaleInUrl(nextLocale);
      setLocale(nextLocale);
    },
    [locale],
  );

  useLayoutEffect(() => {
    webMcpBridgeRef.current = Object.freeze({
      mounted: true,
      locale,
      copy,
      changeLocale,
    });

    return () => {
      webMcpBridgeRef.current = UNMOUNTED_XNHAN_ABOUT_WEBMCP_BRIDGE;
    };
  }, [changeLocale, copy, locale]);
  useXNhanAboutWebMcp({ bridgeRef: webMcpBridgeRef });

  return (
    <div className="xnhan-about-app">
      <a className="skip-link xnhan-about-skip" href="#xnhan-about-main">
        {copy.skip}
      </a>

      <header className="xnhan-about-header">
        <div className="xnhan-about-header-inner">
          <a
            className="xnhan-about-back"
            href={xNhanHref("/xnhan", locale)}
            aria-label={copy.productLink}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            <XNhanLogo />
          </a>
          <div className="xnhan-about-header-actions">
            <a
              className="xnhan-about-product-link"
              href={xNhanHref("/xnhan", locale)}
            >
              {copy.productLink}
            </a>
            <nav className="xnhan-about-locale" aria-label={copy.language}>
              {XNHAN_LOCALES.map((item) => (
                <button
                  type="button"
                  key={item}
                  lang={item}
                  aria-label={localeName(item)}
                  aria-pressed={locale === item}
                  title={localeName(item)}
                  onClick={() => changeLocale(item)}
                >
                  <LocaleFlag locale={item} />
                </button>
              ))}
            </nav>
            <a className="xnhan-about-owner" href={`/${locale}`}>
              {copy.portfolioLink}
            </a>
          </div>
        </div>
      </header>

      <main id="xnhan-about-main" tabIndex="-1">
        <section className="xnhan-about-hero" aria-labelledby="xnhan-about-title">
          <div className="xnhan-about-hero-copy">
            <p className="xnhan-about-eyebrow">{copy.hero.eyebrow}</p>
            <h1 id="xnhan-about-title">
              {copy.hero.titleLines.map((line, index) => (
                <span className="xnhan-about-title-line" key={line}>
                  <span data-title-line={index}>{line}</span>
                </span>
              ))}
            </h1>
            <p className="xnhan-about-lede">{copy.hero.lede}</p>
          </div>

          <div className="xnhan-about-hero-aside" data-about-reveal>
            <div className="xnhan-about-signal" aria-hidden="true">
              {copy.hero.signal.map((label, index) => (
                <span key={label}>
                  <i />
                  <small>{String(index + 1).padStart(2, "0")}</small>
                  {label}
                </span>
              ))}
            </div>
            <blockquote>{copy.hero.thesis}</blockquote>
          </div>
        </section>

        <section
          className="xnhan-about-section xnhan-about-origin"
          id="xnhan-about-origin"
        >
          <SectionHeading section={copy.origin} />
          <div className="xnhan-about-prose" data-about-reveal>
            {copy.origin.paragraphs.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </section>

        <section
          className="xnhan-about-section xnhan-about-principles"
          id="xnhan-about-principles"
        >
          <SectionHeading section={copy.principles} />
          <p className="xnhan-about-section-intro" data-about-reveal>
            {copy.principles.intro}
          </p>
          <ol className="xnhan-about-principle-list" data-about-reveal>
            {copy.principles.items.map((item) => (
              <li key={item.index}>
                <span>{item.index}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="xnhan-about-section xnhan-about-how"
          id="xnhan-about-how"
        >
          <SectionHeading section={copy.how} />
          <p className="xnhan-about-section-intro" data-about-reveal>
            {copy.how.intro}
          </p>
          <ol className="xnhan-about-stage-list" data-about-reveal>
            {copy.how.stages.map((stage) => (
              <li key={stage.index}>
                <span>{stage.index}</span>
                <div>
                  <h3>{stage.title}</h3>
                  <p>{stage.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="xnhan-about-section xnhan-about-boundary"
          id="xnhan-about-boundary"
        >
          <SectionHeading section={copy.boundary} />
          <p className="xnhan-about-section-intro" data-about-reveal>
            {copy.boundary.intro}
          </p>
          <div
            className="xnhan-about-table-wrap"
            data-about-reveal
            role="region"
            aria-label={copy.boundary.tableLabel}
            tabIndex="0"
          >
            <table>
              <caption className="sr-only">{copy.boundary.tableLabel}</caption>
              <thead>
                <tr>
                  <th aria-hidden="true" />
                  <th scope="col">{copy.boundary.xnhanLabel}</th>
                  <th scope="col">{copy.boundary.apiLabel}</th>
                </tr>
              </thead>
              <tbody>
                {copy.boundary.rows.map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    <td>{row.xnhan}</td>
                    <td>{row.api}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="xnhan-about-boundary-note" data-about-reveal>
            {copy.boundary.conclusion}
          </p>
          <details className="xnhan-about-notes" data-about-reveal>
            <summary>{copy.notes.summary}</summary>
            <div>
              {copy.notes.paragraphs.map((paragraph) => (
                <p key={paragraph}>{paragraph}</p>
              ))}
            </div>
          </details>
        </section>

        <section className="xnhan-about-cta" aria-labelledby="xnhan-about-cta-title">
          <div data-about-reveal>
            <p>{copy.cta.eyebrow}</p>
            <h2 id="xnhan-about-cta-title">{copy.cta.title}</h2>
            <span>{copy.cta.body}</span>
          </div>
          <div className="xnhan-about-cta-actions" data-about-reveal>
            <a href={xNhanHref("/xnhan", locale)}>
              <span>{copy.cta.primary}</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </a>
            <a href={`/${locale}`}>
              <span>{copy.cta.secondary}</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="xnhan-about-footer">
        <p>{copy.footer.independence}</p>
      </footer>
    </div>
  );
}
