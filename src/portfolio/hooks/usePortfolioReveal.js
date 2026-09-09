import { useLayoutEffect } from "react";

export function usePortfolioReveal(locale) {
  useLayoutEffect(() => {
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

    nodes.forEach((node) => node.classList.add("reveal-pending"));

    let observeFrame = window.requestAnimationFrame(() => {
      observeFrame = window.requestAnimationFrame(() => {
        nodes.forEach((node) => observer.observe(node));
      });
    });
    return () => {
      window.cancelAnimationFrame(observeFrame);
      observer.disconnect();
      nodes.forEach((node) => node.classList.remove("reveal-pending"));
    };
  }, [locale]);
}
