export function SectionRail({ index, label }) {
  return (
    <aside className="section-rail" aria-hidden="true" data-reveal="rail">
      <span className="section-index">{index}</span>
      <span className="section-rail-line" />
      <span className="section-rail-label">{label}</span>
      <span className="section-dot" />
    </aside>
  );
}
