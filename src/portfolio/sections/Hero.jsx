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

        <div className="hero-copy" data-reveal="hero-copy">
          <p className="hero-role">{copy.hero.role}</p>
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
          <p className="hero-location">
            <MapPin size={18} aria-hidden="true" />
            {copy.hero.location}
          </p>
        </div>
      </div>
      <ul
        className="hero-proof-strip"
        aria-label={copy.hero.proofLabel}
        data-reveal="stagger"
      >
        {copy.hero.proofs.map((proof) => (
          <li className="hero-proof" key={proof.label}>
            <strong>{proof.value}</strong>
            <span>{proof.label}</span>
            <p>{proof.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
