const LOCALE_PRESENTATION = Object.freeze({
  en: Object.freeze({
    label: "English",
    src: "/assets/flag_of_the_United_Kingdom.svg",
    width: 50,
    height: 30,
  }),
  vi: Object.freeze({
    label: "Tiếng Việt",
    src: "/assets/flag_of_Vietnam.svg",
    width: 30,
    height: 20,
  }),
});

function presentationFor(locale) {
  const presentation = LOCALE_PRESENTATION[locale];
  if (!presentation) throw new TypeError(`Unsupported locale: ${locale}`);
  return presentation;
}

export function localeName(locale) {
  return presentationFor(locale).label;
}

export function LocaleFlag({ locale }) {
  const presentation = presentationFor(locale);

  return (
    <img
      className="locale-flag"
      src={presentation.src}
      alt=""
      aria-hidden="true"
      width={presentation.width}
      height={presentation.height}
      draggable={false}
    />
  );
}
