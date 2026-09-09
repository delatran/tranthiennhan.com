export const ASK_NHAN_MODAL_BACKGROUND_SELECTORS = Object.freeze([
  ".skip-link",
  ".site-header",
  "#main-content",
  ".site-footer",
]);

export function askNhanModalBackgroundElements(documentObject) {
  return ASK_NHAN_MODAL_BACKGROUND_SELECTORS.map((selector) =>
    documentObject.querySelector(selector),
  ).filter(Boolean);
}

export function setElementsTemporarilyInert(elements) {
  const previousAttributes = elements.map((element) => ({
    element,
    inert: element.getAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  }));

  elements.forEach((element) => {
    element.setAttribute("inert", "");
    element.setAttribute("aria-hidden", "true");
  });

  return () => {
    previousAttributes.forEach(({ element, inert, ariaHidden }) => {
      if (inert === null) {
        element.removeAttribute("inert");
      } else {
        element.setAttribute("inert", inert);
      }

      if (ariaHidden === null) {
        element.removeAttribute("aria-hidden");
      } else {
        element.setAttribute("aria-hidden", ariaHidden);
      }
    });
  };
}

export function focusAskDialogIfNeeded(panel, input, activeElement) {
  if (!input || panel?.contains(activeElement)) return false;

  input.focus({ preventScroll: true });
  return true;
}
