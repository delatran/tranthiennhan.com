# Nhân for Securities model and evaluation contract

The application calls only `meta/muse-spark-1.3-contributor` through OpenRouter.
`worker/securities/model.js` exports `analyzeSecurities`, `chatSecurities`,
`searchSecuritiesSources`, and `fetchSecuritiesSource`. The current synthesis
contract is `securities-analyst-report`, with prompt identity
`securities-evidence-guided-analyst`.

These names describe the report format and the prompt's role. Implementation
hashes, immutable dossier revisions and source hashes record the exact inputs
and code used by a recorded evaluation. Manually numbered release labels are
not part of active report generation. The shared `report-contract.js` helper
recognizes earlier persisted report formats without changing their metadata or
bypassing their validation results.

Analysis and chat return a readable report, source-bound claims, research steps,
automatic checks, material evidence gaps, and provider receipts tied to the input
dossier revision. The backend alone persists the result and rejects cancelled or
stale jobs. Report generation does not require a human approval action. Optional
review metadata and older stored analyses remain compatible with the dossier
layer; compatibility does not relabel an old analysis as automatically checked.

## Report and numeric evidence

The raw response has eight closed fields: `dossierId`, `revision`, `action`,
`readRequests`, `claims`, `report`, `gaps`, and `limitations`. Context fields are
constrained to the exact input. A read action contains only source-read requests.
A final action contains the completed report and no pending read requests.

The model writes natural paragraphs and selects their placement. Each claim
appears once in the summary or one of four sections: performance, earnings
quality, cash and funding, or outlook. The server composes the summary from those
accepted claim references and enforces a maximum of 180 words after rendering.
A summary reference repeated in one body section is kept once in the summary;
unknown references, duplicate body placements and omitted claims remain invalid.
The writer and consistency checker must cover every material subquestion in that
summary. A narrow follow-up answers its specific question first; it does not
require an unrelated company overview or growth recap. Exact source quotes and
calculation lineage remain
separate from prose so the interface can reveal evidence on demand.

A company report targets six to eight distinct claims in total, including its
summary, normally one or two short sentences per claim. Narrow follow-ups can
use fewer. This guidance does not change the fourteen-claim hard maximum or
permit omission of a material subquestion. One or two exact passage selectors
per claim are preferred when sufficient; all necessary support and the existing
six-selector maximum remain. The server still resolves the unchanged original
passages and applies every source and numerical check.

Financial quantities use server placeholders such as
`{{metric:revenue:current}}`, `{{metric:revenue:relativeChangePct:movement}}`, and
`{{derived:profit_after_tax_margin:percentagePointChange}}`. The server checks the
metric, verified point state, source version, correction lineage, exact formula,
accounting basis and every input reference before rendering. Compact currency
uses localized billions or trillions; `:exact` preserves greater precision.
Movement placeholders generate the direction and magnitude together. Period
and page placeholders bind to the selected dossier and exact source locator.
Bare page placeholders render their own visible page label. The `:per100` format
is available only for verified same-period derived ratios; the server supplies
the numerator, denominator and normalization scale together.

`shared/securities/finance.js` owns arithmetic. Its derived ledger includes
supported margins, margin changes in percentage points, inferred non-controlling
profit, cash conversion and the disclosed disposal share. The model cannot create
an arbitrary formula or promote a number found in prose to that ledger. A missing
or incompatible input stays unavailable; a negative or zero baseline does not
produce an ordinary growth percentage. Literal numerical text and spelled-out
financial quantities in generated prose, gaps and limitations are rejected.
The typed profit-growth bridge separates the revenue effect at the prior profit
margin from the margin effect at current revenue. Both retain the four verified
inputs and reconcile to the total change. This sequential arithmetic allocation
does not establish a causal business driver.

Natural prose is preserved after placeholder expansion. Deterministic guards
reject known direct metric-label swaps and movement contradictions. They do not
prove every sentence's meaning. A separate request to the same exact model checks
each claim and the report's gaps and limitations against the supplied ledger and
source passages. Its verdict is bound to a SHA-256 identity of the exact report,
source versions and revision. Missing verdicts or mismatched identities fail.

