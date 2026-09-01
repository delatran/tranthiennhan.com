# Privacy and data boundaries

This page describes the application boundary for the portfolio, Ask Nhân, and X Nhân. Cloudflare, OpenAI, OpenRouter, OpenRouter-selected upstream providers, and the hosted X-search service may process additional platform or provider data under their own policies; this page does not claim otherwise.

## Browser boundary

- The portfolio does not persist form content. The visible Ask Nhân transcript, X Nhân transcript, bounded activity events, cited-source links, and X Nhân's bounded follow-up context exist in React memory for the current page. Starting a new X Nhân chat, reloading, or leaving the page clears the relevant transcript and follow-up context.
- The site may keep only the visitor's explicit language preference in `localStorage`. It contains no provider choice, question, answer, search query, source URL, or activity event.
- X Nhân's three starter questions are fixed bilingual copy. They are not fetched, polled, ranked, or stored as a server snapshot. The product has no scheduled retrieval or server-side snapshot for these prompts.
- WebMCP catalogs are route scoped. Portfolio WebMCP exposes only bounded public portfolio controls; its five tools cannot read or submit Ask Nhân chat content, obtain a verification token, call Worker APIs, or deploy code. X Nhân's separate eight-tool closed-schema adapter uses no prior conversation in `standalone` mode; the explicit `visible_conversation` mode submits only the normalized, bounded completed X Nhân context already visible in the current tab. Its search action uses the same Worker API, provider choice, allowance, rate limits, and validation as the visible X Nhân form. X Nhân About exposes exactly two tools: a trusted read-only snapshot of committed public editorial copy and a locale control. Its overview has an empty input schema and cannot expose transcripts, browser storage, provider data, analytics, private prompts, or credentials.

## Ask Nhân

Ask Nhân accepts a bounded same-origin question and visible page locale. A deterministic closed fact catalog and server-side guardrails run before any optional Workers AI plan. The Worker validates the plan's closed fact IDs, relationships, mode, locale, length, and closure before rendering approved bilingual text. The model does not write public prose. The product writes content-free operational metrics and does not put the question, selected fact IDs, answer, or raw User-Agent in application logs.

## X Nhân

X Nhân accepts only the closed request shape `{ locale, query, provider, history }`. `history` is an empty array for a first turn or a strictly normalized, turn-bounded, and UTF-8-byte-bounded list of completed `{ user, assistant }` pairs from the current page. It is sent to the explicitly selected provider only so follow-up references can be resolved. Prior turns are untrusted, are not factual evidence, and never replace fresh retrieval for the current question. The selected application provider is explicit and is never silently replaced. Ordinary page submissions use OpenRouter by default; a deliberate WebMCP request may select OpenAI. Only the requested provider's server-side key is resolved for a turn.

OpenAI requests use the official Responses API and hosted `web_search` limited to `x.com`. OpenRouter requests use the model-agnostic `web_plugin` search transport with a bounded `x.com` domain allowlist. Both adapters receive the same bounded follow-up context for discovery and synthesis, treat it as untrusted reference-resolution data, normalize same-call citations, freeze a request-local evidence catalog, validate the closed `{ state, evidence_ids, answer, answer_source_ids }` synthesis contract, preserve the requested provider/model, and render source blocks owned by the Worker. One same-provider repair is the maximum; a provider error never triggers the other provider. The model's private chain of thought, full provider payload, credentials, internal prompt, and usage object are not returned to the browser.

The application writes content-free X Nhân usage and result-shape metrics. These include provider/model identifiers, operation outcome, duration, token and search-request counts when the provider reports them, retrieval and cited-source counts, number of distinct authors, timestamp coverage and aggregate source age, answer-block count, and answer-source count. They do not include the question, answer, post text, source URL, handle, request ID, IP address, User-Agent, or conversation history.

The actual model IDs and display labels are server-owned Runtime variables. Display labels are UI-only and are never inserted into provider requests, prompts, cache keys, routes, metrics, or logs. The browser cannot override either model or label. Provider-side request storage, caching, retention, routing, pricing, and upstream processing remain controlled by the relevant provider and Cloudflare settings.

## Visitor analytics

The visitor counter accepts only a bounded same-origin body and ignores Global Privacy Control browsers. For accepted visits, the application stores the normalized `CF-Connecting-IP` address together with first and last timestamps, page-view count, coarse Cloudflare location and network fields, device and browser families, portfolio path, referrer host, and bounded campaign fields in D1. Raw visitor rows are limited to a rolling seven-local-date operational window; completed-day aggregates remain separate. The application never exposes raw rows, an owner IP list, or rate-limit keys. The footer exposes only the scalar aggregate count. IP-based counts are network-level estimates, not exact people or devices.

## Cloudflare platform processing

Cloudflare necessarily processes request, network, location, timing, invocation, security, and abuse-prevention metadata. Worker logs and traces follow the active `wrangler.jsonc` observability settings. Application metrics are bounded and content-free. Cloudflare Runtime variables scope model IDs and display labels to immutable Worker versions; editing a Dashboard variable requires its built-in Deploy and applies to new invocations after propagation. A request already in flight keeps its original environment.

## Retention and deletion

The application has no chat-content export, prompt reader, deletion token, or application storage copy of submitted questions, answers, or follow-up context. Starting a new X Nhân chat clears its current in-memory transcript; clearing or leaving the browser also removes in-memory UI state. Neither action removes provider-side or platform records. Visitor metadata is retained only within the documented short operational window and completed-day aggregate policy. Provider and Cloudflare account retention, legal holds, backups, and recovery copies are governed by their respective control-plane settings.

## Limitations

Hosted X search can be incomplete, delayed, or affected by upstream routing and access. A source-backed result is not a guarantee that every character mirrors the original post or that the retrieved set is a complete timeline. Satire, recycled posts, and misleading attribution can still occur; the fixed prompts use current-topic discovery wording and the UI keeps links to the original items for inspection.
