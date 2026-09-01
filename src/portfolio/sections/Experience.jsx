import { SectionRail } from "../components/SectionRail.jsx";
import { TagList } from "../components/TagList.jsx";

const ORGANIZATION_LOGOS = Object.freeze({
  kienlongbank: {
    src: "/assets/kienlongbank-symbol-6ddcb463.png",
    derivativeSrc: "/assets/kienlongbank-symbol-2x-07bba4e7.png",
    derivativeWidth: 96,
    sizes: "(max-width: 64rem) 2.4rem, 2.7rem",
    width: 1200,
    height: 1207,
    treatment: "symbol",
  },
  mercedesBenz: {
    src: "/assets/mercedes-benz-mark-1ac65e81.jpg",
    derivativeSrc: "/assets/mercedes-benz-mark-2x-7f72465a.png",
    derivativeWidth: 100,
    sizes: "(max-width: 64rem) 2.75rem, 3.05rem",
    width: 1756,
    height: 1756,
    treatment: "inverse",
  },
});

const PTIT_LOGO = Object.freeze({
  src: "/assets/ptit-mark-3ae2f7aa.png",
  derivativeSrc: "/assets/ptit-mark-2x-a6a58dca.png",
  derivativeWidth: 144,
  sizes: "4.33rem",
  width: 1200,
  height: 1525,
});

function BrandMark({ asset }) {
  return (
    <span className={`brand-mark brand-mark--${asset.treatment}`}>
      <img
        src={asset.src}
        srcSet={`${asset.derivativeSrc} ${asset.derivativeWidth}w, ${asset.src} ${asset.width}w`}
        sizes={asset.sizes}
        alt=""
        width={asset.width}
        height={asset.height}
        loading="lazy"
        decoding="async"
      />
    </span>
  );
}

export function Experience({ copy }) {
  return (
    <section
      className="experience-section ruled-section"
      id="experience"
      aria-labelledby="experience-title"
    >
      <div className="section-layout">
        <SectionRail index="04" label={copy.experience.eyebrow} />
        <div className="section-main experience-main">
          <header className="section-heading" data-reveal="heading">
            <h2 id="experience-title" tabIndex="-1">
              {copy.experience.title}
            </h2>
            <div>
              <p>{copy.experience.intro}</p>
            </div>
          </header>

          <div className="experience-grid">
            <ol className="experience-timeline">
              {copy.experience.roles.map((role) => {
                const logo = ORGANIZATION_LOGOS[role.organizationKey];

                return (
                  <li key={`${role.organizationKey}-${role.dates}`}>
                    <article className="role-card" data-reveal="card">
                      <div className="role-heading">
                        <BrandMark asset={logo} />
                        <div className="role-meta">
                          <span className="role-organization">{role.organization}</span>
                          <span className="role-organization-detail">
                            {role.organizationDetail}
                          </span>
                        </div>
                        <span className="role-dates">{role.dates}</span>
                      </div>
                      <h3>{role.role}</h3>
                      <p className="role-summary">{role.summary}</p>
                      <ul className="role-highlights">
                        {role.highlights.map((highlight) => (
                          <li key={highlight}>{highlight}</li>
                        ))}
                      </ul>
                      <TagList items={role.tags} label={copy.experience.skillsLabel} />
                    </article>
                  </li>
                );
              })}
            </ol>

            <div className="profile-column" data-reveal="card">
              <section className="profile-block education-block">
                <h3>{copy.experience.educationLabel}</h3>
                <div className="education-identity">
                  <div className="education-wordmark">
                    <img
                      src={PTIT_LOGO.src}
                      srcSet={`${PTIT_LOGO.derivativeSrc} ${PTIT_LOGO.derivativeWidth}w, ${PTIT_LOGO.src} ${PTIT_LOGO.width}w`}
                      sizes={PTIT_LOGO.sizes}
                      alt=""
                      width={PTIT_LOGO.width}
                      height={PTIT_LOGO.height}
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                  <p className="education-institution">
                    {copy.experience.educationInstitution}
                  </p>
                  <p className="education-campus">{copy.experience.educationCampus}</p>
                </div>
                <div className="education-degrees">
                  {copy.experience.education.map((item) => (
                    <article key={`${item.degree}-${item.dates}`}>
                      <h4>{item.degree}</h4>
                      <span>{item.dates}</span>
                    </article>
                  ))}
                </div>
              </section>

              <section className="profile-block">
                <h3>{copy.experience.credentialsLabel}</h3>
                <div className="profile-items">
                  {copy.experience.credentials.map((item) => (
                    <article key={item.title}>
                      <h4>{item.title}</h4>
                      <p>{item.detail}</p>
                    </article>
                  ))}
                </div>
              </section>

              <section className="profile-block">
                <h3>{copy.experience.languagesLabel}</h3>
                <div className="language-list">
                  {copy.experience.languages.map((item) => (
                    <p key={item.name}>
                      <strong>{item.name}</strong>
                      <span>{item.level}</span>
                    </p>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <section
            className="capability-map"
            aria-labelledby="capability-map-title"
            data-reveal="stagger"
          >
            <header>
              <p>{copy.experience.capabilitiesLabel}</p>
              <h3 id="capability-map-title">
                {copy.experience.capabilitiesTitle}
              </h3>
              <span>{copy.experience.capabilitiesIntro}</span>
            </header>
            <div className="capability-grid">
              {copy.experience.capabilities.map((capability, index) => (
                <article key={capability.title}>
                  <span aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <h4>{capability.title}</h4>
                  <p>{capability.summary}</p>
                  <TagList
                    items={capability.items}
                    label={`${copy.experience.capabilitiesLabel} · ${capability.title}`}
                  />
                </article>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
