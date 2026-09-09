import { useState } from "react";
import { Dialog, Icon } from "./ui.jsx";
import { localized, periodLabel } from "./format.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "pending", "started"]);
const COMPLETED_STATUSES = new Set(["completed", "complete", "succeeded", "ready"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled"]);
const FAILED_STATUSES = new Set(["failed", "error", "stale"]);

const stageCopy = {
  resolving_scope: {
    vi: "Đang xác định câu hỏi và phạm vi hồ sơ",
    en: "Resolving the question and dossier scope",
  },
  creating_dossier: { vi: "Đang chuẩn bị hồ sơ phân tích", en: "Preparing the analysis dossier" },
  starting_analysis: { vi: "Đang bắt đầu phân tích", en: "Starting the analysis" },
  queued: { vi: "Phân tích đang chờ xử lý", en: "The analysis is queued" },
  running: { vi: "Đang xử lý câu hỏi", en: "Processing the question" },
  reading_sources: {
    vi: "Đang đọc dữ liệu và tài liệu nguồn",
    en: "Reading data and source documents",
  },
  retrieving: { vi: "Đang đọc nguồn liên quan", en: "Reading relevant sources" },
  discovering: { vi: "Đang tìm tài liệu công bố", en: "Finding disclosure documents" },
  fetching: { vi: "Đang lấy nội dung nguồn", en: "Retrieving source content" },
  writing_report: {
    vi: "Đang tổng hợp báo cáo theo câu hỏi",
    en: "Drafting the report for the question",
  },
  analyzing: { vi: "Đang tổng hợp câu trả lời", en: "Drafting the answer" },
  checking_report: {
    vi: "Đang đối chiếu nhận định với bằng chứng",
    en: "Checking findings against the evidence",
  },
  validating: { vi: "Đang kiểm tra kết quả", en: "Validating the result" },
  saving: { vi: "Đang lưu kết quả", en: "Saving the result" },
};

const processCopy = {
  vi: {
    drawerTitle: "Quá trình xử lý",
    activeTitle: "Đang xử lý câu hỏi",
    completeTitle: "Đã xử lý câu hỏi",
    failedTitle: "Quá trình xử lý chưa hoàn tất",
    cancelledTitle: "Đã dừng quá trình xử lý",
    disclosure:
      "Đây là bản tóm tắt các bước hệ thống ghi nhận được, không phải suy nghĩ riêng tư hoặc chuỗi suy luận ẩn của mô hình.",
    open: "Mở chi tiết quá trình xử lý",
    close: "Đóng chi tiết quá trình xử lý",
    completed: "Đã hoàn tất quá trình xử lý",
    failed: "Quá trình xử lý chưa hoàn tất",
    cancelled: "Đã dừng quá trình xử lý",
    elapsed: "Thời gian",
    reads: "Lượt đọc nguồn",
    calls: "Lượt xử lý",
    model: "Model",
    noDuration: "Đã hoàn tất",
    lessThanSecond: "dưới 1 giây",
    wholeDocument: "Tìm trong toàn tài liệu",
    pages: "Trang",
    search: "Nội dung tìm",
    passages: "đoạn nguồn",
    currentRead: "Nguồn đang đọc",
    limited: "Phạm vi đọc còn giới hạn",
    checksPassed: "Các kiểm tra đã vượt qua",
    checksLimited: "Một số kiểm tra hoặc phạm vi bằng chứng còn giới hạn",
    checksFailed: "Có kiểm tra chưa vượt qua",
    revision: "Đã lưu vào phiên bản",
    preparedScope: "Đã gắn câu hỏi với đúng doanh nghiệp và kỳ báo cáo.",
    preparingScope: "Đang gắn câu hỏi với đúng doanh nghiệp và kỳ báo cáo.",
    readingEvidence: "Đọc các phần liên quan trong tài liệu gốc đã lưu.",
    drafting: "Tổng hợp nhận định từ dữ liệu và phần nguồn đã đọc.",
    checking: "Kiểm tra cấu trúc, số liệu, trích dẫn và tính nhất quán của kết quả.",
    savingResult: "Lưu kết quả đã kiểm tra vào hồ sơ nghiên cứu.",
    publicScope: "Xác định mã chứng khoán và phạm vi nguồn công khai.",
    publicDiscover: "Tìm tài liệu trong phạm vi website doanh nghiệp và sở giao dịch.",
    publicRead: "Đọc nội dung nguồn tìm được.",
    publicCheck: "Kiểm tra liên kết và đoạn trích trước khi hiển thị.",
    publicReturn: "Trả lại các nguồn đã đọc cùng giới hạn quan sát được.",
    chatContext: "Gắn câu hỏi tiếp theo với đúng hồ sơ và phiên bản hiện hành.",
    chatRead: "Đọc lại nguồn khi câu trả lời cần thêm bằng chứng.",
    chatDraft: "Tổng hợp câu trả lời theo ngữ cảnh hồ sơ.",
    chatCheck: "Đối chiếu nhận định và trích dẫn với nguồn hiện hành.",
    chatReturn: "Đưa câu trả lời đã kiểm tra vào cuộc trao đổi.",
    statusComplete: "Hoàn tất",
    statusActive: "Đang làm",
    statusUpcoming: "Tiếp theo",
    statusFailed: "Chưa hoàn tất",
  },
  en: {
    drawerTitle: "Processing details",
    activeTitle: "Processing the question",
    completeTitle: "Question processed",
    failedTitle: "Processing did not finish",
    cancelledTitle: "Processing stopped",
    disclosure:
      "This is a summary of system-observed steps, not the model's private thoughts or hidden chain of reasoning.",
    open: "Open processing details",
    close: "Close processing details",
    completed: "Processing complete",
    failed: "Processing did not finish",
    cancelled: "Processing stopped",
    elapsed: "Elapsed",
    reads: "Source reads",
    calls: "Processing calls",
    model: "Model",
    noDuration: "Completed",
    lessThanSecond: "under 1 second",
    wholeDocument: "Searched the full document",
    pages: "Pages",
    search: "Search topic",
    passages: "source passages",
    currentRead: "Source being read",
    limited: "Reading coverage remains limited",
    checksPassed: "Recorded checks passed",
    checksLimited: "Some checks or evidence coverage remain limited",
    checksFailed: "A recorded check did not pass",
    revision: "Saved in revision",
    preparedScope: "Bound the question to the correct company and reporting period.",
    preparingScope: "Binding the question to the correct company and reporting period.",
    readingEvidence: "Read relevant sections of the preserved source documents.",
    drafting: "Composed findings from the data and source passages that were read.",
    checking: "Checked structure, figures, citations and result consistency.",
    savingResult: "Saved the checked result to the research dossier.",
    publicScope: "Resolved the security and public-source scope.",
    publicDiscover: "Searched the company and exchange disclosure scope for documents.",
    publicRead: "Read content from the sources that were found.",
    publicCheck: "Checked links and excerpts before displaying them.",
    publicReturn: "Returned the read sources with their observed limitations.",
    chatContext: "Bound the follow-up to the current dossier and revision.",
    chatRead: "Read source material again when the answer needed more evidence.",
    chatDraft: "Composed an answer in the dossier context.",
    chatCheck: "Checked findings and citations against the current sources.",
    chatReturn: "Added the checked answer to the conversation.",
    statusComplete: "Complete",
    statusActive: "In progress",
    statusUpcoming: "Next",
    statusFailed: "Incomplete",
  },
};

const analysisSteps = (text) => [
  {
    id: "scope",
    title: { vi: "Chuẩn bị phạm vi", en: "Prepare the scope" },
    text: text.preparedScope,
  },
  { id: "read", title: { vi: "Đọc nguồn", en: "Read sources" }, text: text.readingEvidence },
  { id: "draft", title: { vi: "Tổng hợp báo cáo", en: "Draft the report" }, text: text.drafting },
  {
    id: "check",
    title: { vi: "Kiểm tra bằng chứng", en: "Check the evidence" },
    text: text.checking,
  },
  { id: "save", title: { vi: "Lưu kết quả", en: "Save the result" }, text: text.savingResult },
];

const chatSteps = (text) => [
  { id: "scope", title: { vi: "Đọc ngữ cảnh", en: "Read the context" }, text: text.chatContext },
  {
    id: "read",
    title: { vi: "Đọc nguồn liên quan", en: "Read relevant sources" },
    text: text.chatRead,
  },
  {
    id: "draft",
    title: { vi: "Tổng hợp câu trả lời", en: "Draft the answer" },
    text: text.chatDraft,
  },
  {
    id: "check",
    title: { vi: "Kiểm tra bằng chứng", en: "Check the evidence" },
    text: text.chatCheck,
  },
  { id: "save", title: { vi: "Trả câu trả lời", en: "Return the answer" }, text: text.chatReturn },
];

const publicSteps = (text) => [
  {
    id: "scope",
    title: { vi: "Xác định phạm vi", en: "Resolve the scope" },
    text: text.publicScope,
  },
  {
    id: "discover",
    title: { vi: "Tìm tài liệu", en: "Find documents" },
    text: text.publicDiscover,
  },
  { id: "read", title: { vi: "Đọc nguồn", en: "Read sources" }, text: text.publicRead },
  {
    id: "check",
    title: { vi: "Kiểm tra trích đoạn", en: "Check excerpts" },
    text: text.publicCheck,
  },
  { id: "save", title: { vi: "Trả kết quả", en: "Return results" }, text: text.publicReturn },
];

const stageIndex = {
  resolving_scope: 0,
  creating_dossier: 0,
  starting_analysis: 0,
  queued: 0,
  running: 0,
  retrieving: 1,
  reading_sources: 1,
  discovering: 1,
  fetching: 2,
  extracting: 2,
  ocr: 2,
  writing_report: 2,
  analyzing: 2,
  checking_report: 3,
  validating: 3,
  saving: 4,
};

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeCount(value, maximum = 10_000) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : null;
}

function timestamp(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function safeModel(value) {
  return typeof value === "string" && /^[a-zA-Z0-9_./:-]{1,120}$/u.test(value) ? value : null;
}

function elapsedMilliseconds(job, receipts) {
  const directStart = timestamp(job?.startedAt);
  const directEnd = timestamp(job?.completedAt);
  if (directStart !== null && directEnd !== null && directEnd >= directStart)
    return Math.min(directEnd - directStart, 86_400_000);
  const starts = receipts
    .map((receipt) => timestamp(receipt.startedAt))
    .filter((value) => value !== null);
  const ends = receipts
    .map((receipt) => timestamp(receipt.completedAt))
    .filter((value) => value !== null);
  if (!starts.length || !ends.length) return null;
  const duration = Math.max(...ends) - Math.min(...starts);
  return duration >= 0 && duration <= 86_400_000 ? duration : null;
}

export function formatProcessDuration(milliseconds, locale = "vi") {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "";
  const text = processCopy[locale] ?? processCopy.vi;
  if (milliseconds < 1000) return text.lessThanSecond;
  const seconds = Math.max(1, Math.round(milliseconds / 1000));
  if (seconds < 60) return locale === "vi" ? `${seconds} giây` : `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (!remainder) return locale === "vi" ? `${minutes} phút` : `${minutes} min`;
  return locale === "vi" ? `${minutes} phút ${remainder} giây` : `${minutes} min ${remainder} sec`;
}

function normalizeReceipts(job, analysis, useJobRecords) {
  const raw = useJobRecords
    ? job?.receipts
    : Array.isArray(analysis?.receipts)
      ? analysis.receipts
      : analysis?.receipt
        ? [analysis.receipt]
        : job?.receipts;
  if (!Array.isArray(raw)) return [];
  return raw.filter(plainObject).slice(0, 100);
}

function sourceName(source, locale) {
  return localized(source?.title, locale) || source?.id || "";
}

function normalizeResearchReads(analysis, dossier, kind, active, job, locale) {
  if (active) {
    const progress = plainObject(job?.progress) ? job.progress : null;
    if (!progress?.sourceId) return [];
    const source = dossier?.sources?.find((item) => item.id === progress.sourceId);
    return [
      {
        id: "current",
        source: sourceName(source, locale) || progress.sourceId,
        pages: Array.isArray(progress.pages)
          ? progress.pages.filter((page) => safeCount(page, 999))
          : [],
        query: "",
        passageCount: null,
        status: "active",
      },
    ];
  }
  if (kind === "public") {
    return (Array.isArray(analysis?.sources) ? analysis.sources : [])
      .filter(plainObject)
      .slice(0, 20)
      .map((source, index) => ({
        id: `public-${index}`,
        source: typeof source.title === "string" ? source.title.slice(0, 500) : "",
        pages: [],
        query: "",
        passageCount: null,
        status: ["read", "partial", "unavailable"].includes(source.readStatus)
          ? source.readStatus
          : "unknown",
      }));
  }
  const sources = new Map((dossier?.sources ?? []).map((source) => [source.id, source]));
  return (Array.isArray(analysis?.research?.steps) ? analysis.research.steps : [])
    .filter(plainObject)
    .slice(0, 100)
    .map((step, index) => ({
      id: typeof step.id === "string" ? step.id : `read-${index}`,
      source: sourceName(sources.get(step.sourceId), locale) || step.sourceId || "",
      pages: Array.isArray(step.pages)
        ? step.pages.filter((page) => safeCount(page, 999) !== null).slice(0, 12)
        : [],
      query: typeof step.query === "string" ? step.query.trim().slice(0, 500) : "",
      passageCount: Array.isArray(step.passageIds) ? step.passageIds.length : null,
      status: ["read", "partial", "unavailable", "failed"].includes(step.status)
        ? step.status
        : "unknown",
    }));
}

function validationStatus(analysis) {
  const statuses = [
    analysis?.validation?.deterministic?.status,
    analysis?.validation?.semantic?.status,
  ].filter((status) => typeof status === "string");
  if (statuses.some((status) => ["failed", "error", "rejected"].includes(status))) return "failed";
  if (statuses.some((status) => ["limited", "partial", "unavailable"].includes(status)))
    return "limited";
  if (statuses.length && statuses.every((status) => ["passed", "complete"].includes(status)))
    return "passed";
  return null;
}

function currentStage(job, researchStep) {
  if (researchStep && stageCopy[researchStep]) return researchStep;
  const candidates = [
    job?.progress?.stage,
    job?.progress?.phase,
    job?.stage,
    job?.phase,
    job?.status,
  ];
  return candidates.find((value) => stageCopy[value]) ?? "running";
}

export function buildModelProcess({
  job = null,
  researchStep = null,
  dossier = null,
  analysis: providedAnalysis = null,
  kind: providedKind = null,
  locale = "vi",
} = {}) {
  const text = processCopy[locale] ?? processCopy.vi;
  const kind = providedKind ?? job?.kind ?? "analysis";
  if (!["analysis", "chat", "public"].includes(kind)) return null;
  const active = Boolean(researchStep) || ACTIVE_STATUSES.has(job?.status);
  const cancelled = !active && CANCELLED_STATUSES.has(job?.status);
  const failed = !active && FAILED_STATUSES.has(job?.status);
  const storedAnalysis =
    providedAnalysis ?? dossier?.reportProjection?.analysis ?? dossier?.analysis ?? null;
  const analysis = active || cancelled || failed ? null : storedAnalysis;
  const receipts = normalizeReceipts(job, analysis, active || cancelled || failed);
  const reads = normalizeResearchReads(analysis, dossier, kind, active, job, locale);
  const hasRecordedResult =
    kind === "public"
      ? Boolean(analysis && Array.isArray(analysis.sources))
      : Boolean(analysis?.origin === "model" || receipts.length || reads.length);
  const completed = !active && (COMPLETED_STATUSES.has(job?.status) || hasRecordedResult);
  if (!active && !completed && !cancelled && !failed) return null;
  const stage = currentStage(job, researchStep);
  const index = completed ? 4 : (stageIndex[stage] ?? 0);
  const baseSteps =
    kind === "chat" ? chatSteps(text) : kind === "public" ? publicSteps(text) : analysisSteps(text);
  const steps = baseSteps.map((step, stepIndex) => ({
    ...step,
    text: kind === "analysis" && step.id === "scope" && active ? text.preparingScope : step.text,
    status: completed
      ? "complete"
      : failed || cancelled
        ? stepIndex < index
          ? "complete"
          : stepIndex === index
            ? "failed"
            : "upcoming"
        : stepIndex < index
          ? "complete"
          : stepIndex === index
            ? "active"
            : "upcoming",
  }));
  const progressReadCount = safeCount(job?.progress?.readCount, 100);
  const readCount = Math.max(progressReadCount ?? 0, reads.length);
  const duration = completed ? elapsedMilliseconds(job, receipts) : null;
  const formattedDuration = duration === null ? "" : formatProcessDuration(duration, locale);
  const resultStatus = kind === "public" ? analysis?.status : analysis?.research?.status;
  const model =
    safeModel(analysis?.model) ??
    receipts.map((receipt) => safeModel(receipt.actualModel ?? receipt.model)).find(Boolean) ??
    null;
  const validation = validationStatus(analysis);
  const scope = dossier
    ? [dossier.company?.ticker ?? dossier.company?.id, periodLabel(dossier.period, locale)].filter(
        Boolean,
      )
    : [];
  const summary = active
    ? localized(stageCopy[stage] ?? stageCopy.running, locale)
    : cancelled
      ? text.cancelled
      : failed
        ? text.failed
        : formattedDuration
          ? locale === "vi"
            ? `Đã xử lý trong ${formattedDuration}`
            : `Processed in ${formattedDuration}`
          : text.completed;
  return {
    active,
    completed,
    cancelled,
    failed,
    kind,
    stage,
    summary,
    title: active
      ? text.activeTitle
      : cancelled
        ? text.cancelledTitle
        : failed
          ? text.failedTitle
          : text.completeTitle,
    steps,
    reads,
    readCount,
    receiptCount: receipts.length,
    duration,
    formattedDuration,
    model,
    validation,
    limited: ["limited", "partial", "unavailable"].includes(resultStatus),
    scope,
  };
}

function StepState({ status, text }) {
  return (
    <span className="ns-process-step-state">
      {status === "complete" ? <Icon name="check" size={13} /> : null}
      {status === "active" ? <span className="ns-process-pulse" aria-hidden="true" /> : null}
      {status === "failed" ? <Icon name="warning" size={13} /> : null}
      {text}
    </span>
  );
}

function ReadDetails({ trace, locale, text }) {
  if (!trace.reads.length) return null;
  return (
    <ol className="ns-process-reads">
      {trace.reads.map((read) => (
        <li key={read.id} data-status={read.status}>
          <strong>{read.source || text.currentRead}</strong>
          {read.query ? (
            <span>
              {text.search}: {read.query}
            </span>
          ) : null}
          <span>
            {read.pages.length ? `${text.pages}: ${read.pages.join(", ")}` : text.wholeDocument}
            {safeCount(read.passageCount, 1000) !== null
              ? ` · ${read.passageCount} ${text.passages}`
              : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ModelProcess({
  job = null,
  researchStep = null,
  dossier = null,
  analysis = null,
  kind = null,
  locale = "vi",
  onCancel,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const text = processCopy[locale] ?? processCopy.vi;
  const trace = buildModelProcess({ job, researchStep, dossier, analysis, kind, locale });
  if (!trace) return null;
  const statusText = trace.completed
    ? text.statusComplete
    : trace.failed || trace.cancelled
      ? text.statusFailed
      : text.statusActive;
  const validationText =
    trace.validation === "passed"
      ? text.checksPassed
      : trace.validation === "failed"
        ? text.checksFailed
        : trace.validation === "limited" || trace.limited
          ? text.checksLimited
          : "";
  return (
    <div
      className={`ns-model-process ${className}`.trim()}
      data-status={trace.active ? "active" : "done"}
    >
      <div className="ns-process-compact">
        <button
          type="button"
          className="ns-process-trigger"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${trace.summary}. ${text.open}`}
        >
          {trace.active ? (
            <span className="ns-working-mark" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <span className="ns-process-complete-mark" aria-hidden="true">
              <Icon name={trace.failed || trace.cancelled ? "warning" : "check"} size={14} />
            </span>
          )}
          <span aria-live="polite">{trace.summary}</span>
          <Icon name="arrow" size={14} />
        </button>
        {trace.active && onCancel ? (
          <button type="button" className="ns-process-cancel" onClick={onCancel}>
            {locale === "vi" ? "Dừng" : "Stop"}
          </button>
        ) : null}
      </div>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        drawer
        title={text.drawerTitle}
        closeLabel={text.close}
        className="ns-process-dialog"
      >
        <div className="ns-process-drawer">
          <header className="ns-process-overview">
            <span className="ns-process-overview-mark" data-active={trace.active || undefined}>
              {trace.active ? (
                <span className="ns-working-mark" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <Icon name={trace.failed || trace.cancelled ? "warning" : "check"} size={18} />
              )}
            </span>
            <div>
              <p className="ns-eyebrow">{statusText}</p>
              <h2>{trace.title}</h2>
              {trace.scope.length ? <p>{trace.scope.join(" · ")}</p> : null}
            </div>
          </header>
          <p className="ns-process-disclosure">
            <Icon name="shield" size={16} />
            <span>{text.disclosure}</span>
          </p>
          {trace.formattedDuration || trace.readCount || trace.receiptCount ? (
            <dl className="ns-process-stats">
              {trace.formattedDuration ? (
                <div>
                  <dt>{text.elapsed}</dt>
                  <dd>{trace.formattedDuration}</dd>
                </div>
              ) : null}
              {trace.readCount ? (
                <div>
                  <dt>{text.reads}</dt>
                  <dd>{trace.readCount}</dd>
                </div>
              ) : null}
              {trace.receiptCount ? (
                <div>
                  <dt>{text.calls}</dt>
                  <dd>{trace.receiptCount}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <ol className="ns-process-timeline">
            {trace.steps.map((step) => (
              <li key={step.id} data-status={step.status}>
                <span className="ns-process-node" aria-hidden="true">
                  {step.status === "complete" ? <Icon name="check" size={13} /> : null}
                  {step.status === "failed" ? <Icon name="warning" size={13} /> : null}
                </span>
                <div>
                  <div className="ns-process-step-heading">
                    <h3>{localized(step.title, locale)}</h3>
                    <StepState
                      status={step.status}
                      text={
                        step.status === "complete"
                          ? text.statusComplete
                          : step.status === "active"
                            ? text.statusActive
                            : step.status === "failed"
                              ? text.statusFailed
                              : text.statusUpcoming
                      }
                    />
                  </div>
                  <p>{step.text}</p>
                  {step.id === "read" ? (
                    <>
                      <ReadDetails trace={trace} locale={locale} text={text} />
                      {trace.limited ? <small>{text.limited}</small> : null}
                    </>
                  ) : null}
                  {step.id === "check" && validationText ? <small>{validationText}</small> : null}
                  {step.id === "save" && trace.completed && dossier?.revision ? (
                    <small>
                      {text.revision} {dossier.revision}
                    </small>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
          {trace.model ? (
            <p className="ns-process-model">
              <span>{text.model}</span>
              <code>{trace.model}</code>
            </p>
          ) : null}
          {trace.active && onCancel ? (
            <button type="button" className="ns-button ns-button--secondary" onClick={onCancel}>
              {locale === "vi" ? "Dừng xử lý" : "Stop processing"}
              <Icon name="stop" size={16} />
            </button>
          ) : null}
        </div>
      </Dialog>
    </div>
  );
}
