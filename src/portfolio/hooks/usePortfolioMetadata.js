import { useEffect } from "react";
import { locales } from "../../content.js";
import { personSchemaForLocale } from "../../person-schema.js";

function upsertMeta(selector, attributes) {
  let element = document.querySelector(selector);
  if (!element) {
    element = document.createElement("meta");
    document.head.append(element);
  }
  Object.entries(attributes).forEach(([name, value]) => {
    element.setAttribute(name, value);
  });
}

export function usePortfolioMetadata(locale, copy) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = copy.meta.title;

    let description = document.querySelector('meta[name="description"]');
    if (!description) {
      description = document.createElement("meta");
      description.name = "description";
      document.head.append(description);
    }
    description.content = copy.meta.description;

    const canonicalUrl = `https://tranthiennhan.com/${locale}`;
    let canonical = document.querySelector('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.append(canonical);
    }
    canonical.href = canonicalUrl;

    locales.forEach((language) => {
      let alternate = document.querySelector(
        `link[rel="alternate"][hreflang="${language}"]`,
      );
      if (!alternate) {
        alternate = document.createElement("link");
        alternate.rel = "alternate";
        alternate.hreflang = language;
        document.head.append(alternate);
      }
      alternate.href = `https://tranthiennhan.com/${language}`;
    });

    let defaultAlternate = document.querySelector(
      'link[rel="alternate"][hreflang="x-default"]',
    );
    if (!defaultAlternate) {
      defaultAlternate = document.createElement("link");
      defaultAlternate.rel = "alternate";
      defaultAlternate.hreflang = "x-default";
      document.head.append(defaultAlternate);
    }
    defaultAlternate.href = "https://tranthiennhan.com/en";

    const openGraphLocale = locale === "vi" ? "vi_VN" : "en_US";
    const alternateOpenGraphLocale = locale === "vi" ? "en_US" : "vi_VN";
    upsertMeta('meta[property="og:type"]', {
      property: "og:type",
      content: "profile",
    });
    upsertMeta('meta[property="og:site_name"]', {
      property: "og:site_name",
      content: "Trần Thiện Nhân",
    });
    upsertMeta('meta[property="og:title"]', {
      property: "og:title",
      content: copy.meta.title,
    });
    upsertMeta('meta[property="og:description"]', {
      property: "og:description",
      content: copy.meta.description,
    });
    upsertMeta('meta[property="og:url"]', {
      property: "og:url",
      content: canonicalUrl,
    });
    upsertMeta('meta[property="og:locale"]', {
      property: "og:locale",
      content: openGraphLocale,
    });
    upsertMeta('meta[property="og:locale:alternate"]', {
      property: "og:locale:alternate",
      content: alternateOpenGraphLocale,
    });
    upsertMeta('meta[name="twitter:card"]', {
      name: "twitter:card",
      content: "summary",
    });
    upsertMeta('meta[name="twitter:title"]', {
      name: "twitter:title",
      content: copy.meta.title,
    });
    upsertMeta('meta[name="twitter:description"]', {
      name: "twitter:description",
      content: copy.meta.description,
    });
    upsertMeta('meta[name="robots"]', {
      name: "robots",
      content: "index, follow, max-image-preview:large",
    });

    let structuredData = document.querySelector(
      'script[data-portfolio-schema="person"]',
    );
    if (!structuredData) {
      structuredData = document.createElement("script");
      structuredData.type = "application/ld+json";
      structuredData.dataset.portfolioSchema = "person";
      document.head.append(structuredData);
    }
    structuredData.textContent = JSON.stringify(
      personSchemaForLocale(locale, copy),
    );
  }, [locale, copy]);
}
