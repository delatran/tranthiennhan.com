import { DossierError } from "../../shared/securities/dossier.js";
import { projectSecuritiesReport } from "../../shared/securities/report.js";
import { securitiesReceiptIdentity } from "../../shared/securities/receipt-identity.js";

const MAX_CHAT_RESULT_BYTES = 512_000;
const MAX_CHAT_VIEW_BYTES = 1_048_576;

function mergeReceiptObservations(receipts) {
  const merged = [];
  const identities = new Map();
  for (const receipt of receipts) {
    const identity = securitiesReceiptIdentity(receipt);
    const index = identity === null ? undefined : identities.get(identity);
    if (index === undefined) {
      if (identity !== null) identities.set(identity, merged.length);
      merged.push(structuredClone(receipt));
      continue;
    }
    const previous = merged[index];
    const validationHistory = [
      ...new Map(
        [
          ...(previous.validationHistory ?? []),
          previous.validation,
          ...(receipt.validationHistory ?? []),
          receipt.validation,
        ]
          .filter(Boolean)
          .map((validation) => [JSON.stringify(validation), structuredClone(validation)]),
      ).values(),
    ];
    merged[index] = {
      ...previous,
      ...structuredClone(receipt),
      ...(receipt.validation == null && previous.validation
        ? { validation: previous.validation }
        : {}),
      ...(validationHistory.length > 1 ? { validationHistory } : {}),
    };
  }
  return merged;
}

function parseSnapshot(row) {
  if (!row) throw new DossierError("dossier_not_found", 404);
  const dossier = JSON.parse(row.snapshot_json);
  dossier.status = row.approved_at ? "approved" : "draft";
  dossier.approval = row.approved_at
    ? { revision: dossier.revision, at: row.approved_at, intent: "approve_exact_revision" }
    : null;
  return Object.assign(dossier, projectSecuritiesReport(dossier));
}

function serializeSnapshot(dossier) {
  const clean = structuredClone(dossier);
  delete clean.history;
  delete clean.activeJob;
  delete clean.chat;
  delete clean.chatHistoryTruncated;
  delete clean.reportReadiness;
  delete clean.reportProjection;
  clean.status = "draft";
  clean.approval = null;
  const json = JSON.stringify(clean);
  if (new TextEncoder().encode(json).length > 1_048_576)
    throw new DossierError("dossier_too_large", 413);
  return json;
}

function parseJob(row) {
  if (!row) throw new DossierError("job_not_found", 404);
  const result = row.result_json ? JSON.parse(row.result_json) : null;
  const progress = result?.progress ?? null;
  return {
    id: row.id,
    dossierId: row.dossier_id,
    revision: row.revision,
    kind: row.kind,
    status: row.status,
    startedAt: row.started_at,
    deadline: row.deadline,
    completedAt: row.completed_at,
    result: progress ? null : result,
    progress,
    error: row.error_code ? { code: row.error_code } : null,
    receipts: row.receipt_json ? mergeReceiptObservations(JSON.parse(row.receipt_json)) : [],
  };
}

