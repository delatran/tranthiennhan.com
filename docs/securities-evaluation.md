# Nhân for Securities evaluation contract

This document defines acceptance for the current research workspace. The live
report evaluator freezes its SHA-256 hash before execution, together with the
implementation, selected questions, original-source identities and model
settings. A change to this document creates a different recorded evaluation;
existing protocols, observations and failed attempts remain unchanged.

## User outcome

A reader should be able to investigate a Vietnamese listed company, understand
what changed in its results, inspect the supporting evidence and retain the
result. Financial knowledge should help the reader explore further without
being a prerequisite for the first useful answer.

The required journey is company or question, visible scope, actual research,
readable result, optional evidence inspection, exact-revision export and resume.
The interface must preserve company identity, accounting period and data
freshness through that journey. Expert controls remain available without adding
mandatory approval steps to ordinary research.

Public-market research and verified financial reporting have different evidence
boundaries. A directory entry or readable web excerpt does not establish a
verified financial dossier. The result must communicate the applicable boundary
where it affects the reader's decision.

## Fixed development questions

The executable questions and required metric IDs live in
`scripts/securities/verify-live-report.mjs`. Its current cases cover:

| Case                       | Scope                                          | Required evidence and explanation                                                                                                               |
| -------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `fpt-h1-friendly`          | FPT interim results, Vietnamese                | Explain performance, whether profit converts to operating cash, and the material uncertainty. Include verified profit and cash-flow magnitudes. |
| `fpt-annual-profitability` | FPT annual comparison, Vietnamese              | Explain profitability with revenue, gross profit and after-tax profit; distinguish arithmetic changes from an established cause.                |
| `fpt-h1-attribution`       | FPT consolidated and parent profit, Vietnamese | Explain the attribution difference with the proper comparison and consolidation scope.                                                          |
| `gmd-h1-earnings-quality`  | GMD interim results, English                   | Explain the disposal gain, its share of financial income, available cash evidence and the limits on claims about repeatability.                 |

These are known development regressions. They are not a blind holdout and do not
estimate general accuracy across issuers. Their baseline is the deterministic
financial ledger constructed from the pinned source cells. A new independent
question or financial review must be recorded separately from these cases.

## Acceptance checks

| Boundary             | Required observation                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company and period   | The result matches the selected issuer, financial period, comparison and immutable dossier revision. Ambiguous or conflicting input stops before a model call.                                                                  |
| Financial arithmetic | Numbers in prose bind to verified inputs or recomputed calculations. Units, denominators, accounting scope and restatements remain compatible. Missing values never become zero.                                                |
| Source provenance    | Claims retain the exact source hash, document revision and locator. A quote must occur in the returned original-source passage. Reading or OCR alone never promotes a number to verified status.                                |
| Meaning              | The summary answers each material part of the question in plain language within the implemented word limit. A ratio is not a causal explanation, and a disposal adjustment is not proof of recurring earnings.                  |
| Source reading       | Receipts identify actual attempted reads, returned pages, content quality and remaining gaps. An unexecuted read or an inaccessible excerpt cannot prove that an issuer omitted a disclosure.                                   |
| Report checks        | The closed response contract, source and metric bindings, narrative identity and consistency verdicts pass. Unsupported content is omitted or retained as a precise limitation. Human approval cannot override evidence checks. |
| Follow-up            | A follow-up resolves the subject from the current displayed analysis and notes. Historical answers and user annotations remain untrusted context.                                                                               |
| Lifecycle            | Cancellation, repeated submissions, reloads and stale responses preserve the exact dossier context. An uncertain provider response is not automatically replayed.                                                               |
| Export and resume    | The selected revision opens again and exports the same accepted claims, values, formulas and source trail. Spreadsheet values and formulas are checked by an appropriate parser or application.                                 |
| Privacy              | Credentials stay server-side. Provider errors, source content and tool results cannot expose credentials or grant permissions. Existing portfolio-product privacy contracts remain intact.                                      |
| Interface            | Desktop and narrow mobile layouts work in both locales, with keyboard access, visible focus and reduced-motion behavior. Loading, empty and unavailable states match actual service state.                                      |

Negative cases must cover wrong issuer or revision, incompatible accounting
bases, mixed units, stale source hashes, tampered calculations, unverified or
unusable OCR, source instructions, invalid provider output, unknown costs,
interrupted requests, failed receipt persistence and export exclusions.

## Local checks

```sh
pnpm check
pnpm test:securities
```

`pnpm check` builds the product and runs the repository tests. Focused tests use
explicit fixtures for provider, transport and failure behavior. Fixture success
does not establish that a real provider or source request succeeded.

Browser behavior, source downloads, original-page inspection, native spreadsheet
validation and real provider requests require their own observed results. Record
the source or implementation identity, command or action, outcome and material
limits. A failed required check remains incomplete even if another check passes.

## Recorded live evaluation

The evaluator requires the local acceptance receipt named by
`--phase-a-receipt`. Its gates are `pnpm_check`, `source_pipeline`,
`browser_workflow`, `webmcp_bridge`, `export_roundtrip` and `security_boundaries`.
A run with provider calls additionally requires `--local-gates-receipt`, whose
`pnpm_check`, `source_pipeline` and `security_boundaries` results pass and whose
`implementationHash` equals `getLiveReportImplementationIdentity()`.

Prepare a new protocol without reading a key or making a network request:

```sh
pnpm verify:securities:live --phase-a-receipt <phase-a.json> --output-dir <new-receipt-directory> --prepare-only
```

When provider testing is authorized, run the recorded cases:

```sh
pnpm verify:securities:live --phase-a-receipt <phase-a.json> --local-gates-receipt <current-local-gates.json> --output-dir <new-receipt-directory>
```

Output directories must be new children of
`../output/securities/receipts/live/`. `--case <case-id>` selects one defined
case. The exact gateway model remains `meta/muse-spark-1.3-contributor`.
Execution limits bound individual analyses and context; they are not a separate
monetary test budget or authorization to spend.

Each recorded run retains the actual provider outcome, requested and returned
model, usage, known or unknown cost, source reads, report checks and implementation
identity. Current cost aggregation has no dependency on the retired synthesis
CLI. Failed attempts and earlier protocols retain their original identifiers and
bytes; a later successful run does not erase them.

## Evidence interpretation

`contract_checks_passed` means the executable checks for that exact case passed.
It does not imply independent financial review, a blind model-quality result,
investment performance, deployment or production readiness. Same-model
consistency checking is a useful gate with its own limits.

Independent review must compare accepted claims, accounting interpretations and
exported values with the original pages. Release or portfolio claims should name
the checks actually observed and any material gaps. General model-quality claims
require a separately frozen representative evaluation with uncertainty and a
baseline, beyond this development suite.
