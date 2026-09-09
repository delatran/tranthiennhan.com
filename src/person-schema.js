const canonicalOrigin = "https://tranthiennhan.com";

export function personSchemaForLocale(locale, localeContent) {
  if (
    (locale !== "en" && locale !== "vi") ||
    !localeContent?.hero?.location
  ) {
    throw new TypeError(`Missing Person schema configuration for locale ${locale}`);
  }

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: "Trần Thiện Nhân",
    url: `${canonicalOrigin}/${locale}`,
    jobTitle: locale === "vi" ? "Kỹ sư AI" : "AI Engineer",
    homeLocation: {
      "@type": "Place",
      name: localeContent.hero.location,
    },
    sameAs: [
      "https://www.linkedin.com/in/clementtranbe",
      "https://x.com/tran_thien_nhan",
    ],
    alumniOf: [
      {
        "@type": "CollegeOrUniversity",
        name: "Posts and Telecommunications Institute of Technology",
      },
    ],
    knowsAbout: [
      "Generative AI",
      "Multimodal Document AI",
      "Speech intelligence",
      "LLM evaluation",
      "Model security",
    ],
    inLanguage: locale,
  };
}