Specific failures can trigger up to two repair rounds. Deterministic repair
feedback includes a bounded, explicitly untrusted rejected draft, the affected
claim ID when available, prior failures and the rendered summary word count.
Generated prose fields are individual paragraphs: embedded control characters,
including tabs and line breaks, produce a specific encoding error before the
numeric check. Their JSON schema applies the same prohibition. Source passages
and retrieval text retain their separate multiline contract. Corrupted prose is
removed from repair feedback, which requests fresh literal Vietnamese from the
immutable evidence; the adapter never guesses or decodes corrupted fragments
into financial prose. Numerical validation and retry limits remain unchanged.
The selected report locale is explicit in writer and repair instructions.
Vietnamese claims, gaps and limitations must retain full diacritics; ASCII
transliteration is restricted to internal source-read queries. A bounded locale
guard rejects an original prose field with at least sixteen letter words when
all those words are ASCII, after excluding validated financial, context and page
placeholders. Source quotations and rendered values cannot supply the missing
diacritics. Short names and labels remain allowed. This detects long unaccented
drafts, not every language or grammar error, and does not rewrite stored reports.
The writer targets 120 rendered words while the 180-word acceptance limit stays
unchanged. A presentation error does not itself prohibit further source reads.
Every repaired result passes the complete validation path again. Claims or notes still
unsupported after repair are omitted and the remaining limitation is stated. A
report must retain a supported factual or computed basis. Accepted claims carry
`automatically_checked` status, while `validation.semantic.method` explicitly
records `same_model_consistency_check`. This is an automatic consistency check,
not independent proof of financial truth or a substitute for source integrity.
Explicit finite term definitions do not replace the named subject when checking
nearby metric labels. The full definition still passes the quantity checks. A
narrow CFO guard rejects asserted collection weakness or insolvency inferred from
negative operating cash flow alone; source review must establish any actual cause.
Known Vietnamese denials such as "không thể kết luận", "chưa có bằng chứng",
and a risk followed by "chưa được xác lập" remain non-assertions within their
clause. Those denials do not support a causal claim when quoted as source
evidence, and they cannot excuse an affirmative clause elsewhere in the report.
Direct negative-current-CFO assertions in a bounded set of Vietnamese and
English forms, including unaccented Vietnamese, must bind verified negative
current `operating_cash_flow` and its source within that same claim. Its evidence
must include current CFO numeric provenance or an exact excerpt whose source,
version and page match the verified current point. Profit-only citations or
another claim's CFO evidence cannot provide this binding. Explicit questions,
unknown signs, sign negations, generic definitions and other-period statements
have separate regression cases. This guard does not classify every financial
sentence. When cash support for profit is asked, writer and checker guidance
requires a direct evidence-backed answer in the summary before ratio detail.
A separate clause guard rejects affirmative earnings-sustainability conclusions
based only on historical performance or disposal adjustments. Later caution
cannot excuse an earlier unsupported assertion. Explicit uncertainty,
conditional hypotheses and accurately attributed issuer expectations retain
their separate source and consistency checks. These guards cover known forms;
they do not establish universal semantic accuracy.

## Autonomous source reading

The backend supplies a `readEvidence` callback to the synthesis adapter. It reads
the locally retained original documents through the scoped source service.
Before drafting, the adapter searches the selected sources for cash-flow context.
The model may then request further reads to resolve accounting attribution,
segments, disposals or other material questions instead of assigning routine
reading to the user.

When a cash-related question has verified negative operating cash flow, the
adapter requests an additional investigation of cash-flow and working-capital
notes. The first required discovery searches the original without page filters;
later page reads can inspect returned locators. It records actual read attempts
and returned coverage. An attempt does
not establish a cause, complete reading or verified numerical values. If the
reader cannot complete the additional work, that gap stays in the report.

Question-driven note profiles also request expense, financial-income and tax
discovery for profitability or earnings-driver analysis, and financial-income,
disposal, transaction and investing-cash discovery for repeatability analysis.
These profiles identify reading needs without supplying company-specific page
numbers, conclusions or new verified values. A read attempt does not establish
that a gain recurs or that remaining core profit is sustainable.

Requests can contain only an existing `sourceId`, exact `sourceVersion`, query,
and page numbers. The model cannot choose a URL, filesystem path, issuer, source
version or service endpoint. Each page filter is checked against the original
page count. The reader returns bounded passages with source and extraction
hashes, page headers, quality information and an exact response checksum.
Mismatched identity, modified packet bytes, duplicate passage IDs, foreign pages,
or inconsistent provenance fail before that evidence reaches a model request.

Returned text is untrusted reference material. It cannot grant tools, change the
task or verify a financial number. Citation selectors use the entire quote field
`{{source_excerpt:EXCERPT_ID}}`; the server resolves one exact passage within its
source and retains its version, locator, extraction method and quality flags.
Unusable OCR cannot be cited. A matched quote proves containment only. Read
coverage and source quality do not assert that the entire document was verified.

The separate verified-fact ledger contains source-checked supplemental financial
cells. The adapter requires the exact canonical fact, original source hash,
ledger and proof receipts, and a returned page covering that fact before making
it available. Existing base metrics and owner corrections are preserved. A prior
CFO on a reported basis cannot be used as the restated comparison selected in
the dossier. All returned verified facts remain auditable even when their basis
makes them unavailable for the current comparison.

