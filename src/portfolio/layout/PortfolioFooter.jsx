import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { navigateToTarget } from "../../components/navigation.js";

export function PortfolioFooter({ copy, locale, visitorCount }) {
  const formattedCount =
    visitorCount === null
      ? copy.footer.visitorCountUnavailable
      : new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(
          visitorCount,
        );

  return (
    <footer className="site-footer">
      <div className="footer-copy">
        <p className="footer-statement">{copy.footer.statement}</p>
        <a
          className="footer-top-link"
          href="#top"
          onClick={(event) => navigateToTarget(event, "top")}
        >
          <span>{locale === "vi" ? "Về đầu trang" : "Back to top"}</span>
          <ArrowUp size={19} aria-hidden="true" />
        </a>
      </div>
      <p className="footer-signature" aria-hidden="true">{copy.brand}</p>
      <div className="footer-meta">
        <p
          className="footer-visits"
          title={copy.footer.visitorCountLabel}
        >
          <span>{copy.footer.visitorCountLabel}</span>
          <strong>{formattedCount}</strong>
        </p>
        <span>© {new Date().getFullYear()} {copy.footer.rights}</span>
      </div>
    </footer>
  );
}
