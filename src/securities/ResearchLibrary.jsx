import { useId, useMemo, useState } from "react";
import { date, periodLabel } from "./format.js";
import { Button, Dialog, Icon } from "./ui.jsx";
import { researchLibraryEntries, researchTitle } from "./research-library.js";

export function ResearchLibrary({ state, controller, copy, onNavigate }) {
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const searchId = useId();
  const active =
    state.job && ["queued", "running", "pending", "started"].includes(state.job.status);
  const disabled = Boolean(state.busy) || Boolean(active) || !state.catalog;
  const reports = useMemo(
    () => researchLibraryEntries(state.dossiers, query, state.locale),
    [state.dossiers, state.locale, query],
  );
  const total = state.dossiers.length;
  const isCurrent = (item) => state.dossier?.id === item.id;
  const open = (item) => {
    void controller
      .openDossier({ dossierId: item.id })
      .then(onNavigate)
      .catch(() => {});
  };
  const begin = () => {
    controller.newResearch();
    onNavigate?.();
  };
  const remove = () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    void controller
      .deleteDossier({ dossierId: target.id, revision: target.revision })
      .then(() => {
        setPendingDelete(null);
        if (isCurrent(target)) onNavigate?.();
      })
      .catch(() => {});
  };
  const shared = state.catalog?.runtime?.sharedLibrary === true;

  return (
    <div className="ns-library">
      <Button
        className="ns-new-research"
        variant="primary"
        icon="plus"
        onClick={begin}
        disabled={disabled}
      >
        {copy.newDossier}
      </Button>
      <div className="ns-library-title">
        <span>{copy.library}</span>
        <span>{state.catalog ? total : ""}</span>
      </div>
      {state.catalog && shared ? (
        <p className="ns-library-scope">
          <Icon name="users" size={14} />
          <span>{copy.sharedLibraryNotice}</span>
        </p>
      ) : null}
      {total > 4 ? (
        <div className="ns-library-search">
          <Icon name="search" size={15} />
          <label className="sr-only" htmlFor={searchId}>
            {copy.searchReports}
          </label>
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={copy.searchReports}
            maxLength={160}
          />
        </div>
      ) : null}
      <nav className="ns-dossier-list" aria-label={copy.library}>
        {reports.length ? (
          reports.map((dossier) => (
            <div
              key={dossier.id}
              className={`ns-dossier-item ${isCurrent(dossier) ? "is-active" : ""}`}
            >
              <button
                type="button"
                className="ns-dossier-open"
                aria-current={isCurrent(dossier) ? "page" : undefined}
                onClick={() => open(dossier)}
                disabled={disabled}
              >
                <div>
                  <strong>{researchTitle(dossier)}</strong>
                  <small>{date(dossier.updatedAt, state.locale)}</small>
                </div>
                <p>
                  {dossier.query ||
                    dossier.question ||
                    `${copy.analysis} ${periodLabel(dossier.period, state.locale) || dossier.periodId}`}
                </p>
                <span>{periodLabel(dossier.period, state.locale) || dossier.periodId}</span>
              </button>
              <button
                type="button"
                className="ns-dossier-delete"
                aria-label={`${copy.deleteResearch}: ${researchTitle(dossier)}`}
                title={copy.deleteResearch}
                onClick={() => setPendingDelete(dossier)}
                disabled={
                  Boolean(state.busy) || (Boolean(active) && state.job?.dossierId === dossier.id)
                }
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          ))
        ) : state.catalog ? (
          <p className="ns-library-empty">{query ? copy.noMatchingReports : copy.noDossiers}</p>
        ) : null}
      </nav>
      <Dialog
        open={Boolean(pendingDelete)}
        onClose={() => setPendingDelete(null)}
        title={copy.deleteResearchTitle}
        closeLabel={copy.close}
        className="ns-delete-dialog"
      >
        <div className="ns-delete-confirmation">
          <p>{copy.deleteResearchDescription}</p>
          {pendingDelete ? (
            <p className="ns-delete-target">
              <strong>{researchTitle(pendingDelete)}</strong>
              <span>
                {pendingDelete.query ||
                  pendingDelete.question ||
                  periodLabel(pendingDelete.period, state.locale)}
              </span>
            </p>
          ) : null}
          <div className="ns-delete-actions">
            <Button
              onClick={() => setPendingDelete(null)}
              disabled={state.busy === "delete"}
              autoFocus
            >
              {copy.keepResearch}
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={remove}
              disabled={state.busy === "delete"}
            >
              {copy.deleteResearchConfirm}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