An analysis has finite execution boundaries: six planning/drafting rounds,
twelve source reads, four read requests per round, 96 KB of added evidence and
96 passages. Repeated requests or no further progress force a final answer with
the actual remaining gaps. These are execution and context boundaries, not a
session API spend cap. A failed search or unreadable page never establishes that
the issuer did not disclose the information.

Research receipts preserve the actual query/pages, returned passage IDs, original
and extraction hashes, representation identity, source quality and coverage.
Unusable pages are excluded from source passages. Unusable, empty or truncated
reads create server-owned coverage gaps even if the model supplies no limitation;
independently verified financial cells retain their own narrower proof boundary.
Identical topic/reason/impact gaps are displayed once; every source-read step and
receipt remains separate, and distinct limitations are retained.
Progress messages reflect completed reads, drafting and checking operations.
Display callback failures do not erase mandatory provider receipts or replay a
paid request.

Malformed read-query syntax and malformed internal checker reason text share a
separate budget of two technical repairs per analysis. Rejected arguments never
reach the reader; foreign sources, versions, pages and invalid evidence packets
remain fatal. A checker reason repair keeps the exact candidate, narrative hash,
claim IDs and every verdict unchanged. It cannot convert an unsupported verdict
to supported. Internal reasons use English ASCII, while the report keeps the
requested language. Corrupted Unicode is rejected, never decoded by guesswork.
Read-query repair requests fresh plain ASCII queries in the source language;
the original reader and topic matching treat Vietnamese accents insensitively.

## Chat context and credentials

Chat accepts server-loaded history with at most twelve completed
`{ dossierId, revision, user, assistant }` pairs and 48,000 UTF-8 bytes. Every pair
must match the exact dossier and revision. A boolean `historyTruncated` records
when the backend supplied only a recent bounded portion. Invalid context fails
before resolving a key.

The first follow-up also receives the original research question, current notes
and the displayed analysis, including recorded limitations and research gap
topics, reasons and impacts, as untrusted reference context capped at 48,000 UTF-8
bytes. These fields remain optional for older saved analyses; malformed fields or
an oversized context fail without truncating material uncertainty. The writer and
consistency checker receive the same bounded context and history so both assess
the actual follow-up subject. Historical analyses are
excluded. A carried analysis requires the recorded unchanged-input lineage;
foreign, stale or future analysis context fails. Analysis operations omit this
extra chat context. Combined request size is checked before key resolution.
Prior answers and notes can resolve a reference; they never become numeric
authority or permissions.

Both model phases must recheck applicable prior limits against current source
evidence and actual reading scope. An unresolved transaction cash, tax or ownership
allocation must not disappear merely because the follow-up cites an accounting
gain or aggregate profit totals. Newly identified evidence can resolve a prior
limit; the earlier gap is neither permanent truth nor proof of issuer
nondisclosure. This preserves context but does not establish improved live model
quality or replace independent review of the resulting claim.

`SECURITIES_MODEL_MODE=off` is the default. Live requests read only
`SECURITIES_OPENROUTER_API_KEY`, never X Nhân bindings. The local launcher parses
the authorized parent `key.txt` after the required Phase A gates pass. No key
enters browser code, a URL, model data, application logs or receipts.

Provider fallback is disabled. Successful responses must identify the exact
gateway model and a provider. Receipts retain the provider-native deployment
label separately; a dated native label cannot substitute for a different model.
Reasoning is explicitly low and excluded from responses. The output allowance
includes enough space for structured JSON and provider reasoning.

Requests have finite deadlines and size limits, cancellable transport and one
retry for an explicit rate-limit/service rejection without a generation ID.
Generation whose schema permits a final report has a 180-second request deadline.
Such a round can still choose an additional source read. A mandatory read-only
round and the consistency check retain 90-second deadlines. An explicit caller
timeout takes precedence for every phase. The API's 240-second job deadline and
persisted cancellation remain authoritative, so request deadlines do not extend
the overall job. The output cap remains 12,000 tokens, including the provider's
reasoning allocation; concise-writing guidance cannot guarantee that every
generation fits it. A truncated response still fails the unchanged acceptance
checks.
Ambiguous disconnects and timeouts are not replayed automatically. Costs absent
from a provider receipt remain `null`. Every actual transport attempt receives
one local `transportAttemptId`, retained across receipt callbacks and terminal
error handling. Repeated observations of that attempt count once even when a
cancelled request has no provider generation ID. Separate attempts retain
different local IDs, including explicit retries. A local attempt ID does not
prove provider acceptance or establish a charge. Legacy job receipts use their
provider ID, provider label and start time when available; fully anonymous
legacy observations stay separate. Both metadata and model transport use
manual redirects and reject every redirect without following it or forwarding
credentials. The exact key is checked in both the provider envelope and decoded
inner JSON, including escaped output. Raw provider diagnostics are never sent
to the UI. Failed response reads retain only bounded structural diagnostics:
the failure stage, content-type and encoding categories, byte and chunk counts,
end-of-stream status and a prefix category. No body sample, raw header value or
exception message is retained. A stream interruption is distinguishable from
invalid UTF-8, JSON syntax and a wrong envelope shape without changing retry rules.

