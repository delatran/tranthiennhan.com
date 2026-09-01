import { useEffect, useState } from "react";
import { TARGET_FOCUS_IDS } from "../../components/navigation.js";

const PORTFOLIO_SECTION_IDS = [
  "top",
  "work",
  "product",
  "experience",
  "about",
  "contact",
];

export function selectActivePortfolioSection(
  intersectingSections,
  pageEndVisible = false,
) {
  if (pageEndVisible) return "contact";

  for (
    let index = PORTFOLIO_SECTION_IDS.length - 1;
    index >= 0;
    index -= 1
  ) {
    const id = PORTFOLIO_SECTION_IDS[index];
    if (intersectingSections.has(id)) return id;
  }

  return undefined;
}

export function usePortfolioHashAlignment(locale) {
  useEffect(() => {
    const encodedTarget = window.location.hash.slice(1);
    if (!encodedTarget) return undefined;

    let target;
    try {
      target = decodeURIComponent(encodedTarget);
    } catch {
      return undefined;
    }

    if (!(target in TARGET_FOCUS_IDS)) return undefined;

    let cancelled = false;
    let animationFrame = 0;
    const alignTarget = () => {
      if (cancelled) return;
      animationFrame = window.requestAnimationFrame(() => {
        if (!cancelled) {
          document
            .getElementById(target)
            ?.scrollIntoView({ block: "start", behavior: "instant" });
        }
      });
    };

    if (document.fonts?.ready) {
      document.fonts.ready.then(alignTarget);
    } else {
      alignTarget();
    }

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [locale]);
}

export function useActivePortfolioSection(locale) {
  const [activeSection, setActiveSection] = useState("top");

  useEffect(() => {
    const sections = PORTFOLIO_SECTION_IDS
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    if (sections.length === 0 || !("IntersectionObserver" in window)) {
      return undefined;
    }

    let observer;
    let pageEndObserver;
    let headerResizeObserver;
    let resizeFrame = 0;
    const fallbackHeaderHeight = () =>
      window.matchMedia("(max-width: 52.5rem)").matches ? 4.9 * 16 : 6 * 16;
    let headerHeight = fallbackHeaderHeight();
    const intersectingSections = new Set();
    let pageEndVisible = false;

    const commitActiveSection = () => {
      const nextSection = selectActivePortfolioSection(
        intersectingSections,
        pageEndVisible,
      );
      if (!nextSection) return;

      setActiveSection((current) =>
        current === nextSection ? current : nextSection,
      );
    };

    const observeActivationLine = () => {
      observer?.disconnect();
      intersectingSections.clear();

      const activationLine = Math.min(headerHeight + 32, window.innerHeight - 1);
      const bottomMargin = Math.max(0, window.innerHeight - activationLine - 1);

      observer = new window.IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) intersectingSections.add(entry.target.id);
            else intersectingSections.delete(entry.target.id);
          });
          commitActiveSection();
        },
        {
          rootMargin: `-${activationLine}px 0px -${bottomMargin}px 0px`,
          threshold: 0,
        },
      );

      sections.forEach((section) => observer.observe(section));
    };

    const scheduleObserverRefresh = () => {
      if (!headerResizeObserver) headerHeight = fallbackHeaderHeight();
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = window.requestAnimationFrame(observeActivationLine);
      });
    };

    const header = document.querySelector(".site-header");
    if (header && "ResizeObserver" in window) {
      headerResizeObserver = new window.ResizeObserver(([entry]) => {
        const borderBox = Array.isArray(entry.borderBoxSize)
          ? entry.borderBoxSize[0]
          : entry.borderBoxSize?.[0] ?? entry.borderBoxSize;
        const nextHeight = borderBox?.blockSize ?? entry.contentRect.height;
        if (
          !Number.isFinite(nextHeight) ||
          nextHeight <= 0 ||
          Math.abs(nextHeight - headerHeight) < 0.5
        ) {
          return;
        }

        headerHeight = nextHeight;
        scheduleObserverRefresh();
      });
      headerResizeObserver.observe(header);
    }

    const pageEnd = document.querySelector(".site-footer");
    if (pageEnd) {
      pageEndObserver = new window.IntersectionObserver(
        ([entry]) => {
          pageEndVisible = entry?.isIntersecting ?? false;
          commitActiveSection();
        },
        { threshold: 0.01 },
      );
      pageEndObserver.observe(pageEnd);
    }

    scheduleObserverRefresh();
    window.addEventListener("resize", scheduleObserverRefresh);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", scheduleObserverRefresh);
      headerResizeObserver?.disconnect();
      pageEndObserver?.disconnect();
      observer?.disconnect();
    };
  }, [locale]);

  return activeSection;
}
