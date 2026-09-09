import { useEffect } from "react";

export function useSecuritiesPageMetadata(locale, metadata, canonicalUrl) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = metadata.title;
    const values = {
      'meta[name="description"]': metadata.description,
      'meta[property="og:title"]': metadata.title,
      'meta[property="og:description"]': metadata.description,
      'meta[property="og:url"]': canonicalUrl,
      'meta[property="og:locale"]': metadata.ogLocale,
      'meta[property="og:locale:alternate"]': metadata.ogAlternate,
      'meta[name="twitter:title"]': metadata.title,
      'meta[name="twitter:description"]': metadata.description,
    };
    for (const [selector, content] of Object.entries(values))
      document.querySelector(selector)?.setAttribute("content", content);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonicalUrl);
  }, [locale, metadata, canonicalUrl]);
}