The optional CLI diagnostic callback records only rejected public-source JSON,
a safe validation branch and receipt in a private QA artifact outside the
repository. It does not retain prompts, raw envelopes, reasoning or secrets. The
application does not enable that callback. Failed outputs cannot become accepted
dossier claims.

## Supplemental web retrieval

The main source workflow downloads official issuer originals and verifies local
parsing/OCR and financial cells. The autonomous analysis loop reads those retained
originals. It does not silently run paid OpenRouter search/fetch tools.

The isolated supplemental adapters use the same exact model and scoped key.
[OpenRouter server tools](https://openrouter.ai/docs/guides/features/server-tools)
are invoked with bounded tool loops. Web search uses Parallel basic and canonical
issuer domains. Candidate URLs must also be present in the response's citations.
They remain discovery leads, not proof of publication date or financial values.

Web fetch explicitly uses the OpenRouter direct engine for HTML and Parallel for
PDFs. There is no automatic engine or model fallback. Acceptance requires actual
tool telemetry and the exact target, plus a citation or exact containment in
independently retained comparison text. That comparison text is held back from
the model. Challenges, incomplete scan content and mismatches remain failures or
partial results. A provider excerpt never proves complete PDF coverage, usable
OCR, table coordinates or accounting correctness.

The chosen contributor model's published description states that prompts and
outputs may be used to improve Meta products. The application does not promise
zero retention. Evaluation cases use public issuer documents; private-source use
requires the relevant data-handling decision. Actual costs and provider labels
come from receipts, not a fixed price assumption.

## Evaluation and historical compatibility

`verify-live-report.mjs` uses the `securities-report-development` protocol. It
freezes the current implementation, report and prompt identities, known
development questions, original source snapshots, canonical ledger manifests,
the hash of [the checked-in acceptance contract](securities-evaluation.md), and
execution limits before resolving a key. It never reads an unseen evaluation
question or its answer key. The four
known cases cover the FPT interim explanation, FPT annual profitability, FPT
parent/consolidated attribution and GMD interim earnings quality. These are team
development cases, not a blind holdout.

Run the local checks without a key or provider call:

```sh
node --test tests/securities/model-evaluation.test.mjs tests/securities/model.test.mjs tests/securities/model-report.test.mjs tests/securities/ux-boundaries.test.mjs
pnpm verify:securities:live --phase-a-receipt <phase-a.json> --output-dir <new-live-receipt-directory> --prepare-only
```

A paid CLI run additionally requires a passed local gate receipt with
`pnpm_check`, `source_pipeline` and `security_boundaries` each passed and
`implementationHash` equal to the current identity returned by
`getLiveReportImplementationIdentity`. From the `website` working directory,
use a new output directory under `../output/securities/receipts/live`; generated
receipts must stay outside `website/output`:

```sh
pnpm verify:securities:live --phase-a-receipt <phase-a.json> --local-gates-receipt <current-local-gates.json> --output-dir <new-live-receipt-directory>
```

The runner preserves incremental per-request receipts, failed attempts, unknown
costs and source-read evidence. Its score covers the exact model, real transport,
closed report contract, numerical coverage, actual local reads and automatic
checks. Independent review against original pages and real browser usability
remain separate observations. Same-model agreement and fixture tests cannot be
reported as independent model-quality evidence.

The retired synthesis protocol and its outputs remain historical evidence.
`verify-live-api.mjs` refuses to run current synthesis under that protocol before
reading a key; explicit supplemental retrieval cases remain available. The
current runner uses `live-receipt-costs.mjs` for cost summaries and has no import
dependency on the historical CLI. Existing stored legacy
analyses retain their original claim text, hashes and status. New analyses use a
new dossier revision and the current report contract.

Historical failures, cancelled attempts, the explicit PDF engine amendment and
the separately hashed coordinate-ordered prose reference remain preserved. The
original source extraction and verified financial cells were not rewritten to
make a failed provider excerpt pass. A later successful rerun does not establish
deterministic reliability. Cost ledgers keep unknown charges separate from known
subtotals and deduplicate copied receipts by local transport attempt identity.
Archival ledgers retain their previous provider generation or operation/attempt/
start-time fallback for receipts created before local attempt IDs were recorded.
