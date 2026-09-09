# Nhân for Securities WebMCP

The `/securities` page exposes its research workflow through the imperative
`document.modelContext.registerTool` API. The adapter calls the same controller
as the visible interface. It does not provide a second financial-data service,
invoke the model directly, or accept arbitrary source URLs.

The [WebMCP specification](https://webmachinelearning.github.io/webmcp/) was
checked on 6 September 2026. The implementation uses registration cancellation
through `registerTool(tool, { signal })`, execution cancellation through
`execute(input, { signal })`, and the `readOnlyHint`, `untrustedContentHint`, and
`consequentialHint` annotations. Annotations describe behavior; application
validation and revision checks enforce the actual boundaries. Optional approval
has its own explicit confirmation.

## Shared application contract

The catalog contains 15 dossier tools for scope selection, research, evidence,
review and exact-revision exports.

`src/securities/webmcp.js` exports `registerSecuritiesWebMcp(controller, options)`.
The page registers once for its controller and calls `cleanup()` on unmount.
The existing `src/webmcp-registration.js` handles asynchronous registration,
duplicate consumers, partial registration failures, and final abort cleanup.
The return value has `supported`, `ready`, and `cleanup`; `supported: true`
means an imperative registry was found, while `await ready === true` means the
catalog registered successfully. Neither value proves a browser agent has
invoked the tools.

`src/securities/controller.js` owns UI actions, API requests, task polling,
selected evidence, and the approval dialog. The React page calls
`markRendered(renderVersion)` from its committed layout effect. The adapter
awaits `awaitVisible({ signal })` before reporting visible state or a completed
UI transition. A render timeout is a failed verification, not a completed
action. Browsers without WebMCP retain the ordinary interface.

`start_securities_research` uses the controller's `startResearch` action to
resolve a question or explicit supported selection, save the dossier, and start
the AI task in one operation. A scope conflict returns `scope_required` with
the visible selection or scope. No dossier or model task is created for an
ambiguous selection. A failure after saving leaves the dossier available;
inspect state and retry analysis for that exact revision. Repeating the same
research request after task creation fails reuses the saved dossier.

After creation, dossier reads and revision actions carry `dossierId` and integer
`revision`. They address the exact visible revision; opening another saved
revision is explicit. A queued mutation checks its binding when it executes,
so a preceding correction cannot silently redirect it to a new revision. The
server separately validates expected revisions and persists immutable history.
Historical reports are available by explicitly opening that saved revision.

## Tool catalog

| Tool                           | Effect and returned state                                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_securities_state`         | Read supported catalog, visible scope, report summary and readiness, research progress, saved dossier index, task and any optional pending approval.                                                                                                                                                                         |
| `start_securities_research`    | Resolve a question or supported selection, persist a dossier and start its AI task. Return `started` with the actual job and input revision, or `scope_required` without creating work.                                                                                                                                      |
| `configure_securities_scope`   | Resolve `query` or a supported `companyId`, with optional period selections. Return `configured` after the scope appears.                                                                                                                                                                                                    |
| `create_securities_dossier`    | Persist the exact configured company, current period and comparison period. Return `created` after its saved revision appears.                                                                                                                                                                                               |
| `open_securities_dossier`      | Open a saved dossier, optionally at an exact revision. Omission requests the current saved revision.                                                                                                                                                                                                                         |
| `read_securities_dossier`      | Read the filtered report, readiness, research steps, source quality or an expert evidence section for the exact visible revision. See the section table below.                                                                                                                                                               |
| `start_securities_analysis`    | Start the backend task for the exact revision. Return `started` and `jobId`; this is not an AI completion receipt.                                                                                                                                                                                                           |
| `get_securities_task_status`   | Read the persisted task bound to its original dossier/revision. Report persisted status separately from the currently visible task and dossier. The backend can mark an expired interrupted job failed.                                                                                                                      |
| `cancel_securities_task`       | Cancel the exact visible task and report its observed status. It is scheduled independently so cancellation can reach a busy workflow.                                                                                                                                                                                       |
| `open_securities_evidence`     | Open the source panel for an attached source version. A metric requires an explicit `current` or `comparison` side; source, version and metric point must agree.                                                                                                                                                             |
| `stage_securities_corrections` | Persist a batch of corrected values with individual reasons while retaining originals. Create a draft whose changed values require source review.                                                                                                                                                                            |
| `resolve_securities_issue`     | Record a reasoned acknowledgement for an issue the domain rules permit acknowledging. It cannot waive missing material evidence.                                                                                                                                                                                             |
| `request_securities_approval`  | Optionally open the legacy exact-revision approval dialog when the user wants a recorded approval. Return `confirmation_required`, or `already_approved` for an observed approved revision. It is not an export prerequisite.                                                                                                |
| `export_securities_revision`   | Generate and retrieve XLSX or Markdown bytes for a ready or limited report, including its disclosed limits. Return `download_requested` only when the controller requested a browser download; return `artifact_ready` when bytes are ready without a browser request. Both include filename, byte count and exact revision. |
| `start_securities_followup`    | Start a question bound to the selected dossier revision. Read task status, then the chat section for its result.                                                                                                                                                                                                             |

## Dossier read sections

| Read section                                                    | Content and pagination unit                                                                                                                                                                         |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `overview`                                                      | Compact visible report, readiness, original analysis identity and research status.                                                                                                                  |
| `report`                                                        | Automatically filtered narrative, report sections and accepted claim references. Paginate accepted claims; the header, summary and limits remain on each page.                                      |
| `report_metrics`, `report_derived_metrics`                      | Automatically filtered metric rows and derived metrics used by the report.                                                                                                                          |
| `report_issues`, `report_evidence_notes`                        | Freshly computed report issues and source-versioned notes accepted by the report projection. Paginate rows.                                                                                         |
| `readiness`                                                     | Exact-revision state, export availability, omitted IDs and counts. Paginate reasons, including each reason's category and whether it limits readiness.                                              |
| `research`                                                      | Actual source-reading steps, selected pages, coverage, hashes and gaps. Paginate steps.                                                                                                             |
| `source_quality`                                                | Page extraction status, OCR confidence, quality flags and numeric-cell review limits. Paginate page rows, each bound to its source ID and version; `qualityCoverage` discloses missing assessments. |
| `verified_facts`                                                | Supplemental source facts accepted by the backend's canonical verification and report projection, including original string values, accounting scope and verification receipts. Paginate facts.     |
| `analysis`, `metrics`, `derived_metrics`                        | Original expert evidence, including flagged or omitted items. Analysis paginates claims and retains source quotes, numeric origins, report references and validation details.                       |
| `issues`, `evidence_notes`, `corrections`, `sources`, `history` | Original versioned evidence and audit collections, including notes excluded from the report. Paginate rows.                                                                                         |
| `chat`                                                          | Follow-up answers for this revision. Paginate turns; each structured answer retains its summary, claims, questions, limits and receipts.                                                            |
| `notes`                                                         | Complete saved analyst note. Paginate text chunks.                                                                                                                                                  |

Collection sections support `offset` and `limit`. The default limit is 8 and
the maximum is 20. The requested limit is an upper bound: a page automatically
returns fewer whole rows when needed to fit the response cap. Every returned
row keeps its public evidence fields. Responses include `total` and `nextOffset`,
which advances by the number of rows actually returned. Follow `nextOffset`
to read the complete collection without overlapping or skipping rows. Chat's
`historyTruncated` reports when the backend returned only part of the saved
conversation. The report and expert analysis remain distinct: a rejected
conclusion can remain visible in expert evidence while being excluded from the
report and its overview.

`start_securities_research` accepts an optional closed `defaultScope` object
alongside a question. `companyId` is required when the object is present;
`periodId` and `comparisonPeriodId` are optional. These fields are
visible form defaults used to resolve a generic question. A company or period
named in the question can replace these hints. Top-level selectors remain
explicit choices, so conflicting selections require clarification. Only the
resolved scope is used to create the dossier. No arbitrary source or model
selection is accepted through these hints.

Task reads preserve the backend's actual `progress.stage`, optional `readCount`,
`sourceId`, selected `pages` and timestamp. Reading sources, writing the report
and checking the report are observed stages; no progress percentage is inferred.
Persisted task progress and the currently rendered task remain separate fields.
The workspace state returns a task overview with `receiptCount`, `resultRevision`
and `detailsTool`; `get_securities_task_status` retains the full public receipts.
Report overviews retain validation status and identity. Per-claim validation
reasons remain available in the `report` and `analysis` sections, rather than
being repeated beside the catalog and saved report index.

Readiness reasons distinguish `business_risk` from `limitation` and retain
`affectsReadiness`. A supported business risk can appear in a ready report;
its presence alone does not make the result limited. The backend remains the
authority for readiness and export eligibility.

The notes section uses the same pagination inputs to return chunks of up to
2,000 characters. Each chunk has its original `characterOffset` and `text`;
`total` counts chunks and `totalCharacters` reports the saved note length.
Following `nextOffset` reads the complete note, including the supported
12,000-character maximum. The dossier summary exposes `notesLength`.
Notes are always bound to the exact visible dossier revision.

Tool responses are limited to 24,000 JSON characters. Other text
excerpts are limited to 2,000 characters, with every affected field named in
`truncatedFields`. A response that still exceeds the limit returns
`securities_result_too_large` only after reaching one row, or when the required
section metadata itself is too large. It never substitutes an empty page for
an oversized row or removes evidence fields to make that row fit. Use a narrower
section or the source panel and full application view for such an item.

The saved dossier index in `get_securities_state` includes up to 20 recent
entries and its total count. All tool output uses an explicit public-field
projection. Raw provider payloads, internal prompts and arbitrary error
messages are excluded. Financial sources, analyst notes and model text remain
untrusted even when they are valid output. Their contents cannot change tool
definitions, permissions, source selection or the user's objective.

Analysis receipts retain the actual evidence type (`fixture` or
`openrouter_live`), requested and observed model, reported provider, validation
checks and semantic-review status, selected provider endpoints, request timing,
token and tool-use counters, and reported cost. Missing cost
remains unknown. These receipt fields distinguish a contract test from a real
provider call.

Analysis and structured chat answers retain each claim's origin, text origin
and review status, source-versioned quotes with their excerpt IDs and locators,
and numeric origins with source values, units and correction IDs. The saved
analysis keeps its original `dossierId`, `revision` and `inputRevision`; those
may differ from the visible revision that contains it. A notes-only revision
preserves the analysis and receipts. The overview and analysis section expose
the dossier's separate `analysisLineage`, including the revision where the
analysis was generated and why it was carried forward. This does not assert
that a new provider call occurred.

The `securities-report-v2` contract retains a report headline, summary claim IDs
and section claim IDs alongside the accepted narrative. Summaries are joined
from accepted claim text by the server. Deterministic checks and the model's
semantic consistency check are reported separately; the latter is not proof of
financial correctness. The semantic record also retains the verdict on research
gaps and limitations. Research steps record what was actually read, including
unavailable or repeated reads and remaining gaps. Extraction receipts contain
public hashes, reader and representation versions, request identity, read time
and all reported verified-ledger hashes, not local paths or raw documents.

Source summaries retain extraction counts and explicit quality limits such as
`fullTextVerified: false`, unusable pages and pages requiring review. Detailed
page quality is available through `source_quality` to keep catalog responses
bounded. It combines stored assessments with research steps matching the current
source ID and version. `qualityCoverage` reports whether source summaries and
page assessments are available, the assessed page count and the known total.
Missing assessments are `unknown`; an empty page list does not mean all pages
are usable. An available assessment can itself mark a page unusable or OCR text
unreviewed. Fetching a complete original file does not establish that all OCR
text or every financial fact was verified. Source passages preserve their page
headers and public representation hashes when provided by the reader.

Derived evidence preserves each result's `unit` and `calculationKind`.
Inferred noncontrolling profit is a currency difference; ratios retain percent
units, and margin movements use percentage points with all four input
references. No blanket percent unit is applied to derived results.

Supplemental facts retain their original string values or null, source hash,
accounting context, fact ID and verification receipt. A source dash is not
converted into zero. Expert claims retain fact-linked numeric origins, display
scaling, bound page references and individual consistency-check results. Evidence
opening resolves original metrics first, then validated supplementary metrics
in `reportProjection`; an analysis-only metric ID cannot supply a source point.
The `verified_facts` section and overview count use the filtered report facts.
Raw research facts remain in the expert analysis for audit, including rejected
entries. A missing report projection returns `report_unavailable` for report
collections rather than substituting unfiltered evidence.

The existing portfolio `read_portfolio_overview` tool preserves its original
X Nhân `product` field and adds the bounded optional `securitiesProduct` field
with the canonical `/securities` route. Its visible-link verification accepts
the canonical path or the exact locale query generated by the product's route
helper. It rejects other query parameters, mismatched languages and external
targets. It does not claim the local product has been deployed.

## Readiness and completion

The backend derives `reportReadiness` from each saved snapshot. A `ready` or
`limited` report can be exported without human approval. Limits, contradictions
and omitted evidence remain explicit. An `unavailable` report returns
`report_unavailable`; exact-revision matching still applies. When only verified
data and calculations are available, the report explicitly identifies the AI
answer as unavailable. A historical analysis remains labelled historical and
does not trigger a paid rerun merely because it predates the current contract.

Legacy approval is optional. Its tool cannot submit `intent`, `approved`, or
`confirmation` parameters. The optional dialog records approval only through
the application's explicit confirmation for that exact revision. The ordinary
research, reading and export flow does not use this tool.

`stage_securities_corrections` cannot supply `sourceChecked`. A staged correction
records `needs_review`; the automatic report policy can omit affected values
while retaining other supported content. The application can record a source
check when the analyst performs one. Merely opening evidence does not establish
verification, and acknowledging an issue cannot waive missing evidence.

An analysis task can be `running`, `completed`, `failed`, `cancelled`, or
`stale`. Task results retain the input revision, even when analysis creates a
new draft revision. A completed backend task and its visible rendering are
reported separately. Export confirms that artifact bytes were generated and
retrieved. The adapter preserves the controller's `artifact_ready` or
`download_requested` status instead of inferring a browser action from generated
bytes. A requested download does not assert that the file
has finished saving to the user's filesystem. Cancellation does not establish
that a provider request had no charge.

Aborting a WebMCP execution cancels its in-flight controller request and UI
wait. If the backend already accepted a persistent task, that interruption
does not prove task cancellation. Reconcile the saved task by ID and use
`cancel_securities_task` to request cancellation of an accepted task.

The application keeps its server-configured model and permissions. Tools expose
no model override, API key, payment allowance or provider fallback parameter.
Starting analysis or follow-up can incur API cost once the backend's authorized
real-provider mode is enabled. Registration itself makes no model call.

## Verification boundary

Run the focused contract suite with:

```powershell
node --test tests/securities/webmcp.test.mjs
```

The suite executes the actual controller, report policy and domain rules against
a clearly labelled fixture transport. It covers complete research startup,
scope ambiguity, retry without duplicate creation, UI commit waiting, revision
conflicts, task state and cancellation, source-version matching, automatic export
readiness, optional approval, bounded output and registry lifecycle failures.
Sanitized structured-result fixtures cover report references, research steps,
source quality, filtered conclusions, expert provenance, carry-forward behavior,
complete note pagination and internal-field exclusions. These fixtures prove
internal contracts only. They are not evidence of host bridge support,
public-document retrieval, model quality,
or a saved XLSX file.

The real browser integration gate must use the host's discovery and invocation
bridge on localhost. Discover all 15 tools and start research with the appropriate
single-action tool. Confirm that an ambiguous request creates no dossier or
provider task. For a supported request, reconcile the visible state, persisted
task and exact report revision. Read the report, readiness, research steps and
page quality, compare expert evidence, then invoke both exports without an
approval step. Verify returned files and reopen the saved revision after a
reload. Check cancellation, stale inputs, unsupported content, optional legacy
approval and the ordinary UI as separate cases. Actual provider work belongs to
the authorized API phase after local gates pass; fixtures do not satisfy it.

Session-specific browser and file receipts belong outside the repository.
The final delivery report identifies which real bridge calls and artifacts
were observed and which checks, if any, remain blocked.
