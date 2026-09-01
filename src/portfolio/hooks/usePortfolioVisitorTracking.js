import { useEffect } from "react";

export function usePortfolioVisitorTracking(locale) {
  useEffect(() => {
    if (navigator.globalPrivacyControl === true) return;

    let referrerHost = "";
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== window.location.origin) {
        referrerHost = referrer.hostname;
      }
    } catch {
      // Direct visits and privacy-restricted referrers intentionally stay empty.
    }

    const campaign = new URLSearchParams(window.location.search);
    const body = JSON.stringify({
      campaignMedium: campaign.get("utm_medium") ?? "",
      campaignName: campaign.get("utm_campaign") ?? "",
      campaignSource: campaign.get("utm_source") ?? "",
      locale,
      path: `/${locale}`,
      referrerHost,
    });

    void fetch("/api/visit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      cache: "no-store",
      credentials: "omit",
      keepalive: true,
      referrerPolicy: "no-referrer",
    }).catch(() => {
      // Analytics must never block or alter the portfolio experience.
    });
  }, [locale]);
}
