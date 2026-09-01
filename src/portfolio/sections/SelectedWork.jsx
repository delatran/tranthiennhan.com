import { navigateToTarget } from "../../components/navigation.js";
import { SectionRail } from "../components/SectionRail.jsx";
import { TagList } from "../components/TagList.jsx";

export function SelectedWork({ copy }) {
  return (
    <section
      className="work-section ruled-section"
      id="work"
      aria-labelledby="work-title"
    >
      <div className="section-layout">
        <SectionRail index="02" label={copy.work.eyebrow} />
        <div className="section-main work-main">
          <header className="section-heading" data-reveal>
            <h2 id="work-title" tabIndex="-1">
              {copy.work.title}
            </h2>
            <p>{copy.work.intro}</p>
          </header>

          <nav className="work-index" aria-label={copy.work.labels.index} data-reveal>
            <ol>
              {copy.work.items.map((item) => (
                <li key={item.slug}>
                  <a
                    href={`#work-${item.slug}`}
                    onClick={(event) =>
                      navigateToTarget(event, `work-${item.slug}`)
                    }
                  >
                    <span aria-hidden="true">{item.index}</span>
                    <strong>{item.title}</strong>
                    <small>{item.status}</small>
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="case-study-list">
            {copy.work.items.map((item) => (
              <article
                className="case-study"
                data-tone={item.tone}
                data-reveal
                key={item.index}
                id={`work-${item.slug}`}
                aria-labelledby={`case-title-${item.slug}`}
              >
                <header className="case-study-header">
                  <span className="case-index">{item.index}</span>
                  <span className="status-badge">{item.status}</span>
                  <span className="case-dates">
                    <span>{copy.work.labels.period}</span>
                    {item.dates}
                  </span>
                </header>

                <div className="case-study-intro">
                  <h3 id={`case-title-${item.slug}`} tabIndex="-1">
                    {item.title}
                  </h3>
                  <p>{item.summary}</p>
                </div>

                <ul
                  className="case-metrics"
                  aria-label={`${item.title} · ${copy.work.labels.metrics}`}
                  data-metric-count={item.metrics.length}
                >
                  {item.metrics.map((metric) => (
                    <li key={`${metric.value}-${metric.label}`}>
                      <strong>{metric.value}</strong>
                      <span>{metric.label}</span>
                    </li>
                  ))}
                </ul>

                <dl className="case-details">
                  <div>
                    <dt>{copy.work.labels.goal}</dt>
                    <dd>{item.goal}</dd>
                  </div>
                  <div>
                    <dt>{copy.work.labels.contribution}</dt>
                    <dd>{item.contribution}</dd>
                  </div>
                  <div>
                    <dt>{copy.work.labels.outcome}</dt>
                    <dd>{item.outcome}</dd>
                  </div>
                  <div className="case-boundary">
                    <dt>{copy.work.labels.scope}</dt>
                    <dd>{item.scope}</dd>
                  </div>
                </dl>

                <div className="case-stack">
                  <span>{copy.work.labels.stack}</span>
                  <TagList items={item.stack} label={copy.work.labels.stack} />
                </div>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
