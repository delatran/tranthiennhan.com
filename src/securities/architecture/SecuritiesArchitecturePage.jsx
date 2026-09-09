import { useRef, useState } from "react";
import { ArrowDown } from "@phosphor-icons/react/dist/csr/ArrowDown";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowUp } from "@phosphor-icons/react/dist/csr/ArrowUp";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { Browser } from "@phosphor-icons/react/dist/csr/Browser";
import { Calculator } from "@phosphor-icons/react/dist/csr/Calculator";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { ChatText } from "@phosphor-icons/react/dist/csr/ChatText";
import { Compass } from "@phosphor-icons/react/dist/csr/Compass";
import { Database } from "@phosphor-icons/react/dist/csr/Database";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { FolderOpen } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { Stack } from "@phosphor-icons/react/dist/csr/Stack";
import { LocaleFlag, localeName } from "../../components/LocaleFlag.jsx";
import { securitiesArchitectureContent } from "./content.js";
import "./architecture.css";

const ICONS = {
  browser: Browser,
  calculator: Calculator,
  chat: ChatText,
  compass: Compass,
  database: Database,
  file: FileText,
  folder: FolderOpen,
  search: MagnifyingGlass,
  server: Stack,
  shield: ShieldCheck,
  spark: Sparkle,
};
const SECTIONS = ["purpose", "journey", "system", "decisions"];

function ArchitectureIcon({ name, size = 24 }) {
  const Component = ICONS[name];
  return <Component size={size} weight="regular" aria-hidden="true" />;
}

function SectionHeading({ section }) {
  return (
    <header className="nsa-section-heading">
      <p className="nsa-section-label">
        <span>{section.index}</span>
        {section.label}
      </p>
      <div>
        <h2>{section.title}</h2>
        <p className="nsa-section-description">{section.description}</p>
      </div>
    </header>
  );
}

