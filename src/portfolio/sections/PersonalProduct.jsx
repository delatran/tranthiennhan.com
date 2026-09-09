import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { xNhanHref } from "../../../shared/xnhan/routes.js";
import { securitiesHref } from "../../../shared/securities/routes.js";
import { SectionRail } from "../components/SectionRail.jsx";

export function PersonalProduct({ copy, locale }) {
  return (
    <section
      className="product-section ruled-section"
      id="product"
      aria-labelledby="product-title"
    >
      <div className="section-layout">
        <SectionRail index="03" label={copy.product.eyebrow} />
        <div className="section-main product-main">
          <div className="product-spotlight" data-reveal="feature">
            <div className="product-identity">
              <p className="product-name">
                {copy.product.name}
                <span className="product-new-badge">{copy.product.badge}</span>
              </p>
              <div className="product-actions">
                <a
                  className="product-action product-action--primary"
                  href={xNhanHref("/xnhan", locale)}
                >
                  <span>{copy.product.primary}</span>
                  <ArrowUpRight size={20} aria-hidden="true" />
                </a>
                <a
                  className="product-action product-action--secondary"
                  href={xNhanHref("/xnhan/about", locale)}
                >
                  <span>{copy.product.secondary}</span>
                  <ArrowUpRight size={18} aria-hidden="true" />
                </a>
              </div>
            </div>
            <div className="product-copy">
              <h2 id="product-title" tabIndex="-1">{copy.product.title}</h2>
              <p className="product-body">{copy.product.body}</p>
            </div>
          </div>
          <ol className="product-flow" aria-label={copy.product.flowLabel} data-reveal="stagger">
            {copy.product.flow.map((step) => (
              <li key={step.index}>
                <span className="product-flow-index" aria-hidden="true">{step.index}</span>
                <strong>{step.label}</strong>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
          <ul className="product-proofs" aria-label={copy.product.proofsLabel}>
            {copy.product.proofs.map((proof) => (
              <li key={proof.title}>
                <strong>{proof.title}</strong>
                <p>{proof.text}</p>
              </li>
            ))}
          </ul>
          <p className="product-independence">{copy.product.independence}</p>
          <article className="product-securities" aria-labelledby="securities-product-title" data-reveal="feature">
            <div>
              <p className="product-securities-eyebrow">{copy.securitiesProduct.eyebrow}</p>
              <h3 id="securities-product-title" translate="no">{copy.securitiesProduct.name}</h3>
              <a className="product-action product-action--primary" href={securitiesHref(locale)}>
                <span>{copy.securitiesProduct.primary}</span>
                <ArrowUpRight size={20} aria-hidden="true" />
              </a>
            </div>
            <div>
              <p className="product-securities-title">{copy.securitiesProduct.title}</p>
              <p className="product-body">{copy.securitiesProduct.body}</p>
              <p className="product-independence">{copy.securitiesProduct.boundary}</p>
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
