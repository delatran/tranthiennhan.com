import { useEffect, useRef, useState } from "react";
import { Button, Dialog, ErrorNotice, Icon, Pill } from "./ui.jsx";
import { date, localized, periodLabel } from "./format.js";
import { AnalysisNotes, ClaimEvidence, ClaimKind } from "./AnalysisPanel.jsx";
import { ModelProcess } from "./ModelProcess.jsx";

export function ChatPanel({ open, onClose, state, controller, copy }) {
  const [question, setQuestion] = useState("");
  const end = useRef(null);
  const { dossier, locale, chat, busy, job, catalog } = state;
  const active = job && ["queued", "running", "pending", "started"].includes(job.status);
  const enabled = catalog?.runtime?.model?.enabled ?? catalog?.model?.enabled ?? false;
  useEffect(() => {
    setQuestion("");
  }, [dossier?.id, dossier?.revision]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [chat.length, open]);
  const send = async (event) => {
    event.preventDefault();
    if (!question.trim()) return;
    try {
      await controller.askFollowup({
        dossierId: dossier.id,
        revision: dossier.revision,
        question: question.trim(),
      });
      setQuestion("");
    } catch {
      /* The dialog retains the controller's actionable error. */
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      drawer
      title={copy.ask}
      closeLabel={copy.close}
      className="ns-chat-dialog"
    >
      {dossier ? (
        <div className="ns-chat-content">
          <div className="ns-chat-context">
            <p>{copy.context}</p>
            <strong>
              {dossier.company.ticker ?? dossier.company.id}{" "}
              <span>{periodLabel(dossier.period, locale)}</span>
            </strong>
            <Pill>
              {copy.saved} {date(dossier.updatedAt, locale, true)}
            </Pill>
          </div>
          <p className="ns-chat-context-hint">{copy.chatContext}</p>
          {dossier.chatHistoryTruncated ? (
            <p className="ns-chat-history-note">
              {locale === "vi"
                ? "Đang hiển thị phần hội thoại gần nhất của phiên bản này. Một số lượt trước đã được rút gọn khỏi ngữ cảnh model."
                : "Showing the recent conversation for this revision. Some earlier turns have been omitted from the model context."}
            </p>
          ) : null}
          <div
            className="ns-chat-transcript"
            role="log"
            aria-label={copy.ask}
            aria-live="polite"
            aria-relevant="additions text"
          >
            {chat.length ? (
              chat.map((message, index) => {
                const content = localized(
                  message.content ??
                    message.answer?.text ??
                    message.answer?.answer ??
                    message.answer?.summary ??
                    message.text,
                  locale,
                );
                const claims = message.answer?.claims ?? [];
                const nextAnswer =
                  message.role === "user" && chat[index + 1]?.role === "assistant"
                    ? chat[index + 1].answer
                    : null;
                const currentPrompt =
                  message.role === "user" &&
                  index === chat.length - 1 &&
                  active &&
                  job.kind === "chat";
                return (
                  <article
                    key={message.id ?? index}
                    className={`ns-chat-message ns-chat-message--${message.role ?? "assistant"}`}
                  >
                    <span>
                      {message.role === "user"
                        ? locale === "vi"
                          ? "Bạn"
                          : "You"
                        : "Nhân for Securities"}
                    </span>
                    {claims.length ? (
                      claims.map((claim, claimIndex) => (
                        <div className="ns-chat-claim" key={claim.id ?? claimIndex}>
                          <ClaimKind kind={claim.kind} copy={copy} locale={locale} />
                          <p>{localized(claim.text, locale)}</p>
                          <ClaimEvidence
                            claim={claim}
                            dossier={dossier}
                            locale={locale}
                            copy={copy}
                            controller={controller}
                          />
                        </div>
                      ))
                    ) : content ? (
                      <p>{content}</p>
                    ) : null}
                    <AnalysisNotes analysis={message.answer} locale={locale} />
                    {message.role === "user" ? (
                      <ModelProcess
                        job={currentPrompt ? job : null}
                        dossier={dossier}
                        analysis={nextAnswer}
                        kind="chat"
                        locale={locale}
                        onCancel={
                          currentPrompt
                            ? () => {
                                void controller.cancelAnalysis().catch(() => {});
                              }
                            : undefined
                        }
                        className="ns-model-process--chat"
                      />
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="ns-chat-empty">
                <Icon name="quote" size={32} />
                <h3>{copy.noChat}</h3>
                <div>
                  {copy.askExamples.map((example) => (
                    <button
                      type="button"
                      key={example}
                      onClick={() => setQuestion(example)}
                      disabled={!enabled}
                    >
                      {example}
                      <Icon name="arrow" size={15} />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
          <form className="ns-chat-form" onSubmit={send}>
            <ErrorNotice
              error={state.error}
              copy={copy}
              locale={locale}
              onClose={() => controller.dismissError()}
              onRetry={
                state.error?.retry === "job"
                  ? () => {
                      void controller.retryJob().catch(() => {});
                    }
                  : undefined
              }
            />
            <label className="sr-only" htmlFor="ns-followup-question">
              {copy.ask}
            </label>
            <textarea
              id="ns-followup-question"
              rows="3"
              maxLength={2000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder={copy.chatPlaceholder}
              disabled={!enabled || Boolean(busy) || Boolean(active)}
            />
            <div>
              {active && job.kind === "chat" ? (
                <Button
                  icon="stop"
                  disabled={Boolean(busy)}
                  onClick={() => {
                    void controller.cancelAnalysis().catch(() => {});
                  }}
                >
                  {copy.cancel}
                </Button>
              ) : (
                <Button
                  type="submit"
                  variant="primary"
                  icon="send"
                  disabled={!question.trim() || Boolean(busy) || Boolean(active) || !enabled}
                >
                  {copy.send}
                </Button>
              )}
            </div>
            {!enabled ? <p className="ns-fineprint">{copy.modelUnavailable}</p> : null}
          </form>
        </div>
      ) : null}
    </Dialog>
  );
}
