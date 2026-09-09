import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../fonts.css";
import "../base.css";
import { SecuritiesArchitecturePage } from "./architecture/SecuritiesArchitecturePage.jsx";
import { readInitialLocale, writeLocalePreference } from "./format.js";
import { useSecuritiesPageMetadata } from "./use-page-metadata.js";
import { securitiesArchitectureMetadata } from "../../shared/securities/metadata.js";
import { SECURITIES_ARCHITECTURE_URL } from "../../shared/securities/routes.js";

function ArchitectureEntry() {
  const [locale, setLocale] = useState(readInitialLocale);
  useSecuritiesPageMetadata(
    locale,
    securitiesArchitectureMetadata[locale],
    SECURITIES_ARCHITECTURE_URL,
  );
  useEffect(() => {
    const onPopState = () => setLocale(readInitialLocale());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  const changeLocale = (next) => {
    if (!["vi", "en"].includes(next) || next === locale) return;
    writeLocalePreference(next);
    setLocale(next);
  };
  return <SecuritiesArchitecturePage locale={locale} onLocaleChange={changeLocale} />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ArchitectureEntry />
  </React.StrictMode>,
);
