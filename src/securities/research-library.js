import { companyLabel, periodLabel } from "./format.js";

const searchText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/giu, "d")
    .toLocaleLowerCase();

export function researchTitle(item) {
  return item.company?.ticker ?? item.ticker ?? item.companyId;
}

export function researchLibraryEntries(dossiers = [], query = "", locale = "vi") {
  const terms = searchText(query).split(/\s+/u).filter(Boolean);
  return dossiers
    .filter((item) =>
      terms.every((term) =>
        searchText(
          [
            researchTitle(item),
            item.query ?? item.question,
            companyLabel(item.company, locale),
            periodLabel(item.period, locale) || item.periodId,
          ].join(" "),
        ).includes(term),
      ),
    )
    .sort((left, right) =>
      String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")),
    );
}
