import assert from "node:assert/strict";
import { statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const inside = (file, directory) => file.startsWith(`${directory}/`);

function relativeImports(file, source) {
  // Match the repository's ESM declarations, literal dynamic imports, and CSS paths.
  const patterns = file.endsWith(".css")
    ? [/(?:@import\s+|url\(\s*)["']?(\.{1,2}\/[^"'\s)]+)["']?/g]
    : [
        /^\s*(?:import|export)\s+(?:[\w$*{},\s]+?\s+from\s*)?["']([^"']+)["']/gm,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
      ];
  return patterns.flatMap((pattern) => Array.from(source.matchAll(pattern), (match) => match[1]))
    .filter((specifier) => specifier.startsWith("."));
}

function forbiddenDependency(file, target) {
  for (const layer of ["src", "worker", "shared"]) {
    if (inside(file, `${layer}/securities`) && inside(target, `${layer}/xnhan`)) return true;
    if (inside(file, `${layer}/xnhan`) && inside(target, `${layer}/securities`)) return true;
  }
  if (inside(file, "src") && !inside(file, "src/securities") && inside(target, "src/securities")) return true;
  if (inside(file, "worker") && !inside(file, "worker/securities") && inside(target, "worker/securities")) {
    return file !== "worker/cloudflare.js" || target !== "worker/securities/api.js";
  }
  if (inside(file, "shared") && /^(?:src|worker)\//.test(target)) return true;
  if (inside(file, "src") && inside(target, "worker")) return true;
  if (inside(file, "worker") && inside(target, "src")) {
    // Existing portfolio grounding reads its content; X Nhân has no UI dependency.
    return target !== "src/content.js" || !["worker/ask.js", "worker/ask-facts.js"].includes(file);
  }
  if (inside(file, "src") && !inside(file, "src/xnhan") && inside(target, "src/xnhan")) return true;
  if (inside(file, "worker") && !inside(file, "worker/xnhan") && inside(target, "worker/xnhan")) {
    return file !== "worker/cloudflare.js" || target !== "worker/xnhan/search.js";
  }
  return false;
}

function violations(file, source, fileExists) {
  return relativeImports(file, source).flatMap((specifier) => {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.split(/[?#]/)[0]));
    const problems = [];
    if (!fileExists(target)) problems.push(`${file}: unresolved import ${specifier}`);
    if (forbiddenDependency(file, target)) problems.push(`${file}: forbidden import ${target}`);
    return problems;
  });
}

async function runtimeFiles(directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return runtimeFiles(file);
    return /\.(?:m?js|jsx|css)$/.test(entry.name) ? [file] : [];
  }));
  return files.flat();
}

test("dependency scanner reads multiline ESM, CSS, and literal dynamic imports", () => {
  assert.deepEqual(relativeImports("src/example.jsx", `
    import React from "react";
    import { first,
      second as renamed } from "../shared/values.js";
    import "./base.css";
    export { value } from "./value.js";
    export * from "./all.js";
    const lazy = import("./lazy.js");
    // import "./commented.js";
  `), ["../shared/values.js", "./base.css", "./value.js", "./all.js", "./lazy.js"]);
  assert.deepEqual(relativeImports("src/example.css", `
    @import "./theme.css";
    .icon { background: url(../assets/icon.svg); }
    @font-face { src: url("@fontsource/font.woff2"); }
  `), ["./theme.css", "../assets/icon.svg"]);
  assert.deepEqual(violations("src/xnhan/app.css", '@import "./missing.css";', () => false),
    ["src/xnhan/app.css: unresolved import ./missing.css"]);
});

test("module boundaries reject reverse dependencies and allow the explicit integration points", () => {
  const rejected = [
    ["shared/xnhan/routes.js", "../../src/xnhan/xnhan-locale.js"],
    ["shared/xnhan/contracts.js", "../../worker/xnhan/config.js"],
    ["src/xnhan/XNhanApp.jsx", "../../worker/xnhan/search.js"],
    ["src/portfolio/sections/PersonalProduct.jsx", "../../xnhan/xnhan-locale.js"],
    ["src/components/Header.jsx", "../xnhan/XNhanApp.jsx"],
    ["worker/xnhan/search.js", "../../src/content.js"],
    ["worker/ask.js", "../src/xnhan/xnhan-content.js"],
    ["worker/http.js", "./xnhan/search.js"],
    ["worker/cloudflare.js", "./xnhan/config.js"],
    ["src/securities/SecuritiesApp.jsx", "../xnhan/XNhanApp.jsx"],
    ["shared/securities/finance.js", "../xnhan/contracts.js"],
    ["worker/securities/api.js", "../xnhan/search.js"],
    ["worker/ask.js", "./securities/api.js"],
  ];
  const allowed = [
    ["shared/xnhan/routes.js", "./locales.js"],
    ["src/portfolio/sections/PersonalProduct.jsx", "../../../shared/xnhan/routes.js"],
    ["src/xnhan/XNhanApp.jsx", "../components/LocaleFlag.jsx"],
    ["worker/xnhan/search.js", "../../shared/xnhan/contracts.js"],
    ["worker/xnhan/search.js", "../http.js"],
    ["worker/cloudflare.js", "./xnhan/search.js"],
    ["worker/ask.js", "../src/content.js"],
    ["worker/ask-facts.js", "../src/content.js"],
    ["worker/cloudflare.js", "./securities/api.js"],
    ["src/portfolio/sections/PersonalProduct.jsx", "../../../shared/securities/routes.js"],
  ];
  for (const [file, dependency] of rejected) {
    assert.match(violations(file, `import { value } from "${dependency}";`, () => true).join("\n"),
      /forbidden import/, `${file} must reject ${dependency}`);
  }
  for (const [file, dependency] of allowed) {
    assert.deepEqual(violations(file, `import { value } from "${dependency}";`, () => true), [],
      `${file} must allow ${dependency}`);
  }
});

test("runtime imports resolve and preserve X Nhân module boundaries", async () => {
  const files = (await Promise.all(["src", "worker", "shared"].map(runtimeFiles))).flat();
  const problems = await Promise.all(files.map(async (file) => violations(
    file,
    await readFile(path.join(root, file), "utf8"),
    (target) => statSync(path.join(root, target), { throwIfNoEntry: false })?.isFile() ?? false,
  )));
  assert.deepEqual(problems.flat(), []);
});
