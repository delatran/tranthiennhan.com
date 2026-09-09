import { useId, useLayoutEffect, useRef } from "react";
import { ArrowUpRight } from "@phosphor-icons/react/dist/csr/ArrowUpRight";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { FileText } from "@phosphor-icons/react/dist/csr/FileText";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { WarningCircle } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { DownloadSimple } from "@phosphor-icons/react/dist/csr/DownloadSimple";
import { ArrowClockwise } from "@phosphor-icons/react/dist/csr/ArrowClockwise";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { MagnifyingGlass } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { List } from "@phosphor-icons/react/dist/csr/List";
import { Quotes } from "@phosphor-icons/react/dist/csr/Quotes";
import { PaperPlaneRight } from "@phosphor-icons/react/dist/csr/PaperPlaneRight";
import { Stop } from "@phosphor-icons/react/dist/csr/Stop";
import { PencilSimpleLine } from "@phosphor-icons/react/dist/csr/PencilSimpleLine";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { UsersThree } from "@phosphor-icons/react/dist/csr/UsersThree";
import { localized } from "./format.js";

const icons = {
  arrow: ArrowRight,
  northeast: ArrowUpRight,
  back: ArrowLeft,
  plus: Plus,
  close: X,
  file: FileText,
  check: Check,
  verified: CheckCircle,
  warning: WarningCircle,
  download: DownloadSimple,
  retry: ArrowClockwise,
  history: ClockCounterClockwise,
  search: MagnifyingGlass,
  menu: List,
  quote: Quotes,
  send: PaperPlaneRight,
  stop: Stop,
  edit: PencilSimpleLine,
  shield: ShieldCheck,
  book: BookOpen,
  trash: Trash,
  users: UsersThree,
};

export function Icon({ name, size = 18, ...props }) {
  const Component = icons[name] ?? FileText;
  return <Component size={size} aria-hidden="true" {...props} />;
}

export function Button({ children, icon, variant = "secondary", className = "", ...props }) {
  return (
    <button type="button" className={`ns-button ns-button--${variant} ${className}`} {...props}>
      {children}
      {icon ? <Icon name={icon} /> : null}
    </button>
  );
}

