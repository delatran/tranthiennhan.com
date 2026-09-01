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
    let resizeFrame = 0;
    const intersectingSections = new Set();

    const observeActivationLine = () => {
      observer?.disconnect();
      intersectingSections.clear();

      const headerHeight = document.querySelector(".site-header")?.offsetHeight ?? 0;
      const activationLine = Math.min(headerHeight + 32, window.innerHeight - 1);
      const bottomMargin = Math.max(0, window.innerHeight - activationLine - 1);

      observer = new window.IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) intersectingSections.add(entry.target.id);
            else intersectingSections.delete(entry.target.id);
          });

          let nextSection;
          for (
            let index = PORTFOLIO_SECTION_IDS.length - 1;
            index >= 0;
            index -= 1
          ) {
            const id = PORTFOLIO_SECTION_IDS[index];
            if (intersectingSections.has(id)) {
              nextSection = id;
              break;
            }
          }
          if (!nextSection) return;

          setActiveSection((current) =>
            current === nextSection ? current : nextSection,
          );
        },
        {
          rootMargin: `-${activationLine}px 0px -${bottomMargin}px 0px`,
          threshold: 0,
        },
      );

      sections.forEach((section) => observer.observe(section));
    };

    const scheduleObserverRefresh = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(observeActivationLine);
    };

    observeActivationLine();
    window.addEventListener("resize", scheduleObserverRefresh);
    return () => {
      window.cancelAnimationFrame(resizeFrame);
      window.removeEventListener("resize", scheduleObserverRefresh);
      observer?.disconnect();
    };
  }, [locale]);

  return activeSection;
}
