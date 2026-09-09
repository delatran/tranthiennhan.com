# Privacy and data boundaries

This page describes the application boundary for the portfolio, Ask Nhân, X Nhân, and the local Nhân for Securities product. Cloudflare, OpenAI, OpenRouter, OpenRouter-selected upstream providers, and the hosted X-search service may process additional platform or provider data under their own policies; this page does not claim otherwise.

## Browser boundary

- The portfolio does not persist form content. The visible Ask Nhân transcript, X Nhân transcript, bounded activity events, cited-source links, and X Nhân's bounded follow-up context exist in React memory for the current page. Starting a new X Nhân chat, reloading, or leaving the page clears the relevant transcript and follow-up context.
- Browser `localStorage` keeps the visitor's explicit language preference and the Nhân for Securities watchlist. Watchlist entries contain only a selected stock's public symbol, exchange and bounded company names. It contains no provider choice, question, answer, search query, source URL, report content, or activity event. Nhân for Securities can put its opaque dossier ID and revision in the local page URL to reopen that selected revision.
- X Nhân's three starter questions are fixed bilingual copy. They are not fetched, polled, ranked, or stored as a server snapshot. The product has no scheduled retrieval or server-side snapshot for these prompts.
- WebMCP catalogs are route scoped. Portfolio WebMCP exposes only bounded public portfolio controls; its five tools cannot read or submit Ask Nhân chat content, obtain a verification token, call Worker APIs, or deploy code. X Nhân's separate eight-tool closed-schema adapter uses no prior conversation in `standalone` mode; the explicit `visible_conversation` mode submits only the normalized, bounded completed X Nhân context already visible in the current tab. Its search action uses the same Worker API, provider choice, allowance, rate limits, and validation as the visible X Nhân form. X Nhân About exposes exactly two tools: a trusted read-only snapshot of committed public editorial copy and a locale control. Its overview has an empty input schema and cannot expose transcripts, browser storage, provider data, analytics, private prompts, or credentials.

## Ask Nhân

Ask Nhân accepts a bounded same-origin question and visible page locale. A deterministic closed fact catalog and server-side guardrails run before any optional Workers AI plan. The Worker validates the plan's closed fact IDs, relationships, mode, locale, length, and closure before rendering approved bilingual text. The model does not write public prose. The product writes content-free operational metrics and does not put the question, selected fact IDs, answer, or raw User-Agent in application logs.

## X Nhân

X Nhân accepts only the closed request shape `{ locale, query, provider, history }`. `history` is an empty array for a first turn or a strictly normalized, turn-bounded, and UTF-8-byte-bounded list of completed `{ user, assistant }` pairs from the current page. It is sent to the explicitly selected provider only so follow-up references can be resolved. Prior turns are untrusted, are not factual evidence, and never replace fresh retrieval for the current question. The selected application provider is explicit and is never silently replaced. Ordinary page submissions use OpenRouter by default; a deliberate WebMCP request may select OpenAI. Only the requested provider's server-side key is resolved for a turn.

OpenAI requests use the official Responses API and hosted `web_search` limited to `x.com`. OpenRouter requests use the model-agnostic `web_plugin` search transport with a bounded `x.com` domain allowlist. Both adapters receive the same bounded follow-up context for discovery and synthesis, treat it as untrusted reference-resolution data, normalize same-call citations, freeze a request-local evidence catalog, validate the closed `{ state, evidence_ids, answer, answer_source_ids }` synthesis contract, preserve the requested provider/model, and render source blocks owned by the Worker. One same-provider repair is the maximum; a provider error never triggers the other provider. The model's private chain of thought, full provider payload, credentials, internal prompt, and usage object are not returned to the browser.

The application writes content-free X Nhân usage and result-shape metrics. These include provider/model identifiers, operation outcome, duration, token and search-request counts when the provider reports them, retrieval and cited-source counts, number of distinct authors, timestamp coverage and aggregate source age, answer-block count, and answer-source count. They do not include the question, answer, post text, source URL, handle, request ID, IP address, User-Agent, or conversation history.

The actual model IDs and display labels are server-owned Runtime variables. Display labels are UI-only and are never inserted into provider requests, prompts, cache keys, routes, metrics, or logs. The browser cannot override either model or label. Provider-side request storage, caching, retention, routing, pricing, and upstream processing remain controlled by the relevant provider and Cloudflare settings.

## Nhân for Securities

This product has a separate storage contract. Local mode uses its dedicated
`SECURITIES_DB`. Shared production mode maps the existing Cloudflare D1 binding
to separate `securities_*` tables. Those tables store research dossiers, source
metadata, immutable revisions, reasoned edits, review decisions, analysis
results, completed follow-up conversations and job outcomes so work survives
service restarts. This does not change Ask Nhân and X Nhân's in-memory
conversation contracts. Acquired public report originals, parser/OCR outputs
and verification receipts stay outside the publishable source tree.
Public-source access does not imply permission to redistribute full reports.

Shared production history has no account boundary. Everyone who opens the
product can list and read every saved research dossier, including its question,
report revisions and completed follow-up conversation, and anyone can request
its permanent deletion. The interface identifies this shared scope and requires
confirmation. Deletion requires the current head revision, is rejected while a
job for that dossier is running, and removes its revisions, approvals, jobs,
follow-up conversation and content-bearing request records in one database
transaction. An opaque deletion request record containing the request ID,
dossier ID, revision and timestamp remains only for safe retry; it contains no
question, report, source excerpt or chat content. Public mutations are limited
by an anonymous network-derived key, so visitors on one shared network can share
the same limit. The limit is not an identity or permission system.
Deleting a dossier does not delete global processed-source datasets, externally
stored originals, local export files or provider-side records.

