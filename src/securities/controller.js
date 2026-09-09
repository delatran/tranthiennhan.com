import { createSecuritiesClient, SecuritiesApiError } from "./api.js";
import { createRequestLedger } from "./request-ledger.js";
import { dossierMetrics, writeLocalePreference } from "./format.js";

const dossierFrom = (data) => data?.dossier ?? data;
const jobFrom = (data) => data?.job ?? data;
const activeStatuses = new Set(["queued", "running", "pending", "started"]);
const completedStatuses = new Set(["completed", "succeeded", "complete", "partial"]);

export function researchInput(query, defaults, edited = {}) {
  const text = query.trim();
  const nonempty = (selection) =>
    Object.fromEntries(
      ["companyId", "periodId", "comparisonPeriodId"]
        .filter((key) => selection[key])
        .map((key) => [key, selection[key]]),
    );
  return text
    ? { ...nonempty(edited), query: text, defaultScope: nonempty(defaults) }
    : nonempty(defaults);
}

export function createSecuritiesController({
  client = createSecuritiesClient(),
  locale = "en",
  ledger = createRequestLedger(),
} = {}) {
  let state = {
    locale,
    view: "start",
    catalog: null,
    scope: null,
    dossiers: [],
    dossier: null,
    job: null,
    busy: null,
    error: null,
    notice: null,
    selectedSource: null,
    approvalRequest: null,
    activeTab: "analysis",
    chat: [],
    renderVersion: 0,
    researchStep: null,
    researchDraft: null,
    researchResume: null,
  };
  const listeners = new Set();
  const renderWaiters = new Set();
  let renderedVersion = -1;
  let initializing;
  let operationId = 0;
  let pollTimer;
  let pollGeneration = 0;
  let lastChatQuestion = null;
  const mutate = (path, body, options) => ledger.execute(client, path, body, options);

  function update(delta) {
    state = { ...state, ...delta, renderVersion: state.renderVersion + 1 };
    for (const listener of listeners) listener();
  }

  function bind(input = {}) {
    const dossier = state.dossier;
    if (
      !dossier ||
      (input.dossierId && input.dossierId !== dossier.id) ||
      (input.revision !== undefined && Number(input.revision) !== Number(dossier.revision))
    ) {
      throw new SecuritiesApiError(
        "context_mismatch",
        "Open the exact dossier revision before this action.",
      );
    }
    return dossier;
  }

  function assertContextIdle() {
    if (state.job && activeStatuses.has(state.job.status))
      throw new SecuritiesApiError(
        "job_in_progress",
        "Cancel the active task before changing the dossier context.",
      );
  }

  function urlFor(dossier) {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.delete("comparison");
    url.searchParams.delete("preparation");
    if (dossier) {
      url.searchParams.set("dossier", dossier.id);
      url.searchParams.set("revision", String(dossier.revision));
    } else {
      url.searchParams.delete("dossier");
      url.searchParams.delete("revision");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function acceptDossier(data, extra = {}) {
    const dossier = dossierFrom(data);
    if (!dossier?.id || !Number.isInteger(Number(dossier.revision)))
      throw new SecuritiesApiError("invalid_dossier", "Invalid dossier response.");
    update({
      dossier,
      view: "dossier",
      scope: null,
      selectedSource: null,
      approvalRequest: null,
      chat: dossier.chat ?? dossier.conversation ?? [],
      ...extra,
    });
    urlFor(dossier);
    void refreshDossiers();
    return dossier;
  }

  async function run(name, work) {
    if (state.busy && state.busy !== "loading")
      throw new SecuritiesApiError("action_in_progress", "Another action is in progress.");
    const current = ++operationId;
    update({ busy: name, error: null, notice: null });
    try {
      return await work();
    } catch (error) {
      if (current === operationId) {
        if (error.name === "AbortError") update({ notice: "cancelled" });
        else
          update({
            error: {
              code: error.code ?? "request_failed",
              message: error.message,
              details: error.details,
            },
          });
      }
      throw error;
    } finally {
      if (current === operationId) update({ busy: null });
    }
  }

  async function refreshDossiers(options = {}) {
    try {
      const data = await client.request("/dossiers", options);
      update({ dossiers: Array.isArray(data) ? data : (data.dossiers ?? []) });
    } catch {
      /* The active dossier remains available when its library cannot refresh. */
    }
  }

  async function initialize({ force = false } = {}) {
    if (initializing && !force) return initializing;
    initializing = run("loading", async () => {
      const results = await Promise.allSettled([
        client.request("/catalog"),
        client.request("/dossiers"),
      ]);
      const [catalogResult, dossiersResult] = results;
      if (dossiersResult.status === "fulfilled")
        update({
          dossiers: Array.isArray(dossiersResult.value)
            ? dossiersResult.value
            : (dossiersResult.value.dossiers ?? []),
        });
      if (catalogResult.status === "rejected") throw catalogResult.reason;
      update({ catalog: catalogResult.value });
      if (dossiersResult.status === "rejected")
        update({ error: { code: dossiersResult.reason.code ?? "library_unavailable" } });
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        const id = params.get("dossier");
        if (id) {
          const revision = params.get("revision");
          const data = await client.request(
            `/dossiers/${encodeURIComponent(id)}${revision ? `?revision=${encodeURIComponent(revision)}` : ""}`,
          );
          const dossier = acceptDossier(data);
          if (dossier.activeJob)
            beginPolling(
              typeof dossier.activeJob === "string"
                ? {
                    id: dossier.activeJob,
                    status: "running",
                    dossierId: dossier.id,
                    revision: dossier.revision,
                  }
                : dossier.activeJob,
              dossier.activeJob.kind ?? "analysis",
            );
        } else {
          if (force) {
            stopPolling();
            update({
              view: "start",
              dossier: null,
              job: null,
              selectedSource: null,
              approvalRequest: null,
              chat: [],
            });
          }
          urlFor(null);
        }
      }
      return state;
    }).catch(() => state);
    return initializing;
  }

  function stopPolling() {
    pollGeneration += 1;
    clearTimeout(pollTimer);
  }

  function beginPolling(job, kind = "analysis") {
    stopPolling();
    const generation = pollGeneration;
    update({ job: { ...job, kind } });
    async function poll() {
      if (generation !== pollGeneration) return;
      try {
        const next = jobFrom(
          await client.request(
            `${kind === "sources" ? "/sources" : ""}/jobs/${encodeURIComponent(job.id)}`,
          ),
        );
        if (generation !== pollGeneration) return;
        if (kind === "chat" && completedStatuses.has(next.status)) {
          const dossier = dossierFrom(
            await client.request(
              `/dossiers/${encodeURIComponent(job.dossierId)}?revision=${encodeURIComponent(job.revision)}`,
            ),
          );
          if (generation !== pollGeneration) return;
          if (dossier?.id !== job.dossierId || Number(dossier.revision) !== Number(job.revision))
            throw new SecuritiesApiError("context_mismatch");
          update({
            dossier,
            chat: dossier.chat ?? dossier.conversation ?? [],
            job: { ...next, kind },
          });
          return;
        }
        update({ job: { ...next, kind } });
        if (activeStatuses.has(next.status)) {
          pollTimer = setTimeout(poll, 1000);
          return;
        }
        if (completedStatuses.has(next.status)) {
          const result = next.result ?? {};
          if (kind === "sources") {
            const catalog = await client.request("/catalog");
            if (generation === pollGeneration)
              update({
                catalog,
                notice: next.status === "partial" ? "sourcesPartial" : "sourcesUpdated",
              });
          } else if (result.dossier?.id || result.id)
            acceptDossier(result, { activeTab: kind === "refresh" ? "financials" : "analysis" });
          else if (state.dossier?.id) {
            const data = await client.request(`/dossiers/${encodeURIComponent(state.dossier.id)}`);
            if (generation === pollGeneration)
              acceptDossier(data, { activeTab: kind === "refresh" ? "financials" : "analysis" });
          }
        } else if (["cancelled", "canceled"].includes(next.status)) update({ notice: "cancelled" });
        else
          update({
            error: {
              code: next.error?.code ?? "analysis_failed",
              message: next.error?.message,
              retry: "job",
            },
          });
      } catch (error) {
        if (generation === pollGeneration)
          update({ error: { code: error.code ?? "job_status_unavailable", retry: "job" } });
      }
    }
    pollTimer = setTimeout(poll, 250);
  }

  const actions = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    snapshot: () => state,
    getState: () => state,
    getScope: () => state.scope,
    initialize,
    markRendered(version) {
      renderedVersion = Math.max(renderedVersion, version);
      for (const waiter of renderWaiters) if (waiter.version <= renderedVersion) waiter.resolve();
    },
    awaitVisible({ signal } = {}) {
      const version = state.renderVersion;
      if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      if (renderedVersion >= version) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          renderWaiters.delete(waiter);
          signal?.removeEventListener("abort", abort);
          if (error) reject(error);
          else resolve();
        };
        const abort = () => finish(new DOMException("Aborted", "AbortError"));
        const waiter = { version, resolve: () => finish() };
        const timer = setTimeout(
          () =>
            finish(
              new SecuritiesApiError(
                "visible_state_timeout",
                "The requested state was not rendered.",
              ),
            ),
          10000,
        );
        renderWaiters.add(waiter);
        signal?.addEventListener("abort", abort, { once: true });
      });
    },
    setLocale(next) {
      if (!["vi", "en"].includes(next)) throw new SecuritiesApiError("invalid_locale");
      update({ locale: next });
      writeLocalePreference(next);
      return { status: "changed", locale: next };
    },
    newResearch() {
      assertContextIdle();
      stopPolling();
      update({
        view: "start",
        dossier: null,
        scope: null,
        job: null,
        error: null,
        selectedSource: null,
        approvalRequest: null,
        chat: [],
        activeTab: "analysis",
        researchResume: null,
        researchDraft: null,
      });
      urlFor(null);
    },
    deleteDossier(input, options = {}) {
      return run("delete", async () => {
        const id = input?.dossierId;
        const saved = state.dossiers.find((item) => item.id === id);
        const revision = Number(input?.revision ?? saved?.revision);
        if (!id || !Number.isSafeInteger(revision) || revision < 1)
          throw new SecuritiesApiError("invalid_dossier", "Select a saved dossier to delete.");
        if (state.job && activeStatuses.has(state.job.status) && state.job.dossierId === id)
          throw new SecuritiesApiError(
            "job_in_progress",
            "Wait for the active research task to finish or stop it before deleting.",
          );
        let result;
        try {
          result = await mutate(
            `/dossiers/${encodeURIComponent(id)}`,
            { expectedRevision: revision },
            { ...options, method: "DELETE" },
          );
        } catch (error) {
          if (error.code === "revision_conflict" || error.code === "dossier_not_found")
            await refreshDossiers(options);
          throw error;
        }
        const deletingCurrent = state.dossier?.id === id;
        if (deletingCurrent) {
          stopPolling();
          lastChatQuestion = null;
        }
        update({
          dossiers: state.dossiers.filter((item) => item.id !== id),
          ...(deletingCurrent
            ? {
                view: "start",
                dossier: null,
                scope: null,
                job: null,
                selectedSource: null,
                approvalRequest: null,
                chat: [],
                activeTab: "analysis",
                researchResume: null,
                researchDraft: null,
              }
            : {}),
          notice: "researchDeleted",
        });
        if (deletingCurrent) urlFor(null);
        await refreshDossiers(options);
        return {
          status: "deleted",
          dossierId: id,
          revision,
          ...(result?.alreadyDeleted ? { alreadyDeleted: true } : {}),
        };
      });
    },
    setTab(tab) {
      if (!["financials", "analysis", "review", "history"].includes(tab))
        throw new SecuritiesApiError("invalid_tab");
      update({ activeTab: tab });
    },
    dismissError: () => update({ error: null }),
    dismissNotice: () => update({ notice: null }),
    closeEvidence: () => update({ selectedSource: null }),
    closeApproval: () => update({ approvalRequest: null }),
    startResearch(input = {}, options = {}) {
      return run("research", async () => {
        assertContextIdle();
        const query = input.query?.trim();
        const selection = { ...input, ...(query ? { query } : {}) };
        if (!query) delete selection.query;
        update({ researchDraft: selection, scope: null, researchStep: "resolving_scope" });
        let created;
        try {
          let data;
          try {
            data = await client.request("/scope", {
              ...options,
              method: "POST",
              body: { ...selection, locale: state.locale },
            });
          } catch (error) {
            if (
              ![
                "ambiguous_company",
                "ambiguous_period",
                "unsupported_period",
                "unsupported_comparison",
                "unsupported_company",
                "no_supported_company",
              ].includes(error.code)
            )
              throw error;
            update({
              view: "start",
              scope: null,
              error: { code: error.code, details: error.details },
            });
            return { status: "scope_required", code: error.code, selection };
          }
          const scope = data.scope ?? data;
          if (scope.ready === false || scope.needsClarification) {
            update({ scope: { ...scope, ...(query ? { query } : {}) }, view: "scope" });
            return { status: "scope_required", scope: state.scope };
          }
          update({ scope: { ...scope, ...(query ? { query } : {}) } });
          if (renderedVersion >= 0) await actions.awaitVisible(options);
          const body = {
            companyId: scope.company?.id ?? scope.companyId,
            periodId: scope.period?.id ?? scope.periodId,
            comparisonPeriodId: scope.comparisonPeriod?.id ?? scope.comparisonPeriodId,
            locale: state.locale,
            ...(query ? { query } : {}),
          };
          if (!body.companyId || !body.periodId) throw new SecuritiesApiError("scope_required");
          const signature = JSON.stringify({ ...body, locale: undefined });
          if (
            state.researchResume?.signature === signature &&
            state.dossier?.id === state.researchResume.dossierId &&
            state.dossier.revision === state.researchResume.revision
          ) {
            created = state.dossier;
          } else {
            update({ researchStep: "creating_dossier" });
            const response = await mutate("/dossiers", body, options);
            stopPolling();
            created = acceptDossier(response, { job: null, activeTab: "analysis" });
            update({
              researchResume: { signature, dossierId: created.id, revision: created.revision },
            });
          }
          update({ researchStep: "starting_analysis" });
          const response = await mutate(
            `/dossiers/${encodeURIComponent(created.id)}/analyze`,
            { expectedRevision: created.revision, locale: state.locale },
            options,
          );
          const job = jobFrom(response);
          beginPolling({ ...job, dossierId: created.id, revision: created.revision });
          update({ researchResume: null });
          return {
            status: "started",
            jobId: job.id,
            dossierId: created.id,
            revision: created.revision,
          };
        } catch (error) {
          if (created)
            error.details = {
              ...error.details,
              dossierId: created.id,
              revision: created.revision,
              resumeAction: "startAnalysis",
            };
          throw error;
        } finally {
          update({ researchStep: null });
        }
      });
    },
    configureScope(input, options = {}) {
      return run("scope", async () => {
        assertContextIdle();
        const data = await client.request("/scope", {
          method: "POST",
          body: { ...input, locale: state.locale },
          ...options,
        });
        const scope = data.scope ?? data;
        const query =
          input.query ??
          (scope.companyId === state.scope?.companyId && scope.periodId === state.scope?.periodId
            ? state.scope.query
            : undefined);
        update({ scope: { ...scope, ...(query?.trim() ? { query } : {}) }, view: "scope" });
        return state.scope;
      });
    },
    createDossier(input = {}, options = {}) {
      return run("create", async () => {
        const scope = state.scope;
        const selection = {
          companyId: input.companyId ?? scope?.company?.id ?? scope?.companyId,
          periodId: input.periodId ?? scope?.period?.id ?? scope?.periodId,
          comparisonPeriodId:
            input.comparisonPeriodId ?? scope?.comparisonPeriod?.id ?? scope?.comparisonPeriodId,
        };
        if (!selection.companyId || !selection.periodId)
          throw new SecuritiesApiError(
            "scope_required",
            "Confirm a supported research scope first.",
          );
        const query = input.query ?? scope?.query;
        const data = await mutate(
          "/dossiers",
          { ...selection, locale: state.locale, ...(query?.trim() ? { query: query.trim() } : {}) },
          options,
        );
        stopPolling();
        const dossier = acceptDossier(data, { job: null, activeTab: "financials" });
        return { status: "created", dossierId: dossier.id, revision: dossier.revision };
      });
    },
    openDossier(input, options = {}) {
      return run("open", async () => {
        assertContextIdle();
        const data = await client.request(
          `/dossiers/${encodeURIComponent(input.dossierId)}${input.revision ? `?revision=${encodeURIComponent(input.revision)}` : ""}`,
          options,
        );
        stopPolling();
        const dossier = acceptDossier(data, {
          job: null,
          activeTab: (data.dossier ?? data).analysis ? "analysis" : "financials",
          researchResume: null,
        });
        if (dossier.activeJob)
          beginPolling(
            typeof dossier.activeJob === "string"
              ? {
                  id: dossier.activeJob,
                  status: "running",
                  dossierId: dossier.id,
                  revision: dossier.revision,
                }
              : dossier.activeJob,
            dossier.activeJob.kind ?? "analysis",
          );
        return { status: "opened", dossierId: dossier.id, revision: dossier.revision };
      });
    },
    startAnalysis(input = {}, options = {}) {
      return run("analyze", async () => {
        assertContextIdle();
        const dossier = bind(input);
        const data = await mutate(
          `/dossiers/${encodeURIComponent(dossier.id)}/analyze`,
          { expectedRevision: dossier.revision, locale: state.locale },
          options,
        );
        const job = jobFrom(data);
        beginPolling({ ...job, dossierId: dossier.id, revision: dossier.revision });
        update({ activeTab: "analysis", researchResume: null });
        return {
          status: "started",
          jobId: job.id,
          dossierId: dossier.id,
          revision: dossier.revision,
        };
      });
    },
    refreshSources(input, options = {}) {
      return run("sources", async () => {
        assertContextIdle();
        if (!state.catalog?.companies?.some((company) => company.id === input.companyId))
          throw new SecuritiesApiError("unsupported_company");
        const data = await mutate("/sources/jobs", { companyId: input.companyId }, options);
        const job = jobFrom(data);
        beginPolling({ ...job, companyId: input.companyId }, "sources");
        return { status: "started", jobId: job.id, companyId: input.companyId };
      });
    },
    refreshDossier(input = {}, options = {}) {
      return run("refresh", async () => {
        assertContextIdle();
        const dossier = bind(input);
        const data = await mutate(
          `/dossiers/${encodeURIComponent(dossier.id)}/refresh`,
          { expectedRevision: dossier.revision, locale: state.locale },
          options,
        );
        const job = jobFrom(data);
        beginPolling({ ...job, dossierId: dossier.id, revision: dossier.revision }, "refresh");
        return {
          status: "started",
          jobId: job.id,
          dossierId: dossier.id,
          revision: dossier.revision,
        };
      });
    },
    cancelAnalysis(input = {}, options = {}) {
      return run("cancel", async () => {
        if (!state.job || (input.jobId && input.jobId !== state.job.id))
          throw new SecuritiesApiError("job_not_active");
        const data = await mutate(
          `${state.job.kind === "sources" ? "/sources" : ""}/jobs/${encodeURIComponent(state.job.id)}/cancel`,
          {},
          options,
        );
        stopPolling();
        update({
          job: { ...state.job, ...jobFrom(data), status: jobFrom(data).status ?? "cancelled" },
          notice: "cancelled",
        });
        return { status: state.job.status, jobId: state.job.id };
      });
    },
    getAnalysisStatus(input = {}, options = {}) {
      if (!input.jobId) return Promise.resolve(state.job);
      return client.request(`/jobs/${encodeURIComponent(input.jobId)}`, options).then(jobFrom);
    },
    retryJob() {
      const job = state.job;
      if (!job) return Promise.reject(new SecuritiesApiError("job_not_found"));
      if (activeStatuses.has(job.status)) {
        beginPolling(job, job.kind);
        update({ error: null });
        return Promise.resolve({ status: "polling", jobId: job.id });
      }
      const input = { dossierId: job.dossierId, revision: job.revision };
      if (job.kind === "sources") return actions.refreshSources({ companyId: job.companyId });
      if (job.kind === "refresh") return actions.refreshDossier(input);
      if (job.kind === "chat") {
        if (
          !lastChatQuestion ||
          lastChatQuestion.dossierId !== job.dossierId ||
          lastChatQuestion.revision !== job.revision
        )
          return Promise.reject(new SecuritiesApiError("question_required"));
        return actions.askFollowup(lastChatQuestion, { retryQuestion: true });
      }
      return actions.startAnalysis(input);
    },
    getEvidence(input, options = {}) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const dossier = bind(input);
      const metric = input.metricId
        ? dossierMetrics(dossier).find((item) => item.id === input.metricId)
        : null;
      if (input.metricId && !metric) throw new SecuritiesApiError("metric_not_found");
      const side = input.period ?? "current";
      if (!["current", "comparison"].includes(side)) throw new SecuritiesApiError("invalid_period");
      if (metric && metric[side]?.sourceId !== input.sourceId)
        throw new SecuritiesApiError("evidence_mismatch");
      if (
        metric &&
        input.sourceVersion !== undefined &&
        String(input.sourceVersion) !== String(metric[side]?.sourceVersion)
      )
        throw new SecuritiesApiError("evidence_mismatch");
      const version = input.sourceVersion ?? metric?.[side]?.sourceVersion;
      const matches = (dossier.sources ?? []).filter(
        (item) =>
          item.id === input.sourceId &&
          (version === undefined || String(item.version) === String(version)),
      );
      if (matches.length !== 1)
        throw new SecuritiesApiError(
          matches.length ? "source_version_required" : "source_not_found",
        );
      const source = matches[0];
      update({
        selectedSource: {
          source,
          metric,
          period: input.period ?? "current",
          dossierId: dossier.id,
          revision: dossier.revision,
        },
      });
      return {
        status: "opened",
        dossierId: dossier.id,
        revision: dossier.revision,
        source,
        metric,
      };
    },
    applyCorrection(input, options = {}) {
      return run("revise", async () => {
        assertContextIdle();
        const dossier = bind(input);
        const data = await mutate(
          `/dossiers/${encodeURIComponent(dossier.id)}/revise`,
          {
            expectedRevision: dossier.revision,
            changes: input.changes ?? [],
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            ...(input.resolutions ? { resolutions: input.resolutions } : {}),
          },
          options,
        );
        stopPolling();
        const revised = acceptDossier(data, { job: null, notice: "correctionSaved" });
        return { status: "revised", dossierId: revised.id, revision: revised.revision };
      });
    },
    resolveIssue(input, options = {}) {
      return actions.applyCorrection(
        { ...input, resolutions: [{ issueId: input.issueId, reason: input.reason }], changes: [] },
        options,
      );
    },
    requestApproval(input, options = {}) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const dossier = bind(input);
      if (dossier.status === "approved")
        return { status: "already_approved", dossierId: dossier.id, revision: dossier.revision };
      if (
        (dossier.issues ?? []).some((issue) => issue.severity === "material" && !issue.resolution)
      )
        throw new SecuritiesApiError(
          "approval_blocked",
          "Resolve material issues before approval.",
        );
      update({
        approvalRequest: { dossierId: dossier.id, revision: dossier.revision },
        activeTab: "review",
      });
      return { status: "confirmation_required", dossierId: dossier.id, revision: dossier.revision };
    },
    approveRevision(input, options = {}) {
      return run("approve", async () => {
        const dossier = bind(input);
        if (
          !state.approvalRequest ||
          state.approvalRequest.dossierId !== dossier.id ||
          state.approvalRequest.revision !== dossier.revision ||
          input.intent !== "approve_exact_revision"
        )
          throw new SecuritiesApiError("confirmation_required");
        const data = await mutate(
          `/dossiers/${encodeURIComponent(dossier.id)}/approve`,
          { expectedRevision: dossier.revision, intent: "approve_exact_revision" },
          options,
        );
        const approved = acceptDossier(data, { notice: "approvalSuccess", activeTab: "review" });
        return { status: "approved", dossierId: approved.id, revision: approved.revision };
      });
    },
    exportRevision(input, options = {}) {
      return run("export", async () => {
        const dossier = bind(input);
        if (
          !dossier.reportReadiness?.canExport ||
          dossier.reportReadiness.revision !== dossier.revision
        )
          throw new SecuritiesApiError("report_unavailable");
        if (!["xlsx", "md"].includes(input.format))
          throw new SecuritiesApiError("invalid_export_format");
        const result = await client.download({
          dossierId: dossier.id,
          revision: dossier.revision,
          format: input.format,
          ...options,
        });
        if (typeof document !== "undefined") {
          const url = URL.createObjectURL(result.blob);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = result.filename;
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
        update({ notice: "exportSuccess" });
        return {
          status: typeof document === "undefined" ? "artifact_ready" : "download_requested",
          artifactReady: true,
          dossierId: dossier.id,
          revision: dossier.revision,
          format: input.format,
          filename: result.filename,
          bytes: result.blob.size,
        };
      });
    },
    askFollowup(input, options = {}) {
      return run("chat", async () => {
        assertContextIdle();
        const dossier = bind(input);
        lastChatQuestion = {
          dossierId: dossier.id,
          revision: dossier.revision,
          question: input.question,
        };
        const data = await mutate(
          `/dossiers/${encodeURIComponent(dossier.id)}/chat`,
          { revision: dossier.revision, question: input.question, locale: state.locale },
          options,
        );
        if (!options.retryQuestion)
          update({
            chat: [
              ...state.chat,
              { role: "user", content: input.question, revision: dossier.revision },
            ],
          });
        if (data.job || (data.id && data.status)) {
          const job = jobFrom(data);
          beginPolling({ ...job, dossierId: dossier.id, revision: dossier.revision }, "chat");
          return {
            status: "started",
            jobId: job.id,
            dossierId: dossier.id,
            revision: dossier.revision,
          };
        }
        update({
          chat: [
            ...state.chat,
            {
              role: "assistant",
              answer: data.answer ?? data,
              content: data.answer?.text ?? data.answer ?? data.text,
              revision: dossier.revision,
            },
          ],
        });
        return { status: "completed", dossierId: dossier.id, revision: dossier.revision };
      });
    },
  };
  return actions;
}
