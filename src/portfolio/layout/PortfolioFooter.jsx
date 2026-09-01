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
        <p className="footer-privacy">{copy.footer.privacy}</p>
        <p className="footer-credit">{copy.footer.credit}</p>
      </div>
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
