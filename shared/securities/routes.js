export const SECURITIES_PATH = "/securities";
export const SECURITIES_CANONICAL_URL = "https://tranthiennhan.com/securities";
export const SECURITIES_ARCHITECTURE_PATH = `${SECURITIES_PATH}/architecture`;
export const SECURITIES_ARCHITECTURE_URL = `${SECURITIES_CANONICAL_URL}/architecture`;

function localizedHref(path, locale) {
  return locale === "en" || locale === "vi" ? `${path}?lang=${locale}` : path;
}

export const securitiesHref = (locale) => localizedHref(SECURITIES_PATH, locale);
export const securitiesArchitectureHref = (locale) =>
  localizedHref(SECURITIES_ARCHITECTURE_PATH, locale);

const pages = [
  { path: SECURITIES_PATH, asset: "/securities", retainsDossier: true },
  { path: SECURITIES_ARCHITECTURE_PATH, asset: "/securities-architecture", retainsDossier: false },
];

export function resolveSecuritiesPage(url) {
  const page = pages.find(({ path, asset }) =>
    [path, `${path}/`, `${asset}.html`, `${asset}-vi`, `${asset}-vi.html`].includes(url.pathname),
  );
  if (!page) return null;
  const languages = url.searchParams.getAll("lang");
  const forceVietnamese = [`${page.asset}-vi`, `${page.asset}-vi.html`].includes(url.pathname);
  const locale = forceVietnamese
    ? "vi"
    : languages.length === 1 && ["vi", "en"].includes(languages[0])
      ? languages[0]
      : null;
  if (url.pathname === page.path) return { asset: `${page.asset}${locale === "vi" ? "-vi" : ""}` };

  const target = new URL(localizedHref(page.path, locale), url);
  if (page.retainsDossier) {
    const dossiers = url.searchParams.getAll("dossier"),
      revisions = url.searchParams.getAll("revision");
    if (dossiers.length === 1 && /^ds_[a-zA-Z0-9_-]{8,76}$/u.test(dossiers[0])) {
      target.searchParams.set("dossier", dossiers[0]);
      if (revisions.length === 1 && /^[1-9][0-9]{0,8}$/u.test(revisions[0]))
        target.searchParams.set("revision", revisions[0]);
    }
  }
  return { redirect: `${target.pathname}${target.search}` };
}
