# Public stock research

The local Securities workspace loads a searchable directory of stocks on HOSE,
HNX and UPCoM, with the latest returned quote, recent daily history and company
information. These reads use anonymous public VNDIRECT web endpoints through the
local Node service. The market-data path requires no Python environment or SDK.
Start it with the normal [local launcher](securities.md#run-locally).

Choose a stock by ticker or company name and filter by exchange when needed.
Search ignores Vietnamese accent differences. The selected stock keeps its
ticker, exchange and company identity together.
Ordinary directory and market-data reads do not call the AI model. Public
document research is a separate explicit action described below.

## Coverage and source

The source is [VNDIRECT Dstock](https://dstock.vndirect.com.vn/). The local service
uses only three fixed HTTPS routes on `api-finfo.vndirect.com.vn`:

| Data            | Public route           | Application behavior                                                                                                                     |
| --------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Stock directory | `/v4/stocks`           | Fetch all advertised pages for `STOCK`, `listed` and each of HOSE, HNX and UPCoM.                                                        |
| Latest quote    | `/v4/stock_prices`     | Request the latest dated row for the selected ticker, including the provider's date and available clock time.                            |
| Daily history   | `/v4/stock_prices`     | Request up to 300 recent daily rows, exclude the current Vietnam calendar date, and sort the retained dates for the closing-price chart. |
| Company profile | `/v4/company_profiles` | Request the selected company's names, identifiers, available address, website, description and other supported profile fields.           |

The directory is not an index-constituent sample. It excludes other security
types and statuses using the provider's filters. Each exchange has its own
expected count, received count and completeness status. Missing pages, changed
pagination, invalid identities or duplicate symbols prevent a complete result.
The UI exposes incomplete or unavailable coverage instead of substituting a
small example list. Counts are observations from the returned source, not a
fixed market size or an independent reconciliation with the exchanges.

The browser cannot supply an upstream URL, source override or account token.
The local service sends bounded anonymous GET requests without cookies or
authorization headers. Redirects and access-denied responses are reported as
unavailable. It does not authenticate to, or bypass restrictions on, a provider.

## Freshness, units and caching

| Data            | Local cache lifetime |
| --------------- | -------------------- |
| Directory       | 15 minutes           |
| Latest quote    | 30 seconds           |
| Daily history   | 15 minutes           |
| Company profile | 6 hours              |

The selected quote refreshes every 30 seconds while the quote dataset is
selected, its market panel is open and the browser tab is visible. Refresh pauses
during source research. Only the selected ticker is requested; there is no
background quote sweep across the directory. Refreshing can return a cached or unchanged
upstream row. This interval is an application refresh policy, not a verified
source update frequency, delay guarantee or real-time market-data service.

Retrieval time and source time have different meanings. `fetchedAt` records when
the local service acquired a snapshot. A quote retains the provider's separate
date and clock time; its clock timezone is unverified and remains
`source_local_unspecified`. The adapter does not invent a UTC quote timestamp.
The company endpoint has no verified content-update timestamp, so its `asOf`
remains null even after a fresh retrieval.

Daily history excludes every row dated today in `Asia/Ho_Chi_Minh`, including
after market close. This avoids presenting an intraday row as a completed daily
bar without a verified session calendar. A 300-row response that includes today
usually yields at most 299 retained bars. Returned row counts, omitted history,
duplicates and invalid values remain explicit in the response metadata.

Price, volume and transaction-value scales for these exact endpoints are not
verified. They remain `unknown`; the adapter preserves finite source numbers
without applying a currency or lot multiplier. Percentage change is labelled
as percent. Matched volume and value remain separate from put-through volume
and value. Missing or invalid numbers remain missing, while zero remains zero.
Units documented by another VNDIRECT screen or a former SDK do not establish
the units of these responses.

One anonymous market operation runs at a time, including a complete directory
fetch. Identical concurrent requests share that operation. A different uncached
request receives a busy result or an explicitly stale retained snapshot. Starts
are at least one second apart; an operation has a 45-second deadline, and a
failed request has a 30-second retry backoff.

A failed refresh can retain a snapshot less than seven days old with its
original retrieval time and a stale notice. A partial directory refresh does
not replace a usable complete saved directory. Older snapshots are unavailable.
Market snapshots are stored under `../output/securities/runtime/public-market/`
relative to the website directory. If a cache write fails, the response marks
the snapshot as not persisted rather than claiming it will survive a restart.

## Explicit public document research

The market panel offers **Find public sources** (**Tìm nguồn công khai**) for
the selected stock. For a stock outside the processed dossier catalog, the main
form also offers this action for the current question. The selected stock remains
selected, and unavailable dossier periods are hidden.
The source-research action requires the launcher's live model configuration and
uses exactly `meta/muse-spark-1.3-contributor`. Selecting a stock, opening the
directory, reading a quote or refreshing the page does not trigger it. A request
contains the selected ticker, exchange, optional question and locale. The server
resolves company identity and source domains from its directory, profile and
known issuer catalog. It does not accept a caller-provided URL or domain list.

Research searches the resolved company and exchange domains for original
disclosures or company pages. The search request configures at most two tool uses
and accepts at most four discovery links. In the local runtime, the independent
reader tries every accepted link in its recorded order, within the existing
source and operation limits. A readable navigation page does not prevent trying
the remaining candidates. Each attempt and its access outcome is retained.

The local source text must be validated and persisted before the extraction
request starts. One extraction request receives the available source packets
under an aggregate context limit, with retrieval tools disabled. The model
selects one supplied source URL and a continuous quotation from that source's
provided text. Source identities, extraction limits, canonical redirects and
context truncation remain explicit. The application requires quotation
containment in the chosen packet after NFKC normalization and collapsed
whitespace; a passage from another packet cannot establish that binding.
Unmatched passages are withheld. Public discovery caveats use fixed localized
text; free-form discovery prose remains private audit data and cannot establish
a filing period or financial fact.

The service also retains a provider-only path for callers without the independent
reader. It attempts the first accepted link with `openrouter:web_fetch`, the
Parallel engine, one tool step, one use and a 20,000-token content limit. This
path requires observed tool execution and matching provider-returned citation
content for the exact URL. Tool configuration alone does not establish a usable
read. Links not attempted remain unread, and failed searches, unreadable scans,
challenge pages and incomplete reads retain explicit limitations.

The independent source reader validates and pins public DNS addresses for TLS
on every request. It sends no cookies or credentials. At most three HTTPS
redirects are allowed within the same host or its `www`/bare-host alias; each hop
is URL-checked and DNS-pinned again. Cross-issuer targets, private addresses,
redirect loops and insecure redirects are rejected. Requested and resolved URLs
remain separate in the access record. It accepts static HTML up to 2 MiB and PDFs up to 8 MiB, with a
20-second deadline. HTML scripts and styles are not executed. PDF extraction
reads text from at most the first 20 pages of documents no longer than 300 pages;
it performs no OCR. Extracted text is bounded to 250,000 characters, and truncated
text or page coverage remains partial. A matching quotation from a partial
extraction can be displayed with that limit, but does not become a complete read.

The result contains source links, reading status and short excerpts. Its
`public_reading_unverified` evidence status remains unchanged even when the
operation is `ready`: that status means at least one excerpt passed the public
reading checks. It does not verify an entire filing, establish financial figures
or create an investment conclusion. Public market rows and research excerpts
are not imported into the dossier's verified financial evidence.

Only one public-research operation runs at a time. Identical normalized
ticker/exchange/question/locale results are reused for five minutes in memory;
other concurrent research requests receive a busy response. The operation has a
three-minute deadline and supports cancellation. It never switches model or
provider after a failure.

Audit records, provider receipts, source excerpts and results persist under
`../output/securities/runtime/public-research/`. Audit storage must succeed before
a paid request starts. This saved evidence is separate from the short-lived
in-memory response cache and from dossier versions. The optional question and
selected stock context are sent to the configured AI and retrieval providers
only for this explicit action; see the [privacy contract](privacy.md#nhân-for-securities).
An independent downloaded-source record stores bounded extracted text, its
exact URL, retrieval time, original-byte hash and extraction limits in a private
sidecar file. It must be validated and persisted before its quotation can be
delivered. The operation audit retains only the source metadata and file pointer.

The existing document-backed dossier workflow retains its own supported issuer,
period, source-version, calculation and report-readiness checks. Availability in
the public directory does not claim a verified financial dossier exists for
every listed company.

## Verification

From the website directory:

```powershell
node --test tests/securities/market-data.test.mjs tests/securities/market-frontend.test.mjs
node --test tests/securities/market-research.test.mjs
node --test tests/securities/market-source-reader.test.mjs tests/securities/market-research-service.test.mjs
pnpm check
```

Fixtures cover request and response validation, stock identity, directory
pagination, cache reuse, concurrency, stale fallback, missing versus zero
values, history boundaries and local bridge behavior. Browser checks and live
anonymous-source or paid-model receipts are separate evidence. A passing fixture
does not establish current upstream availability, complete exchange coverage,
verified units or source latency.
