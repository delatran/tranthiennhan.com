import assert from "node:assert/strict";
import test from "node:test";

const colors = {
  canvas: "#f5f7f0",
  inverse: "#1c3c1e",
  primary: "#0d190d",
  secondary: "#526151",
  inverseText: "#f7fbf7",
  borderStrong: "#728170",
  brand: "#225926",
  signal: "#6c9264",
  signalHover: "#7ba273",
  signalOnDark: "#99c68f",
  secondaryAccent: "#496b42",
  focusDark: "#99c68f",
};

function luminance(hex) {
  const rgb = hex
    .slice(1)
    .match(/.{2}/g)
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrast(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function assertContrast(label, foreground, background, minimum) {
  const ratio = contrast(foreground, background);
  assert.ok(
    ratio >= minimum,
    `${label} contrast ${ratio.toFixed(2)}:1 must be at least ${minimum}:1`,
  );
}

test("Warm Forest and Moss Signal pairs meet WCAG contrast thresholds", () => {
  assertContrast("primary text on canvas", colors.primary, colors.canvas, 4.5);
  assertContrast("secondary text on canvas", colors.secondary, colors.canvas, 4.5);
  assertContrast(
    "secondary accent text on canvas",
    colors.secondaryAccent,
    colors.canvas,
    4.5,
  );
  assertContrast("inverse text on forest", colors.inverseText, colors.inverse, 4.5);
  assertContrast("inverse text on brand", colors.inverseText, colors.brand, 4.5);
  assertContrast("primary text on signal", colors.primary, colors.signal, 4.5);
  assertContrast(
    "primary text on signal hover",
    colors.primary,
    colors.signalHover,
    4.5,
  );
  assertContrast("signal boundary on canvas", colors.signal, colors.canvas, 3);
  assertContrast(
    "small signal text on dark surfaces",
    colors.signalOnDark,
    colors.inverse,
    4.5,
  );
  assertContrast("light-canvas focus ring", colors.brand, colors.canvas, 3);
  assertContrast("dark-surface focus ring", colors.focusDark, colors.inverse, 3);
  assertContrast("strong border on canvas", colors.borderStrong, colors.canvas, 3);
});
