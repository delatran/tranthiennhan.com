import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

const palette = {
  "surface-canvas": "#f5f7f0",
  "surface-subtle": "#e8efe6",
  "surface-inverse": "#1c3c1e",
  "text-primary": "#0d190d",
  "text-secondary": "#526151",
  "text-inverse": "#f7fbf7",
  "text-disabled": "#758074",
  "border-strong": "#728170",
  "border-subtle": "#cfd9ce",
  "brand-primary": "#225926",
  "brand-hover": "#193c1b",
  "accent-signal": "#6c9264",
  "accent-signal-strong": "#557a4d",
  "accent-signal-hover": "#7ba273",
  "accent-signal-on-dark": "#99c68f",
  "accent-secondary": "#496b42",
  "focus-on-light": "#225926",
  "focus-on-dark": "#99c68f",
};

test("the Warm Forest and Moss Signal palette is defined through shared semantic tokens", async () => {
  const styles = await readFile(path.join(projectRoot, "src", "base.css"), "utf8");

  Object.entries(palette).forEach(([token, value]) => {
    assert.match(styles, new RegExp(`--${token}:\\s*${value}`, "i"));
  });

  assert.doesNotMatch(styles, /--(?:paper|ink|muted|rule|soft-rule|signal|blue):/);
  assert.doesNotMatch(
    styles,
    /#(?:b7f52a|91d718|cdff64|166d5a|d7ff57)\b/i,
    "retired lime and teal values must not return to the active theme",
  );
});

test("browser chrome and the active hero use the approved palette", async () => {
  const index = await readFile(path.join(projectRoot, "index.html"), "utf8");
  const app = (
    await Promise.all(
      [
        "App.jsx",
        path.join("components", "AskNhan.jsx"),
        path.join("portfolio", "sections", "Contact.jsx"),
        path.join("portfolio", "sections", "Hero.jsx"),
        path.join("portfolio", "sections", "SelectedWork.jsx"),
      ].map((relativePath) =>
        readFile(path.join(projectRoot, "src", relativePath), "utf8"),
      ),
    )
  ).join("\n");
  const content = await readFile(path.join(projectRoot, "src", "content.js"), "utf8");

  assert.match(index, /name="theme-color" content="#f5f7f0"/i);
  assert.doesNotMatch(
    content,
    /cobalt|chartreuse|young-leaf|river-green|xanh cobalt|xanh lá non|xanh sông/i,
  );

  assert.doesNotMatch(app, /kinetic-loop-willow|className="hero-art"|copy\.hero\.artAlt/u);
  assert.match(app, /aria-label="Trần Thiện Nhân"/u);

  assert.match(app, /function SelectedWork/u);
  assert.match(app, /id="work"/u);
  assert.match(app, /className="case-study"/u);
  assert.match(app, /copy\.work/u);
  assert.doesNotMatch(app, /id="projects"/u);
  assert.doesNotMatch(app, /(?:evidence-map|ask-nhan)-cover-willow\.png/u);
  assert.match(app, /className="contact-link"/u);
  assert.match(app, /className="chat-panel"/u);
  assert.match(app, /className="chat-launcher"/u);
});
