import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { xNhanHref } from "../../xnhan-locale.js";
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
            <div className="product-copy">
              <p className="product-name">
                <span>{copy.product.name}</span>
                <span className="product-new-badge">{copy.product.badge}</span>
              </p>
              <h2 id="product-title" tabIndex="-1">
                {copy.product.title}
              </h2>
              <p className="product-body">{copy.product.body}</p>
              <div className="product-actions">
                <a
                  className="product-action product-action--primary"
                  href={xNhanHref("/xnhan", locale)}
                >
                  <span>{copy.product.primary}</span>
                  <ArrowUpRight size={19} aria-hidden="true" />
                </a>
                <a
                  className="product-action product-action--secondary"
                  href={xNhanHref("/xnhan/about", locale)}
                >
                  <span>{copy.product.secondary}</span>
                  <ArrowUpRight size={19} aria-hidden="true" />
                </a>
              </div>
              <p className="product-independence">{copy.product.independence}</p>
            </div>

            <ol className="product-flow" aria-label={copy.product.flowLabel}>
              {copy.product.flow.map((step) => (
                <li key={step.index}>
                  <span className="product-flow-index" aria-hidden="true">
                    {step.index}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <p>{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <ul
            className="product-proofs"
            aria-label={copy.product.proofsLabel}
            data-reveal="stagger"
          >
            {copy.product.proofs.map((proof, index) => (
              <li key={proof.title}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <strong>{proof.title}</strong>
                <p>{proof.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
