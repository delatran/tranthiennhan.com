import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { navigateToTarget } from "../../components/navigation.js";
import { SectionRail } from "../components/SectionRail.jsx";

export function Hero({ copy }) {
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-grid">
        <SectionRail index="01" label={copy.hero.eyebrow} />

        <div className="hero-title-wrap">
          <div className="hero-meta">
            <p className="hero-role">{copy.hero.role}</p>
            <p className="hero-location">
              <MapPin size={16} aria-hidden="true" />
              {copy.hero.location}
            </p>
          </div>
          <h1
            className="hero-name"
            id="hero-title"
            aria-label="Trần Thiện Nhân"
            tabIndex="-1"
          >
            <span className="hero-name-line" aria-hidden="true">
              <span className="hero-name-word">Trần</span>
            </span>
            <span className="hero-name-line" aria-hidden="true">
              <span className="hero-name-word">Thiện</span>
            </span>
            <span className="hero-name-line" aria-hidden="true">
              <span className="hero-name-word">Nhân</span>
            </span>
          </h1>
        </div>

        <div className="hero-copy">
          <p className="hero-statement">{copy.hero.statement}</p>
          <div className="hero-actions">
            <a
              className="primary-action"
              href="#work"
              onClick={(event) => navigateToTarget(event, "work")}
            >
              <span>{copy.hero.primary}</span>
              <ArrowUpRight size={20} aria-hidden="true" />
            </a>
            <a
              className="secondary-action"
              href="#contact"
              onClick={(event) => navigateToTarget(event, "contact")}
            >
              {copy.hero.secondary}
            </a>
          </div>
        </div>
      </div>
      <ul
        className="hero-proof-strip"
        aria-label={copy.hero.proofLabel}
        data-reveal="stagger"
      >
        {copy.hero.proofs.map((proof, index) => (
          <li className="hero-proof" key={proof.label}>
            <a
              href={`#work-${copy.work.items[index].slug}`}
              onClick={(event) =>
                navigateToTarget(event, `work-${copy.work.items[index].slug}`)
              }
            >
              <span className="hero-proof-index" aria-hidden="true">
                0{index + 1}
                <ArrowUpRight size={18} />
              </span>
              <strong>{proof.value}</strong>
              <span>{proof.label}</span>
              <p>{proof.note}</p>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