The local launcher binds to loopback, serves the built client assets, excludes
production bindings, and loads the Securities key only into this server process
through a private temporary environment file. No key is included in a client
bundle, URL or application log. The local database and exports remain until the
owner removes them. Leaving the browser does not delete a saved Securities dossier.

The watchlist uses the browser key `nhan-securities-watchlist` and stays separate
from those dossiers. Adding or removing a stock changes only that browser's
saved stock identities. If browser storage is unavailable, the list remains in
memory for the current visit. Clearing the key removes the saved watchlist; it
does not delete local dossiers, provider records or source files. The list is
not uploaded as a watchlist. Selecting a saved stock makes the same market
lookup as selecting it from the directory, and starting research follows the
explicit data-sharing boundaries below. Watchlist membership does not change
those boundaries.

Public market browsing uses anonymous VNDIRECT web requests for the stock
directory, selected ticker's quote, daily history and company profile. Only the
fixed exchange filters and selected ticker/dataset parameters are sent upstream.
These requests contain no dossier text, chat history, cookies or model
credentials and do not call an AI model. The local service caches supplementary
snapshots under `../output/securities/runtime/public-market` from the website
directory and labels stale
responses with their original retrieval time. Market rows are not imported into
verified dossier evidence or automatically included in model requests.

Explicit public document research sends the selected stock's identity, optional
question, locale and server-resolved company/exchange source scope to OpenRouter
and Meta. The retrieval providers process its search and selected public URL.
This operation does not send a saved dossier or its conversation history. Its
audit records, provider receipts, public source excerpts and results persist
under `../output/securities/runtime/public-research` from the website directory
until the owner removes them.
When the fetch response lacks source text needed to verify a quotation, the
local service can download the same approved public URL anonymously and compare
its extracted text. The saved source record contains the URL, retrieval time,
original-byte hash, extraction limits and bounded extracted text. The browser
receives source links, matched short excerpts and reading status. These public
downloads do not carry API keys, account cookies or dossier data.
Identical requests can reuse a result for five minutes in server memory. Opening
the directory or refreshing market data never starts this research action.

Live AI analysis of saved dossiers transmits the selected dossier's bounded
financial evidence, follow-up question and bounded conversation history from
that same revision to OpenRouter and Meta using exactly
`meta/muse-spark-1.3-contributor`. Public document research uses that same exact
model. The Contributor offering permits prompts and outputs to be used to
improve Meta products. This application makes no claim of
zero retention or exclusion from model improvement. Test cases use public issuer
sources. A user should consider that processing before including private material.
Provider failures do not trigger another model or provider. Source documents and
retrieval output cannot change the application's tool permissions or key access.

WebMCP uses the same local API and visible dossier transitions as the UI.
Requesting approval opens a confirmation for a particular version; registration
metadata or a model's assertion never counts as the user's review decision.
Exports contain the supported report from the selected revision, with its
evidence and corrections. Server-computed report readiness controls export;
manual approval is optional and cannot override the evidence checks.
Application logs contain neither full questions, report text, model answers nor
credentials. Model cost and usage receipts are distinct from chat content.

## Visitor analytics

The visitor counter accepts only a bounded same-origin body and ignores Global Privacy Control browsers. For accepted visits, the application stores the normalized `CF-Connecting-IP` address together with first and last timestamps, page-view count, coarse Cloudflare location and network fields, device and browser families, portfolio path, referrer host, and bounded campaign fields in D1. Raw visitor rows are limited to a rolling seven-local-date operational window; completed-day aggregates remain separate. The application never exposes raw rows, an owner IP list, or rate-limit keys. The footer exposes only the scalar aggregate count. IP-based counts are network-level estimates, not exact people or devices.

## Cloudflare platform processing

Cloudflare necessarily processes request, network, location, timing, invocation, security, and abuse-prevention metadata. Worker logs and traces follow the active `wrangler.jsonc` observability settings. Application metrics are bounded and content-free. Cloudflare Runtime variables scope model IDs and display labels to immutable Worker versions; editing a Dashboard variable requires its built-in Deploy and applies to new invocations after propagation. A request already in flight keeps its original environment.

## Retention and deletion

Ask Nhân and X Nhân have no chat-content export, prompt reader, deletion token, or application storage copy of submitted questions, answers, or follow-up context. Starting a new X Nhân chat clears its current in-memory transcript; clearing or leaving the browser also removes in-memory UI state. Neither action removes provider-side or platform records. Securities dossiers follow the separate persistent local contract above. Visitor metadata is retained only within the documented short operational window and completed-day aggregate policy. Provider and Cloudflare account retention, legal holds, backups, and recovery copies are governed by their respective control-plane settings.

## Limitations

Hosted X search can be incomplete, delayed, or affected by upstream routing and access. A source-backed result is not a guarantee that every character mirrors the original post or that the retrieved set is a complete timeline. Satire, recycled posts, and misleading attribution can still occur; the fixed prompts use current-topic discovery wording and the UI keeps links to the original items for inspection.
