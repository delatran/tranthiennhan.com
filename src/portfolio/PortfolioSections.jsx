import { Approach } from "./sections/Approach.jsx";
import { Contact } from "./sections/Contact.jsx";
import { Experience } from "./sections/Experience.jsx";
import { Hero } from "./sections/Hero.jsx";
import { PersonalProduct } from "./sections/PersonalProduct.jsx";
import { SelectedWork } from "./sections/SelectedWork.jsx";

export function PortfolioSections({ copy, locale }) {
  return (
    <main id="main-content" tabIndex="-1">
      <Hero copy={copy} />
      <SelectedWork copy={copy} />
      <PersonalProduct copy={copy} locale={locale} />
      <Experience copy={copy} />
      <Approach copy={copy} />
      <Contact copy={copy} />
    </main>
  );
}
