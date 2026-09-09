# Portfolio Website Operating Contract

This project folder is the source of truth for Trần Thiện Nhân's bilingual portfolio and its Ask Nhân assistant.

## Runtime and infrastructure

- The canonical production target is the Cloudflare Worker `tran-thien-nhan-portfolio` on `tranthiennhan.com`. `www.tranthiennhan.com` resolves to the canonical apex. Do not introduce OpenAI Sites, Cloudflare Pages, a staging Worker, or another hosting path unless the owner explicitly changes this decision.
- Use the relevant `cloudflare:*` skill and the connected Cloudflare MCP tools for every domain, DNS, Workers, D1, Workers AI, deployment, observability, performance, security, or billing task. At the start of such a task, verify that the Cloudflare plugin/MCP connection is actually available; never claim live state from repository text alone.
- Treat `wrangler.jsonc` as the deployment configuration source of truth. The default Wrangler environment is production by design; do not add a staging environment implicitly.
- Cloudflare MCP authentication is workspace-owned. Never commit Cloudflare tokens, account credentials, OAuth material, `.dev.vars`, or `.env` files. Do not replace a missing MCP connection with an unscoped API key.
- Read-only production inspection is the default. A production mutation, deployment, DNS change, D1 write/migration, secret change, or permission change requires explicit authorization in the current task for the exact target.

## Reproducible workflow

- Use Node.js 24 and `pnpm@11.19.0`.
- Install local dependencies with `pnpm install --frozen-lockfile`.
- This directory is the exact GitHub repository root. Keep `.gitignore`, `.gitattributes`, the curated `.github` files, and public repository documentation synchronized with the source contract. Git metadata may be initialized here when explicitly requested, but never initialize or stage any parent directory. Keep research packets, uncurated QA or browser captures, operational receipts, and Codex cloud bootstrap scripts outside this repository; reviewed assets may remain when they are deliberate public documentation.
- Use `pnpm dev` for Vite UI work and `pnpm dev:cloudflare` when Worker/API parity is required.
- Before handing off any source change, run `pnpm check`.
- Before any production deployment, run `pnpm verify:production`. This must complete the production build, all tests, and a Wrangler dry run without mutating Cloudflare.
- Run `pnpm deploy:production` only when the current task explicitly authorizes deployment to `tranthiennhan.com`.

## Production deployment contract

Before deployment:

1. Inspect the current Worker deployment, routes, relevant bindings, and zone/DNS state with Cloudflare MCP.
2. Record the active deployment/version as the rollback target.
3. Review the complete local diff and run `pnpm verify:production`.
4. Preview the intended source/config delta and confirm that no unrelated Cloudflare resource will change.

After deployment:

1. Verify the new active deployment/version through Cloudflare MCP.
2. Verify `https://tranthiennhan.com`, `https://www.tranthiennhan.com`, `/en`, `/vi`, `/api/health`, and the changed user journey.
3. Check browser console output for desktop and mobile UI changes and inspect relevant Worker logs for API changes.
4. If a production verifier fails, stop further mutation and roll back to the recorded version with Wrangler/Cloudflare MCP, then verify the rollback.

## Product and design boundaries

- Match the selected "Kinetic Atelier" concept with the approved "Warm Forest + Moss Signal" color direction: willow off-white canvas, oversized near-black warm-forest typography, `#1C3C1E` inverse surfaces, `#225926` primary actions, muted `#6C9264` moss signal imagery, thin low-chroma green rules, and an asymmetric Swiss-inspired layout. Do not reintroduce electric lime, chartreuse, or independent teal accents. Implement color through semantic tokens; moss is a restrained accent, not body text. On dark surfaces, use the lighter moss role rather than forcing the base moss into small text.
- Before substantial visual changes, use the Product Design plugin when the intended visual source is unclear. When implementing from an approved mock, treat it as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.
- The public portfolio is employer-neutral and must not be framed for a single company or industry.
- Support English and Vietnamese as first-class locales at `/en` and `/vi`. Never choose a locale from IP geolocation; an explicit visitor choice wins.
- Keep the product name exactly `Ask Nhân`. It exists only as a persistent bottom-right chat launcher and popup, collapsed on initial load. Do not add an in-page project card, explainer, hero/contact CTA, navigation item, dedicated section, or AI Lab page for it.
- Do not publish or link a resume. Do not invent biography, employers, project metrics, awards, contact details, or resume facts. Use verified source material only.
- Describe Ask Nhân truthfully as the currently deployed Cloudflare Workers AI implementation. The application must not persist question text, answer text, or chat history in storage, browser persistence, analytics, or application logs. Keep the rate-limit, fallback, public-source grounding, and privacy behavior unless the owner explicitly authorizes another contract change.
- Treat `docs/privacy.md` as the durable application data-handling contract. Keep it synchronized with Worker, UI disclosure, schema, and owner-tool changes; do not store transient production row counts or dated verification receipts in that document.

## Verification expectations

- Source-only review is insufficient for UI changes. Verify desktop and mobile behavior on both locale routes, capture the changed state when practical, and check the browser console.
- Cover changed Worker behavior with Node regression tests. Do not write prompt or answer text into production storage or application logs.
- A passing dry run does not prove a production deployment. A successful deployment does not prove the website, DNS, AI response, privacy boundary, or browser UX until the corresponding live verifier has been observed.
