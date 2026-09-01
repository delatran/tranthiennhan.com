import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { EnvelopeSimple } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { LinkedinLogo } from "@phosphor-icons/react/dist/csr/LinkedinLogo";
import { MapPin } from "@phosphor-icons/react/dist/csr/MapPin";
import { XLogo } from "@phosphor-icons/react/dist/csr/XLogo";
import { SectionRail } from "../components/SectionRail.jsx";

export function Contact({ copy }) {
  return (
    <section className="contact-section ruled-section" id="contact" aria-labelledby="contact-title">
      <div className="section-layout">
        <SectionRail index="06" label={copy.contact.eyebrow} />
        <div className="section-main contact-main" data-reveal="split">
          <div className="contact-copy">
            <h2 id="contact-title" tabIndex="-1">{copy.contact.title}</h2>
            <p>{copy.contact.body}</p>
            <span className="contact-location">
              <MapPin size={19} aria-hidden="true" />
              {copy.contact.location}
            </span>
          </div>
          <div className="contact-links">
            {copy.contact.links.map((link) => {
              const Icon = link.href.startsWith("mailto:")
                ? EnvelopeSimple
                : link.href.startsWith("https://x.com/")
                  ? XLogo
                  : LinkedinLogo;

              return (
                <a
                  className="contact-link"
                  href={link.href}
                  key={link.href}
                >
                  <span className="contact-link-icon">
                    <Icon size={22} aria-hidden="true" />
                  </span>
                  <span>
                    <small>{link.label}</small>
                    <strong>{link.value}</strong>
                  </span>
                  <ArrowUpRight size={20} aria-hidden="true" />
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