export function Pill({ children, tone = "neutral", dot = false }) {
  return (
    <span className={`ns-pill ns-pill--${tone}`}>
      {dot ? <span className="ns-status-dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

function keepDialogFocus(event) {
  if (event.key !== "Tab") return;
  const controls = [
    ...event.currentTarget.querySelectorAll(
      "a[href], button, input, select, textarea, summary, [tabindex]",
    ),
  ].filter(
    (element) => element.tabIndex >= 0 && !element.disabled && element.getClientRects().length > 0,
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  drawer = false,
  closeLabel,
  className = "",
}) {
  const ref = useRef(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`ns-dialog ${drawer ? "ns-dialog--drawer" : ""} ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={keepDialogFocus}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ns-dialog-inner">
        <header className="ns-dialog-header">
          <p className="ns-eyebrow" id={titleId}>
            {title}
          </p>
          <button
            type="button"
            className="ns-icon-button"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <Icon name="close" size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function ErrorNotice({ error, copy, locale, onRetry, onClose }) {
  if (!error) return null;
  const creditError =
    locale === "vi"
      ? "Nhà cung cấp từ chối yêu cầu vì tài khoản hết số dư. Cần bổ sung số dư để dùng AI; hồ sơ và công cụ kiểm chứng vẫn được giữ."
      : "The provider declined the request because the account has no remaining credit. Restore the balance to use AI; your dossier and verification tools are preserved.";
  const invalidModelResult =
    locale === "vi"
      ? "Phản hồi AI chưa đạt kiểm tra cấu trúc hoặc bằng chứng nên chưa được đưa vào hồ sơ. Thử lại hoặc tiếp tục kiểm chứng nguồn; dữ liệu đã lưu vẫn được giữ."
      : "The AI response did not pass structure or evidence checks and was not added to the dossier. Retry or continue reviewing sources; your saved data is preserved.";
  const messages = {
    source_missing: copy.sourceUnavailable,
    model_unbound_numeric_output: invalidModelResult,
    connection_failed: copy.connectionError,
    invalid_response: copy.connectionError,
    approval_blocked: copy.approvalBlocked,
    material_issues_unresolved: copy.approvalBlocked,
    approval_required: copy.approvalBlocked,
    source_unavailable: copy.sourceUnavailable,
    model_disabled: copy.modelUnavailable,
    model_not_configured: copy.modelUnavailable,
    openrouter_not_configured: copy.modelUnavailable,
    revision_conflict:
      locale === "vi"
        ? "Hồ sơ có phiên bản mới. Mở lại hồ sơ để tiếp tục với dữ liệu hiện hành."
        : "A newer revision exists. Reopen the dossier to continue with its current data.",
    job_in_progress:
      locale === "vi"
        ? "Nghiên cứu đang được xử lý. Hãy đợi hoàn tất hoặc dừng tác vụ trước khi xóa."
        : "This research is being processed. Wait for it to finish or stop the task before deleting.",
    dossier_not_found:
      locale === "vi"
        ? "Nghiên cứu này không còn trong lịch sử chung. Danh sách đã được cập nhật."
        : "This research is no longer in shared history. The list has been refreshed.",
    rate_limited:
      locale === "vi"
        ? "Có quá nhiều thay đổi trong thời gian ngắn. Hãy đợi một phút rồi thử lại."
        : "Too many changes were requested in a short time. Wait a minute and try again.",
    rate_limit_temporarily_unavailable:
      locale === "vi"
        ? "Tạm thời chưa thể kiểm tra giới hạn yêu cầu nên thay đổi chưa được thực hiện. Hãy thử lại sau."
        : "The request limit could not be checked, so the change was not made. Try again shortly.",
    no_supported_company:
      locale === "vi"
        ? "Chưa nhận ra doanh nghiệp trong phạm vi nguồn. Chọn một doanh nghiệp bên dưới."
        : "A supported company could not be identified. Choose one from the catalog below.",
    unsupported_company:
      locale === "vi"
        ? "Doanh nghiệp này chưa có trong phạm vi nguồn. Chọn doanh nghiệp được hỗ trợ hoặc chỉnh câu hỏi bên dưới."
        : "This company is outside the available source coverage. Choose a supported company or edit the question below.",
    ambiguous_company:
      locale === "vi"
        ? "Doanh nghiệp trong câu hỏi chưa khớp lựa chọn. Chỉnh câu hỏi hoặc chọn đúng doanh nghiệp bên dưới."
        : "The company in the question does not match the selection. Edit the question or choose the matching company below.",
    ambiguous_period:
      locale === "vi"
        ? "Kỳ trong câu hỏi chưa khớp lựa chọn. Chỉnh câu hỏi hoặc chọn đúng kỳ bên dưới."
        : "The period in the question does not match the selection. Edit the question or choose the matching period below.",
    report_unavailable: copy.readinessUnavailable,
    unsupported_period:
      locale === "vi"
        ? "Kỳ này chưa có đủ nguồn. Chọn một kỳ được hỗ trợ trong danh mục."
        : "This period has insufficient sources. Select a supported period from the catalog.",
    unsupported_comparison:
      locale === "vi"
        ? "Kỳ so sánh này chưa có nguồn phù hợp. Chọn một nền so sánh trong danh mục."
        : "This comparison period has no suitable source. Choose a supported comparison from the catalog.",
    issue_requires_evidence:
      locale === "vi"
        ? "Điểm này cần kiểm chứng số liệu từ nguồn. Mở số liệu liên quan để đối chiếu và sửa có căn cứ."
        : "This issue requires source verification. Open the related metric and record an evidenced correction.",
    context_mismatch:
      locale === "vi"
        ? "Ngữ cảnh đã thay đổi. Kiểm tra đúng hồ sơ và phiên bản trước khi tiếp tục."
        : "The context changed. Check the dossier and revision before continuing.",
    provider_rate_limited:
      locale === "vi"
        ? "Nhà cung cấp đang giới hạn lượt gọi. Đợi một lúc rồi thử lại, hồ sơ vẫn được giữ."
        : "The provider is rate limiting requests. Try again shortly; your dossier is preserved.",
    insufficient_credits: creditError,
    provider_credit_exhausted: creditError,
    provider_transport_error:
      locale === "vi"
        ? "Chưa kết nối được với nhà cung cấp AI. Kiểm tra kết nối rồi thử lại; hồ sơ đã lưu vẫn được giữ."
        : "The AI provider could not be reached. Check the connection and retry; your saved dossier is preserved.",
    provider_timeout:
      locale === "vi"
        ? "Nhà cung cấp AI chưa trả lời trong thời gian chờ. Thử lại; hồ sơ đã lưu vẫn được giữ."
        : "The AI provider did not respond within the time limit. Retry; your saved dossier is preserved.",
    provider_invalid_key:
      locale === "vi"
        ? "Dịch vụ chưa xác thực được với nhà cung cấp AI. Cần kiểm tra cấu hình dịch vụ trước khi thử lại; hồ sơ đã lưu vẫn được giữ."
        : "The service could not authenticate with the AI provider. Its configuration needs attention before retrying; your saved dossier is preserved.",
    model_invalid_output: invalidModelResult,
    model_invalid_json: invalidModelResult,
    model_output_truncated:
      locale === "vi"
        ? "Phản hồi AI bị ngắt trước khi hoàn tất nên chưa được đưa vào hồ sơ. Thử lại với câu hỏi hẹp hơn; dữ liệu đã lưu vẫn được giữ."
        : "The AI response ended before completion and was not added to the dossier. Retry with a narrower question; your saved data is preserved.",
  };
  return (
    <div className="ns-notice ns-notice--error" role="alert">
      <Icon name="warning" size={21} />
      <div>
        <p>{messages[error.code] ?? copy.generalError}</p>
        {error.details?.message ? (
          <p className="ns-fineprint">{localized(error.details.message, locale)}</p>
        ) : null}
        {error.details?.resumeAction === "startAnalysis" ? (
          <p className="ns-fineprint">
            {locale === "vi"
              ? `Dữ liệu đã được lưu ở phiên bản ${error.details.revision}. Thử lại sẽ tiếp tục phân tích trên đúng hồ sơ này.`
              : `Data is saved in revision ${error.details.revision}. Retrying will continue the analysis in this dossier.`}
          </p>
        ) : null}
        {onRetry ? (
          <button type="button" className="ns-text-button" onClick={onRetry}>
            {copy.retry} <Icon name="retry" size={14} />
          </button>
        ) : null}
      </div>
      <button type="button" className="ns-icon-button" onClick={onClose} aria-label={copy.close}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}

export function JobProgress({ job, busy, researchStep, copy, locale, onCancel }) {
  const active = job && ["queued", "running", "pending", "started"].includes(job.status);
  if (!active && !researchStep) return null;
  const stages = {
    resolving_scope: {
      vi: "Đang xác định phạm vi từ câu hỏi và lựa chọn",
      en: "Resolving the question and selected scope",
    },
    creating_dossier: {
      vi: "Đang lưu dữ liệu và nguồn của báo cáo",
      en: "Saving the report data and sources",
    },
    starting_analysis: { vi: "Đang gửi yêu cầu phân tích", en: "Submitting the analysis request" },
    queued: { vi: "Đã xếp hàng tác vụ", en: "Task queued" },
    running: {
      vi: "Đang xử lý dữ liệu và nguồn của hồ sơ",
      en: "Processing the dossier data and sources",
    },
    reading_sources: {
      vi: "Đang đọc tài liệu của doanh nghiệp",
      en: "Reading the company documents",
    },
    writing_report: {
      vi: "Đang viết báo cáo theo câu hỏi của bạn",
      en: "Writing the report for your question",
    },
    checking_report: {
      vi: "Đang đối chiếu nhận định với dữ liệu và nguồn",
      en: "Checking findings against the data and sources",
    },
    retrieving: { vi: "Đang đọc nguồn", en: "Reading sources" },
    analyzing: { vi: "Model đang phân tích", en: "The model is analyzing" },
    validating: { vi: "Đang kiểm tra kết quả", en: "Validating the result" },
    saving: { vi: "Đang lưu phiên bản", en: "Saving the revision" },
    discovering: {
      vi: "Đang tìm tài liệu trên website công bố chính thức",
      en: "Discovering documents on the official disclosure site",
    },
    fetching: { vi: "Đang lấy tài liệu gốc", en: "Fetching original documents" },
    extracting: {
      vi: "Đang trích xuất bảng và kiểm tra tài liệu",
      en: "Extracting tables and checking documents",
    },
    ocr: { vi: "Đang đọc tài liệu scan bằng OCR", en: "Reading scanned documents with OCR" },
    importing: { vi: "Đang lưu nguồn đã xử lý", en: "Saving processed sources" },
  };
  return (
    <div className="ns-job" role="status" aria-live="polite">
      <span className="ns-working-mark" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <div>
        <strong>
          {job?.kind === "chat"
            ? copy.ask
            : ["sources", "refresh"].includes(job?.kind)
              ? copy.refreshing
              : copy.analyzing}
        </strong>
        <p>
          {localized(
            stages[
              active
                ? (job.progress?.stage ??
                  job.progress?.phase ??
                  job.stage ??
                  job.phase ??
                  job.status)
                : researchStep
            ] ?? stages.running,
            locale,
          )}
        </p>
      </div>
      {active ? (
        <Button icon="stop" disabled={busy === "cancel"} onClick={onCancel}>
          {copy.cancel}
        </Button>
      ) : null}
    </div>
  );
}

export function SectionHeading({ id, number, title, text, children }) {
  return (
    <div className="ns-section-heading">
      <div>
        <p className="ns-eyebrow">{number}</p>
        <h2 id={id}>{title}</h2>
        {text ? <p>{text}</p> : null}
      </div>
      {children}
    </div>
  );
}
