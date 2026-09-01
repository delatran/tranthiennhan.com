import { SectionRail } from "../components/SectionRail.jsx";

export function Approach({ copy }) {
  return (
    <section className="approach-section ruled-section" id="about" aria-labelledby="approach-title">
      <div className="section-layout">
        <SectionRail index="05" label={copy.about.eyebrow} />
        <div className="section-main approach-main">
          <div className="approach-intro" data-reveal>
            <h2 id="approach-title" tabIndex="-1">{copy.about.title}</h2>
            <p>{copy.about.body}</p>
          </div>
          <ol className="principles" data-reveal>
            {copy.about.principles.map((principle) => (
              <li key={principle.index}>
                <span>{principle.index}</span>
                <h3>{principle.title}</h3>
                <p>{principle.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
