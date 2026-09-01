import { useEffect } from "react";

export function usePortfolioReveal(locale) {
  useEffect(() => {
    const nodes = document.querySelectorAll("[data-reveal]");
    if (
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
      !("IntersectionObserver" in window)
    ) {
      nodes.forEach((node) => node.classList.add("is-visible"));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -10%", threshold: 0.08 },
    );

    let observeFrame = window.requestAnimationFrame(() => {
      observeFrame = window.requestAnimationFrame(() => {
        nodes.forEach((node) => observer.observe(node));
      });
    });
    return () => {
      window.cancelAnimationFrame(observeFrame);
      observer.disconnect();
    };
  }, [locale]);
}
