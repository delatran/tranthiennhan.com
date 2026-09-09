import { useEffect, useState } from "react";
import { Button, Dialog, Icon, Pill } from "./ui.jsx";
import {
  date,
  localized,
  localSourceUrl,
  metricValue,
  number,
  periodLabel,
  safeSourceUrl,
  scopeLabel,
  sourceLocation,
  unitLabel,
} from "./format.js";

export function SourcePage({ source, point, locale, copy }) {
  const [failed, setFailed] = useState(false);
  const url = localSourceUrl(source, point?.locator?.page);
  useEffect(() => setFailed(false), [url]);
  if (!url) return null;
  return (
    <details className="ns-source-page-preview" open>
      <summary>
        <Icon name="file" size={15} />
        {locale === "vi" ? "Đối chiếu trang gốc đã lưu" : "Check the preserved source page"}
      </summary>
      {failed ? (
        <p className="ns-fineprint">
          {locale === "vi"
            ? "Chưa mở được ảnh trang lưu local. Bạn vẫn có thể mở tài liệu gốc bên dưới."
            : "The saved page image is unavailable. You can still open the original document below."}
        </p>
      ) : (
        <figure className="ns-source-page">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${copy.openOriginal}: ${sourceLocation(point.locator, locale)}`}
          >
            <img
              src={url}
              alt={`${sourceLocation(point.locator, locale)} · ${localized(source.title, locale)}`}
              loading="lazy"
              onError={() => setFailed(true)}
            />
          </a>
          <figcaption>
            {sourceLocation(point.locator, locale)} ·{" "}
            {locale === "vi"
              ? "Bản nguồn khớp mã SHA-256 của hồ sơ"
              : "Source copy bound to the dossier SHA-256"}
          </figcaption>
        </figure>
      )}
    </details>
  );
}

export function EvidenceDrawer({ state, controller, copy }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState("");
  const selection = state.selectedSource;
  const { locale, dossier, busy } = state;
  const source = selection?.source;
  const metric = selection?.metric;
  const side = selection?.period ?? "current";
  const point = metric?.[side];
  const editable = Boolean(metric && dossier?.metrics?.some((item) => item.id === metric.id));
  const period = side === "current" ? dossier?.period : dossier?.comparisonPeriod;
  const jobActive =
    state.job && ["queued", "running", "pending", "started"].includes(state.job.status);
  useEffect(() => {
    setEditing(false);
    setValue(String(point?.value ?? ""));
    setReason("");
    setChecked(false);
    setError("");
  }, [selection]);

  const save = async (event) => {
    event.preventDefault();
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value.trim())) {
      setError(copy.invalidNumber);
      return;
    }
    if (reason.trim().length < 8) {
      setError(copy.reasonRequired);
      return;
    }
    setError("");
    try {
      await controller.applyCorrection({
        dossierId: dossier.id,
        revision: dossier.revision,
        changes: [
          {
            metricId: metric.id,
            periodId: period.id,
            value: value.trim(),
            reason: reason.trim(),
            sourceChecked: checked,
          },
        ],
      });
    } catch {
      setError(copy.generalError);
    }
  };

  return (
    <Dialog
      open={Boolean(selection)}
      drawer
      title={copy.evidence}
      closeLabel={copy.close}
      onClose={() => controller.closeEvidence()}
    >
      {source ? (
        <>
          <div className="ns-evidence-identity">
            <span className="ns-eyebrow">
              {dossier?.company?.ticker ?? dossier?.company?.id?.toUpperCase()} · {copy.evidence}
            </span>
            <h2>{metric ? localized(metric.label, locale) : localized(source.title, locale)}</h2>
            {point ? (
              <>
                <p>
                  {periodLabel(period, locale)} · {unitLabel(metric.unit, locale)}
                </p>
                <div className="ns-evidence-value">
                  <strong>{number(metricValue(metric, side), locale, 12)}</strong>
                  <Pill
                    tone={
                      ["verified", "user_verified"].includes(point.verification)
                        ? "green"
                        : "warning"
                    }
                  >
                    {point.corrected
                      ? copy.corrected
                      : ["verified", "user_verified"].includes(point.verification)
                        ? copy.verified
                        : copy.needsReview}
                  </Pill>
                </div>
              </>
            ) : null}
          </div>
          {metric ? (
            <div className="ns-evidence-section">
              <h3>{copy.definition}</h3>
              <p>{localized(metric.definition, locale)}</p>
            </div>
          ) : null}
          {point ? (
            <div className="ns-extraction-block">
              <p className="ns-eyebrow">{copy.extraction}</p>
              <code>{point.rawText ?? number(point.originalValue ?? point.value, locale, 12)}</code>
              <p>
                {unitLabel(point.originalUnit ?? point.unit ?? metric.unit, locale)} ·{" "}
                {sourceLocation(point.locator, locale)}
              </p>
              {point.corrected ? (
                <p className="ns-correction-original">
                  {copy.original}: {number(point.originalValue, locale, 12)}{" "}
                  {unitLabel(point.unit ?? metric.unit, locale)}
                </p>
              ) : null}
              {point.locator?.note ? <p>{localized(point.locator.note, locale)}</p> : null}
            </div>
          ) : null}
          {point ? <SourcePage source={source} point={point} locale={locale} copy={copy} /> : null}
          {metric ? (
            <div className="ns-evidence-section">
              <h3>
                {copy.formula} <Pill>{copy.calculated}</Pill>
              </h3>
              {[
                ["absoluteChange", copy.absoluteChange],
                ["relativeChangePct", copy.relativeChange],
              ].map(([key, title]) => {
                const calculation = metric.calculation?.[key];
                return (
                  <div className="ns-formula" key={key}>
                    <strong>{title}</strong>
                    <code>{calculation?.formula ?? copy.noFormula}</code>
                    <p>
                      {number(metricValue(metric, "current"), locale, 12)} ·{" "}
                      {number(metricValue(metric, "comparison"), locale, 12)}{" "}
                      <Icon name="arrow" size={13} />{" "}
                      <strong>
                        {calculation?.exact ?? "—"}
                        {key === "relativeChangePct" && calculation?.value !== null ? "%" : ""}
                      </strong>
                    </p>
                    {calculation?.status !== "ok" ? (
                      <p className="ns-fineprint">
                        {calculation?.status === "base_negative"
                          ? locale === "vi"
                            ? "Nền so sánh âm: không trình bày tỷ lệ tăng trưởng thông thường."
                            : "Negative comparison base: conventional growth is not reported."
                          : calculation?.status === "base_zero"
                            ? locale === "vi"
                              ? "Nền so sánh bằng 0: tỷ lệ thay đổi không xác định."
                              : "A zero comparison base makes percentage change undefined."
                            : copy.noFormula}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="ns-evidence-section">
            <h3>{copy.sourceDetails}</h3>
            <p className="ns-evidence-source-title">{localized(source.title, locale)}</p>
            <dl className="ns-evidence-metadata">
              <div>
                <dt>{copy.published}</dt>
                <dd>{source.publishedAt ? date(source.publishedAt, locale) : copy.unknownDate}</dd>
              </div>
              <div>
                <dt>{copy.fetched}</dt>
                <dd>{date(source.fetchedAt, locale, true)}</dd>
              </div>
              <div>
                <dt>{copy.accounting}</dt>
                <dd>{scopeLabel(source.scope, locale)}</dd>
              </div>
              <div>
                <dt>{copy.status}</dt>
                <dd>{scopeLabel(source.auditStatus, locale)}</dd>
              </div>
              <div>
                <dt>{copy.sourceVersion}</dt>
                <dd>{source.version}</dd>
              </div>
              {point?.locator ? (
                <div>
                  <dt>{copy.precision}</dt>
                  <dd>{sourceLocation(point.locator, locale)}</dd>
                </div>
              ) : null}
            </dl>
            {localSourceUrl(source) ? (
              <a
                className="ns-button ns-button--primary ns-evidence-source-link"
                href={`${localSourceUrl(source)}${point?.locator?.page ? `#page=${point.locator.page}&view=FitH` : ""}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                {locale === "vi" ? "Mở PDF đã dùng cho hồ sơ" : "Open the dossier source PDF"}
                <Icon name="northeast" />
              </a>
            ) : null}
            {safeSourceUrl(source, point?.locator) ? (
              <a
                className={`ns-button ns-button--${localSourceUrl(source) ? "text" : "primary"} ns-evidence-source-link`}
                href={safeSourceUrl(source, point?.locator)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {locale === "vi" ? "Mở trên website doanh nghiệp" : "Open on the issuer website"}
                <Icon name="northeast" />
              </a>
            ) : null}
            <details className="ns-technical-details">
              <summary>
                {locale === "vi"
                  ? "Định danh và quyền sử dụng tài liệu"
                  : "Document identity and usage rights"}
              </summary>
              <dl>
                <dt>SHA-256</dt>
                <dd>
                  <code>{source.hash ?? "—"}</code>
                </dd>
                <dt>{copy.parser}</dt>
                <dd>{source.parserVersion ?? "—"}</dd>
                <dt>{copy.sourceRights}</dt>
                <dd>
                  {localized(
                    source.rights?.note ?? source.rights?.storage ?? source.rights,
                    locale,
                  ) ||
                    (locale === "vi"
                      ? "Tham khảo tài liệu tại website nguồn."
                      : "Refer to the document on the source website.")}
                </dd>
              </dl>
              {point?.verificationReceipt ? (
                <dl>
                  <dt>
                    {locale === "vi" ? "Chỉ tiêu đối chiếu bổ sung" : "Supplemental verification"}
                  </dt>
                  <dd>{point.factId}</dd>
                  <dt>{locale === "vi" ? "Biên nhận" : "Receipt"}</dt>
                  <dd>{point.verificationReceipt.id}</dd>
                  <dt>SHA-256</dt>
                  <dd>
                    <code>{point.verificationReceipt.sha256}</code>
                  </dd>
                  <dt>{locale === "vi" ? "Mã đối chiếu trang gốc" : "Original render hash"}</dt>
                  <dd>
                    <code>{point.verificationReceipt.renderSha256}</code>
                  </dd>
                </dl>
              ) : null}
            </details>
          </div>
          {editable && !editing ? (
            <div className="ns-evidence-footer">
              <Button
                icon="edit"
                disabled={Boolean(busy) || Boolean(jobActive)}
                onClick={() => setEditing(true)}
              >
                {copy.editValue}
              </Button>
            </div>
          ) : null}
          {editable && editing ? (
            <form className="ns-correction-form" onSubmit={save}>
              <h3>{copy.correctionTitle}</h3>
              <p>{copy.correctionIntro}</p>
              <div className="ns-field">
                <label htmlFor="ns-correction-value">
                  {copy.newValue} · {unitLabel(point.unit ?? metric.unit, locale)}
                </label>
                <input
                  id="ns-correction-value"
                  inputMode="decimal"
                  type="text"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="ns-field">
                <label htmlFor="ns-correction-reason">{copy.reason}</label>
                <textarea
                  id="ns-correction-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows="3"
                  minLength={8}
                  maxLength={1000}
                  required
                  placeholder={copy.reasonPlaceholder}
                />
              </div>
              <label className="ns-checkbox">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                <span>
                  {locale === "vi"
                    ? "Tôi đã mở tài liệu gốc và đối chiếu đúng giá trị, kỳ và đơn vị tại vị trí được dẫn."
                    : "I opened the original document and verified the value, period and unit at the cited location."}
                </span>
              </label>
              {!checked ? (
                <p className="ns-fineprint">
                  {locale === "vi"
                    ? "Chưa đối chiếu nguồn: giá trị này sẽ được giữ ở phần chi tiết và loại khỏi kết luận cho tới khi đủ căn cứ."
                    : "Without source verification, this value remains in the audit and is excluded from conclusions until it is supported."}
                </p>
              ) : null}
              {error ? (
                <p className="ns-form-error" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" variant="primary" disabled={Boolean(busy)} icon="check">
                {busy === "revise" ? copy.working : copy.saveCorrection}
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