function Journey({ copy }) {
  const [selected, setSelected] = useState(0);
  const tabs = useRef([]);
  const step = copy.steps[selected];

  function selectAndFocus(index) {
    setSelected(index);
    tabs.current[index]?.focus({ preventScroll: true });
  }

  function handleKey(event, index) {
    const directions = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in directions) {
      event.preventDefault();
      selectAndFocus((index + directions[event.key] + copy.steps.length) % copy.steps.length);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      selectAndFocus(event.key === "Home" ? 0 : copy.steps.length - 1);
    }
  }

  return (
    <div className="nsa-journey">
      <div className="nsa-journey-tabs" role="tablist" aria-label={copy.selector}>
        {copy.steps.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`nsa-tab-${item.id}`}
            ref={(node) => {
              tabs.current[index] = node;
            }}
            aria-selected={selected === index}
            aria-controls={`nsa-panel-${item.id}`}
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => handleKey(event, index)}
          >
            <span className="nsa-tab-number">{String(index + 1).padStart(2, "0")}</span>
            <ArchitectureIcon name={item.icon} size={23} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>
      {copy.steps.map((item, index) => (
        <div
          key={item.id}
          id={`nsa-panel-${item.id}`}
          role="tabpanel"
          aria-labelledby={`nsa-tab-${item.id}`}
          tabIndex="0"
          hidden={selected !== index}
          className="nsa-journey-panel"
        >
          {selected === index ? (
            <>
              <div className="nsa-journey-copy">
                <p className="nsa-step-label">
                  <span>{String(index + 1).padStart(2, "0")}</span> /{" "}
                  {String(copy.steps.length).padStart(2, "0")}
                </p>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <div className="nsa-journey-result">
                  <span>{copy.resultLabel}</span>
                  <p>{item.result}</p>
                </div>
              </div>
              <div className="nsa-example">
                <p className="nsa-example-label">
                  <ArchitectureIcon name={item.icon} size={20} />
                  {copy.exampleLabel}
                </p>
                <h4>{item.example.heading}</h4>
                <dl>
                  {item.example.rows.map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <details className="nsa-journey-detail">
                <summary>
                  {copy.detailLabel}
                  <CaretDown size={18} aria-hidden="true" />
                </summary>
                <p>{item.detail}</p>
              </details>
            </>
          ) : null}
        </div>
      ))}
      <div className="nsa-journey-footer">
        <span>{step.label}</span>
        <button type="button" onClick={() => selectAndFocus((selected + 1) % copy.steps.length)}>
          {selected === copy.steps.length - 1 ? copy.restart : copy.next}
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

function SystemNode({ node, detailLabel }) {
  return (
    <article className={`nsa-system-node nsa-system-node--${node.id}`}>
      <div className="nsa-system-node-top">
        <ArchitectureIcon name={node.icon} size={26} />
        <p>{node.technology}</p>
      </div>
      <h3>{node.title}</h3>
      <p>{node.text}</p>
      <details>
        <summary>
          {detailLabel}
          <CaretDown size={16} aria-hidden="true" />
        </summary>
        <p>{node.detail}</p>
      </details>
    </article>
  );
}

function SystemMap({ copy }) {
  return (
    <div className="nsa-system-map" aria-label={copy.diagramLabel} role="group">
      <p className="nsa-map-label">{copy.requestPath}</p>
      <div className="nsa-system-row nsa-system-row--request">
        {copy.nodes.slice(0, 3).map((node, index) => (
          <div className="nsa-system-cell" key={node.id}>
            <SystemNode node={node} detailLabel={copy.technical} />
            {index < 2 ? (
              <ArrowRight className="nsa-system-connector" size={22} aria-hidden="true" />
            ) : null}
          </div>
        ))}
      </div>
      <div className="nsa-system-bridge">
        <ArrowDown size={21} aria-hidden="true" />
        <span>{copy.connection}</span>
      </div>
      <p className="nsa-map-label">{copy.supportPath}</p>
      <div className="nsa-system-row nsa-system-row--support">
        {copy.nodes.slice(3).map((node) => (
          <SystemNode node={node} detailLabel={copy.technical} key={node.id} />
        ))}
      </div>
    </div>
  );
}

export function SecuritiesArchitecturePage({ locale = "vi", onLocaleChange }) {
  const selectedLocale = locale === "en" ? "en" : "vi";
  const copy = securitiesArchitectureContent[selectedLocale];
  const productHref = `/securities?lang=${selectedLocale}`;

  function changeLocale(nextLocale) {
    if (nextLocale === selectedLocale) return;
    if (onLocaleChange) onLocaleChange(nextLocale);
    else window.location.assign(`/securities/architecture?lang=${nextLocale}`);
  }

  return (
    <div className="nsa-page" id="nsa-top">
      <a className="skip-link" href="#nsa-main">
        {copy.skip}
      </a>
      <header className="nsa-header">
        <div className="nsa-header-inner">
          <a className="nsa-brand" href={productHref} aria-label="Nhân for Securities">
            <ArrowLeft size={19} aria-hidden="true" />
            <span className="nsa-brand-mark" aria-hidden="true">
              n<span>.</span>
            </span>
            <span>Nhân for Securities</span>
          </a>
          <div className="nsa-header-actions">
            <a className="nsa-header-product" href={productHref}>
              {copy.product}
              <ArrowUpRight size={17} aria-hidden="true" />
            </a>
            <nav className="nsa-locales" aria-label={copy.language}>
              {["en", "vi"].map((item) => (
                <button
                  type="button"
                  key={item}
                  lang={item}
                  aria-label={localeName(item)}
                  title={localeName(item)}
                  aria-pressed={selectedLocale === item}
                  onClick={() => changeLocale(item)}
                >
                  <LocaleFlag locale={item} />
                </button>
              ))}
            </nav>
            <a className="nsa-owner-link" href={`/${selectedLocale}`}>
              {copy.portfolio}
            </a>
          </div>
        </div>
      </header>

      <main id="nsa-main" tabIndex="-1">
        <section className="nsa-hero" aria-labelledby="nsa-title">
          <div className="nsa-hero-copy">
            <p className="nsa-eyebrow">{copy.hero.eyebrow}</p>
            <h1 id="nsa-title">
              {copy.hero.title.map((line) => (
                <span key={line}>{line}</span>
              ))}
            </h1>
            <p className="nsa-hero-description">{copy.hero.description}</p>
            <a className="nsa-hero-link" href="#nsa-journey">
              {copy.hero.explore}
              <ArrowDown size={21} aria-hidden="true" />
            </a>
          </div>
          <aside className="nsa-hero-question">
            <p className="nsa-eyebrow">
              <ChatText size={20} aria-hidden="true" />
              {copy.hero.questionLabel}
            </p>
            <blockquote>{copy.hero.thought}</blockquote>
            <ol>
              {copy.hero.route.map((item, index) => (
                <li key={item}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{item}</p>
                  <ArrowDown size={16} aria-hidden="true" />
                </li>
              ))}
            </ol>
            <p className="nsa-hero-caption">{copy.hero.caption}</p>
          </aside>
        </section>

        <nav className="nsa-contents" aria-label={copy.contents}>
          {SECTIONS.map((key) => (
            <a key={key} href={`#nsa-${key}`}>
              <span>{copy[key].index}</span>
              <span>{copy[key].label}</span>
              <ArrowRight size={17} aria-hidden="true" />
            </a>
          ))}
        </nav>

        <section className="nsa-section nsa-purpose" id="nsa-purpose">
          <SectionHeading section={copy.purpose} />
          <div className="nsa-purpose-list">
            {copy.purpose.items.map((item) => (
              <article key={item.title}>
                <ArchitectureIcon name={item.icon} size={31} />
                <h3>{item.title}</h3>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="nsa-section nsa-journey-section" id="nsa-journey">
          <SectionHeading section={copy.journey} />
          <Journey copy={copy.journey} />
        </section>

        <section className="nsa-section nsa-system-section" id="nsa-system">
          <SectionHeading section={copy.system} />
          <SystemMap copy={copy.system} />
          <div className="nsa-coverage">
            <h3>{copy.system.coverageTitle}</h3>
            <div className="nsa-coverage-items">
              {copy.system.coverage.map((item) => (
                <article key={item.id}>
                  <p className="nsa-coverage-category">{item.category}</p>
                  <h4>{item.title}</h4>
                  <p className="nsa-coverage-description">{item.text}</p>
                  <details className="nsa-coverage-detail">
                    <summary aria-label={`${copy.system.coverageDetail}: ${item.title}`}>
                      {copy.system.coverageDetail}
                      <CaretDown size={16} aria-hidden="true" />
                    </summary>
                    <p>{item.detail}</p>
                  </details>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="nsa-section nsa-decisions" id="nsa-decisions">
          <SectionHeading section={copy.decisions} />
          <div className="nsa-decision-list">
            {copy.decisions.items.map((item, index) => (
              <details key={item.title}>
                <summary>
                  <span className="nsa-decision-index">{String(index + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <span>{item.text}</span>
                  </span>
                  <CaretDown size={21} aria-hidden="true" />
                </summary>
                <p>{item.detail}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="nsa-closing">
          <div>
            <p className="nsa-eyebrow">{copy.closing.eyebrow}</p>
            <h2>{copy.closing.title}</h2>
            <p className="nsa-closing-text">{copy.closing.text}</p>
            <p className="nsa-signature">{copy.closing.signature}</p>
          </div>
          <div className="nsa-closing-links">
            <a href={productHref}>
              {copy.product}
              <ArrowUpRight size={23} aria-hidden="true" />
            </a>
            <a href={`/${selectedLocale}`}>
              {copy.portfolio}
              <ArrowUpRight size={23} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>

      <footer className="nsa-footer">
        <p>{copy.footer}</p>
        <a href="#nsa-top">
          {copy.top}
          <ArrowUp size={18} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
