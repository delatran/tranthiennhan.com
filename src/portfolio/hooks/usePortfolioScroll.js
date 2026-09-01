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
    let animationFrame = 0;

    const updateActiveSection = () => {
      const headerHeight =
        document.querySelector(".site-header")?.getBoundingClientRect().height ?? 0;
      const activationLine = headerHeight + 32;
      let nextSection = "top";

      PORTFOLIO_SECTION_IDS.forEach((id) => {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= activationLine) {
          nextSection = id;
        }
      });

      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2
      ) {
        nextSection = "contact";
      }

      setActiveSection((current) =>
        current === nextSection ? current : nextSection,
      );
    };

    const scheduleUpdate = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(updateActiveSection);
    };

    scheduleUpdate();
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [locale]);

  return activeSection;
}