export function createSecuritiesStore(db) {
  if (!db?.prepare || !db?.batch) throw new DossierError("storage_not_configured", 503);
  const stmt = (sql, ...values) => db.prepare(sql).bind(...values);

  async function requestResult(requestId, fingerprint) {
    const row = await stmt(
      "SELECT * FROM securities_requests WHERE request_id = ?",
      requestId,
    ).first();
    if (!row) return null;
    if (row.fingerprint !== fingerprint) throw new DossierError("idempotency_conflict", 409);
    if (row.result_kind === "deletion")
      return {
        deleted: true,
        dossierId: row.result_id,
        revision: row.result_revision,
        replay: true,
      };
    if (row.result_kind === "deletion_pending") throw new DossierError("request_in_progress", 409);
    if (row.result_kind === "job") return { job: await getJob(row.result_id) };
    return { dossier: await get(row.result_id, row.result_revision) };
  }

  async function get(id, revision) {
    const row = await stmt(
      `SELECT r.snapshot_json, a.approved_at FROM securities_revisions r
      JOIN securities_dossiers d ON d.id = r.dossier_id
      LEFT JOIN securities_approvals a ON a.dossier_id = r.dossier_id AND a.revision = r.revision
      WHERE r.dossier_id = ? AND r.revision = COALESCE(?, d.head_revision)`,
      id,
      revision ?? null,
    ).first();
    const dossier = parseSnapshot(row);
    const history = await stmt(
      `SELECT r.revision, r.created_at, a.approved_at,
      json_extract(r.snapshot_json, '$.revisionEvent') AS event
      FROM securities_revisions r LEFT JOIN securities_approvals a ON a.dossier_id = r.dossier_id AND a.revision = r.revision
      WHERE r.dossier_id = ? ORDER BY r.revision DESC LIMIT 200`,
      id,
    ).all();
    dossier.history = history.results.map((item) => ({
      revision: item.revision,
      createdAt: item.created_at,
      event: item.event,
      status: item.approved_at ? "approved" : "draft",
      approvedAt: item.approved_at,
    }));
    const active = await stmt(
      "SELECT * FROM securities_jobs WHERE dossier_id = ? AND status = 'running' LIMIT 1",
      id,
    ).first();
    dossier.activeJob = active ? await getJob(active.id) : null;
    const conversation = await readChat(id, dossier.revision);
    dossier.chat = conversation.messages;
    dossier.chatHistoryTruncated = conversation.truncated;
    return dossier;
  }

  async function readChat(id, revision) {
    const rows = await stmt(
      `SELECT id, result_json, completed_at FROM securities_jobs
      WHERE dossier_id = ? AND revision = ? AND kind = 'chat' AND status = 'completed'
      ORDER BY started_at DESC, rowid DESC LIMIT 13`,
      id,
      revision,
    ).all();
    const turns = [];
    let size = 0;
    let truncated = rows.results.length > 12;
    for (const row of rows.results.slice(0, 12)) {
      const result = JSON.parse(row.result_json);
      if (
        result.dossierId !== id ||
        result.revision !== revision ||
        typeof result.question !== "string" ||
        !result.answer
      )
        continue;
      const pair = [
        { role: "user", content: result.question, revision, jobId: row.id, at: row.completed_at },
        {
          role: "assistant",
          answer: result.answer,
          content: result.answer.summary ?? "",
          revision,
          jobId: row.id,
          at: row.completed_at,
        },
      ];
      const bytes = new TextEncoder().encode(JSON.stringify(pair)).length;
      if (size + bytes > MAX_CHAT_VIEW_BYTES) {
        truncated = true;
        break;
      }
      size += bytes;
      turns.unshift(pair);
    }
    return { messages: turns.flat(), truncated };
  }

  async function list() {
    const rows = await stmt(`SELECT r.snapshot_json, a.approved_at FROM securities_dossiers d
      JOIN securities_revisions r ON r.dossier_id = d.id AND r.revision = d.head_revision
      LEFT JOIN securities_approvals a ON a.dossier_id = d.id AND a.revision = d.head_revision
      ORDER BY d.updated_at DESC LIMIT 100`).all();
    return rows.results.map((row) => {
      const dossier = parseSnapshot(row);
      return {
        id: dossier.id,
        query: dossier.query ?? "",
        company: dossier.company,
        period: dossier.period,
        comparisonPeriod: dossier.comparisonPeriod,
        revision: dossier.revision,
        status: dossier.status,
        createdAt: dossier.createdAt,
        updatedAt: dossier.updatedAt,
        reportReadiness: dossier.reportReadiness,
        materialIssueCount: dossier.issues.filter(
          (issue) => issue.severity === "material" && !issue.resolution,
        ).length,
      };
    });
  }

  async function create(dossier, requestId, fingerprint) {
    const existing = await requestResult(requestId, fingerprint);
    if (existing) return existing;
    try {
      await db.batch([
        stmt(
          "INSERT INTO securities_dossiers (id,head_revision,created_at,updated_at) VALUES (?,?,?,?)",
          dossier.id,
          1,
          dossier.createdAt,
          dossier.updatedAt,
        ),
        stmt(
          "INSERT INTO securities_revisions (dossier_id,revision,mutation_id,snapshot_json,created_at) VALUES (?,?,?,?,?)",
          dossier.id,
          1,
          requestId,
          serializeSnapshot(dossier),
          dossier.createdAt,
        ),
        stmt(
          "INSERT INTO securities_requests (request_id,fingerprint,result_kind,result_id,result_revision,created_at) VALUES (?,?,'dossier',?,?,?)",
          requestId,
          fingerprint,
          dossier.id,
          1,
          dossier.createdAt,
        ),
      ]);
    } catch (error) {
      const replay = await requestResult(requestId, fingerprint);
      if (replay) return replay;
      throw error;
    }
    return { dossier: await get(dossier.id, 1) };
  }

  async function saveRevision(dossier, { requestId, fingerprint, expectedRevision }) {
    const existing = await requestResult(requestId, fingerprint);
    if (existing) return existing;
    if (dossier.revision !== expectedRevision + 1) throw new DossierError("invalid_revision", 422);
    try {
      const results = await db.batch([
        stmt(
          `INSERT INTO securities_revisions (dossier_id,revision,mutation_id,snapshot_json,created_at)
          SELECT ?,?,?,?,? FROM securities_dossiers WHERE id = ? AND head_revision = ?`,
          dossier.id,
          dossier.revision,
          requestId,
          serializeSnapshot(dossier),
          dossier.updatedAt,
          dossier.id,
          expectedRevision,
        ),
        stmt(
          `UPDATE securities_dossiers SET head_revision = ?, updated_at = ? WHERE id = ? AND head_revision = ?
          AND EXISTS (SELECT 1 FROM securities_revisions WHERE mutation_id = ?)`,
          dossier.revision,
          dossier.updatedAt,
          dossier.id,
          expectedRevision,
          requestId,
        ),
        stmt(
          `INSERT INTO securities_requests (request_id,fingerprint,result_kind,result_id,result_revision,created_at)
          SELECT ?,?,'dossier',?,?,? WHERE EXISTS (SELECT 1 FROM securities_revisions WHERE mutation_id = ?)`,
          requestId,
          fingerprint,
          dossier.id,
          dossier.revision,
          dossier.updatedAt,
          requestId,
        ),
      ]);
      if (!results[0].meta.changes) throw new DossierError("revision_conflict", 409);
    } catch (error) {
      const replay = await requestResult(requestId, fingerprint);
      if (replay) return replay;
      throw error;
    }
    return { dossier: await get(dossier.id, dossier.revision) };
  }

  async function approve(dossier, { requestId, fingerprint, now }) {
    const existing = await requestResult(requestId, fingerprint);
    if (existing) return existing;
    try {
      await db.batch([
        stmt(
          `INSERT OR IGNORE INTO securities_approvals (dossier_id,revision,approved_at,request_id)
          SELECT ?,?,?,? FROM securities_dossiers WHERE id = ? AND head_revision = ?`,
          dossier.id,
          dossier.revision,
          now,
          requestId,
          dossier.id,
          dossier.revision,
        ),
        stmt(
          `INSERT INTO securities_requests (request_id,fingerprint,result_kind,result_id,result_revision,created_at)
          SELECT ?,?,'dossier',?,?,? FROM securities_dossiers d WHERE d.id = ? AND d.head_revision = ?
          AND EXISTS (SELECT 1 FROM securities_approvals WHERE dossier_id = ? AND revision = ?)`,
          requestId,
          fingerprint,
          dossier.id,
          dossier.revision,
          now,
          dossier.id,
          dossier.revision,
          dossier.id,
          dossier.revision,
        ),
      ]);
    } catch (error) {
      const replay = await requestResult(requestId, fingerprint);
      if (replay) return replay;
      throw error;
    }
    const completed = await requestResult(requestId, fingerprint);
    if (!completed) throw new DossierError("revision_conflict", 409);
    return completed;
  }

  async function deleteDossier(
    id,
    { expectedRevision, requestId, fingerprint, now = new Date().toISOString() },
  ) {
    const existing = await requestResult(requestId, fingerprint);
    if (existing) return existing;

    // Do not let an abandoned deadline keep a dossier undeletable forever.
    await stmt(
      `UPDATE securities_jobs SET status = 'failed', error_code = 'job_interrupted', completed_at = ?
      WHERE dossier_id = ? AND status = 'running' AND deadline < ?`,
      now,
      id,
      now,
    ).run();
    const current = await stmt(
      "SELECT head_revision FROM securities_dossiers WHERE id = ?",
      id,
    ).first();
    // Deletion is intentionally idempotent and does not reveal whether an opaque ID ever existed.
    if (!current)
      return { deleted: true, dossierId: id, revision: expectedRevision, alreadyDeleted: true };
    if (Number(current.head_revision) !== Number(expectedRevision))
      throw new DossierError("revision_conflict", 409, {
        currentRevision: Number(current.head_revision),
      });
    const active = await stmt(
      "SELECT id FROM securities_jobs WHERE dossier_id = ? AND status = 'running' LIMIT 1",
      id,
    ).first();
    if (active) throw new DossierError("job_in_progress", 409, { jobId: active.id });

    try {
      const results = await db.batch([
        // The conditional marker is the transaction guard for every destructive statement below.
        stmt(
          `INSERT INTO securities_requests
          (request_id,fingerprint,result_kind,result_id,result_revision,created_at)
          SELECT ?,?,'deletion_pending',?,?,? FROM securities_dossiers d
          WHERE d.id = ? AND d.head_revision = ?
          AND NOT EXISTS (
            SELECT 1 FROM securities_jobs j WHERE j.dossier_id = d.id AND j.status = 'running'
          )`,
          requestId,
          fingerprint,
          id,
          expectedRevision,
          now,
          id,
          expectedRevision,
        ),
        stmt(
          `DELETE FROM securities_requests
          WHERE request_id <> ?
          AND EXISTS (
            SELECT 1 FROM securities_requests
            WHERE request_id = ? AND result_kind = 'deletion_pending'
          )
          AND (
            result_id = ? OR result_id IN (
              SELECT id FROM securities_jobs WHERE dossier_id = ?
            )
          )`,
          requestId,
          requestId,
          id,
          id,
        ),
        stmt(
          `DELETE FROM securities_jobs WHERE dossier_id = ?
          AND EXISTS (
            SELECT 1 FROM securities_requests
            WHERE request_id = ? AND result_kind = 'deletion_pending'
          )`,
          id,
          requestId,
        ),
        stmt(
          `DELETE FROM securities_approvals WHERE dossier_id = ?
          AND EXISTS (
            SELECT 1 FROM securities_requests
            WHERE request_id = ? AND result_kind = 'deletion_pending'
          )`,
          id,
          requestId,
        ),
        stmt(
          `DELETE FROM securities_revisions WHERE dossier_id = ?
          AND EXISTS (
            SELECT 1 FROM securities_requests
            WHERE request_id = ? AND result_kind = 'deletion_pending'
          )`,
          id,
          requestId,
        ),
        stmt(
          `DELETE FROM securities_dossiers WHERE id = ? AND head_revision = ?
          AND EXISTS (
            SELECT 1 FROM securities_requests
            WHERE request_id = ? AND result_kind = 'deletion_pending'
          )`,
          id,
          expectedRevision,
          requestId,
        ),
        stmt(
          `UPDATE securities_requests SET result_kind = 'deletion'
          WHERE request_id = ? AND result_kind = 'deletion_pending'
          AND NOT EXISTS (SELECT 1 FROM securities_dossiers WHERE id = ?)`,
          requestId,
          id,
        ),
      ]);
      if (!results[0].meta.changes || !results[5].meta.changes || !results[6].meta.changes) {
        const latest = await stmt(
          "SELECT head_revision FROM securities_dossiers WHERE id = ?",
          id,
        ).first();
        if (!latest)
          return { deleted: true, dossierId: id, revision: expectedRevision, alreadyDeleted: true };
        const running = await stmt(
          "SELECT id FROM securities_jobs WHERE dossier_id = ? AND status = 'running' LIMIT 1",
          id,
        ).first();
        if (running) throw new DossierError("job_in_progress", 409, { jobId: running.id });
        throw new DossierError("revision_conflict", 409, {
          currentRevision: Number(latest.head_revision),
        });
      }
    } catch (error) {
      const replay = await requestResult(requestId, fingerprint);
      if (replay) return replay;
      throw error;
    }
    return { deleted: true, dossierId: id, revision: expectedRevision };
  }

  async function getJob(id, now = new Date().toISOString()) {
    await stmt(
      `UPDATE securities_jobs SET status = 'failed', error_code = 'job_interrupted', completed_at = ?
      WHERE id = ? AND status = 'running' AND deadline < ?`,
      now,
      id,
      now,
    ).run();
    return parseJob(await stmt("SELECT * FROM securities_jobs WHERE id = ?", id).first());
  }

  async function startJob(job, fingerprint) {
    const existing = await requestResult(job.requestId, fingerprint);
    if (existing) return { ...existing, replay: true };
    await stmt(
      `UPDATE securities_jobs SET status = 'failed', error_code = 'job_interrupted', completed_at = ?
      WHERE dossier_id = ? AND status = 'running' AND deadline < ?`,
      job.startedAt,
      job.dossierId,
      job.startedAt,
    ).run();
    const current = await get(job.dossierId, job.kind === "chat" ? job.revision : undefined);
    if (current.revision !== job.revision) throw new DossierError("revision_conflict", 409);
    if (
      job.kind === "analysis" &&
      (current.status === "approved") !== (job.baseWasApproved === true)
    )
      throw new DossierError("revision_conflict", 409);
    try {
      const results = await db.batch([
        stmt(
          `INSERT INTO securities_jobs (id,request_id,dossier_id,revision,kind,status,started_at,deadline)
          SELECT ?,?,?,?,?,'running',?,? FROM securities_dossiers d WHERE d.id = ?
          AND (? = 'chat' OR d.head_revision = ?)
          AND (? != 'analysis' OR ? = 1 OR NOT EXISTS (SELECT 1 FROM securities_approvals WHERE dossier_id = ? AND revision = ?))`,
          job.id,
          job.requestId,
          job.dossierId,
          job.revision,
          job.kind,
          job.startedAt,
          job.deadline,
          job.dossierId,
          job.kind,
          job.revision,
          job.kind,
          job.baseWasApproved === true ? 1 : 0,
          job.dossierId,
          job.revision,
        ),
        stmt(
          `INSERT INTO securities_requests (request_id,fingerprint,result_kind,result_id,result_revision,created_at)
          SELECT ?,?,'job',?,NULL,? WHERE EXISTS (SELECT 1 FROM securities_jobs WHERE id = ?)`,
          job.requestId,
          fingerprint,
          job.id,
          job.startedAt,
          job.id,
        ),
      ]);
      if (!results[0].meta.changes) throw new DossierError("revision_conflict", 409);
    } catch (error) {
      const replay = await requestResult(job.requestId, fingerprint);
      if (replay) return { ...replay, replay: true };
      const active = await stmt(
        "SELECT id FROM securities_jobs WHERE dossier_id = ? AND status = 'running'",
        job.dossierId,
      ).first();
      if (active) throw new DossierError("job_already_running", 409, { jobId: active.id });
      throw error;
    }
    return { job: await getJob(job.id), replay: false };
  }

  async function completeAnalysis(job, dossier, receipts = []) {
    const mutationId = `job_${job.id}`;
    await db.batch([
      stmt(
        `INSERT INTO securities_revisions (dossier_id,revision,mutation_id,snapshot_json,created_at)
        SELECT ?,?,?,?,? FROM securities_dossiers d JOIN securities_jobs j ON j.dossier_id = d.id
        WHERE j.id = ? AND j.status = 'running' AND d.head_revision = ? AND j.deadline >= ?
        AND (j.kind = 'refresh' OR ? = 1 OR NOT EXISTS (SELECT 1 FROM securities_approvals WHERE dossier_id = d.id AND revision = d.head_revision))`,
        dossier.id,
        dossier.revision,
        mutationId,
        serializeSnapshot(dossier),
        dossier.updatedAt,
        job.id,
        job.revision,
        dossier.updatedAt,
        job.baseWasApproved === true ? 1 : 0,
      ),
      stmt(
        `UPDATE securities_dossiers SET head_revision = ?, updated_at = ? WHERE id = ? AND head_revision = ?
        AND EXISTS (SELECT 1 FROM securities_revisions WHERE mutation_id = ?)`,
        dossier.revision,
        dossier.updatedAt,
        dossier.id,
        job.revision,
        mutationId,
      ),
      stmt(
        `UPDATE securities_jobs SET status = 'completed', completed_at = ?, result_json = ?
        WHERE id = ? AND status = 'running' AND EXISTS (SELECT 1 FROM securities_revisions WHERE mutation_id = ?)`,
        dossier.updatedAt,
        JSON.stringify({ dossierId: dossier.id, revision: dossier.revision }),
        job.id,
        mutationId,
      ),
      stmt(
        `UPDATE securities_jobs SET status = 'stale', completed_at = ?, error_code = 'revision_changed'
        WHERE id = ? AND status = 'running' AND deadline >= ?`,
        dossier.updatedAt,
        job.id,
        dossier.updatedAt,
      ),
      stmt(
        `UPDATE securities_jobs SET status = 'failed', completed_at = ?, error_code = 'job_timeout'
        WHERE id = ? AND status = 'running' AND deadline < ?`,
        dossier.updatedAt,
        job.id,
        dossier.updatedAt,
      ),
    ]);
    await reconcileReceipts(job.id, receipts);
    return getJob(job.id);
  }

  async function completeChat(job, answer, now = new Date().toISOString()) {
    const result = JSON.stringify({
      dossierId: job.dossierId,
      revision: job.revision,
      question: typeof job.question === "string" ? job.question : null,
      answer,
    });
    if (new TextEncoder().encode(result).length > MAX_CHAT_RESULT_BYTES)
      throw new DossierError("model_output_too_large", 502);
    await stmt(
      `UPDATE securities_jobs SET status = 'completed', completed_at = ?, result_json = ?
      WHERE id = ? AND status = 'running' AND deadline >= ?`,
      now,
      result,
      job.id,
      now,
    ).run();
    await stmt(
      `UPDATE securities_jobs SET status = 'failed', completed_at = ?, error_code = 'job_timeout'
      WHERE id = ? AND status = 'running' AND deadline < ?`,
      now,
      job.id,
      now,
    ).run();
    await reconcileReceipts(job.id, answer.receipts ?? [answer.receipt].filter(Boolean));
    return getJob(job.id);
  }

  async function updateJobProgress(id, progress, now = new Date().toISOString()) {
    if (
      !progress ||
      typeof progress !== "object" ||
      Array.isArray(progress) ||
      Object.keys(progress).some(
        (key) => !["stage", "readCount", "sourceId", "pages"].includes(key),
      ) ||
      !["reading_sources", "writing_report", "checking_report"].includes(progress.stage) ||
      (progress.readCount !== undefined &&
        (!Number.isSafeInteger(progress.readCount) ||
          progress.readCount < 0 ||
          progress.readCount > 100)) ||
      (progress.sourceId !== undefined &&
        (typeof progress.sourceId !== "string" ||
          !/^[a-zA-Z0-9_-]{1,100}$/u.test(progress.sourceId))) ||
      (progress.pages !== undefined &&
        (!Array.isArray(progress.pages) ||
          progress.pages.length > 6 ||
          progress.pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > 999)))
    )
      throw new DossierError("invalid_job_progress", 422);
    await stmt(
      "UPDATE securities_jobs SET result_json = ? WHERE id = ? AND status = 'running' AND deadline >= ?",
      JSON.stringify({ progress: { ...progress, at: now } }),
      id,
      now,
    ).run();
  }

  async function reconcileReceipts(id, receipts) {
    if (!Array.isArray(receipts) || !receipts.length) return;
    const row = await stmt("SELECT receipt_json FROM securities_jobs WHERE id = ?", id).first();
    if (!row) return;
    const previous = row.receipt_json ? JSON.parse(row.receipt_json) : [];
    const all = mergeReceiptObservations([...previous, ...receipts]);
    const json = JSON.stringify(all);
    if (new TextEncoder().encode(json).length > 100_000)
      throw new DossierError("receipt_too_large", 502);
    await stmt("UPDATE securities_jobs SET receipt_json = ? WHERE id = ?", json, id).run();
  }

  async function failJob(id, code, receipts = [], now = new Date().toISOString()) {
    await stmt(
      `UPDATE securities_jobs SET status = 'failed', completed_at = ?, error_code = ?
      WHERE id = ? AND status = 'running'`,
      now,
      code,
      id,
    ).run();
    await reconcileReceipts(id, receipts);
    return getJob(id);
  }

  async function cancelJob(id, { requestId, fingerprint, now = new Date().toISOString() }) {
    const existing = await requestResult(requestId, fingerprint);
    if (existing) return existing;
    await getJob(id);
    try {
      await db.batch([
        stmt(
          "UPDATE securities_jobs SET status = 'cancelled', completed_at = ?, error_code = 'cancelled' WHERE id = ? AND status = 'running'",
          now,
          id,
        ),
        stmt(
          "INSERT INTO securities_requests (request_id,fingerprint,result_kind,result_id,result_revision,created_at) VALUES (?,?,'job',?,NULL,?)",
          requestId,
          fingerprint,
          id,
          now,
        ),
      ]);
    } catch (error) {
      const replay = await requestResult(requestId, fingerprint);
      if (replay) return replay;
      throw error;
    }
    return { job: await getJob(id) };
  }

  return {
    requestResult,
    get,
    list,
    create,
    saveRevision,
    approve,
    deleteDossier,
    getJob,
    startJob,
    completeAnalysis,
    completeChat,
    failJob,
    cancelJob,
    reconcileReceipts,
    updateJobProgress,
  };
}
