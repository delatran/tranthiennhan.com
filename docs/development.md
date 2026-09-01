# Development Guide

## Prerequisites

- Node.js 24.
- pnpm 11.19.0.
- A Cloudflare account only for Worker parity, remote D1 inspection, migration, or deployment.
- Provider credentials only when intentionally exercising a live X Nhân provider.

Confirm the local toolchain before installing dependencies:

```bash
node --version
pnpm --version
```

## Install

```bash
pnpm install --frozen-lockfile
```

The lockfile is authoritative. Do not replace the frozen install with an unlocked dependency refresh during unrelated work.

## Development modes

### Interface only

```bash
pnpm dev
```

This starts Vite. It is the fastest path for layout, locale, content, and route interface work, but it does not reproduce Worker APIs.

### Worker parity

```bash
cp .dev.vars.example .dev.vars
pnpm dev:cloudflare
```

`pnpm dev:cloudflare` builds the application, applies the checked migrations to Wrangler's local D1 database, and starts `wrangler dev`. Local Wrangler and D1 state is written under `.wrangler` and is not source.

Keep real values only in `.dev.vars`. The example file deliberately contains names without values. A provider request can use external allowance or create cost; run one only when that effect is intentional.

### Built preview

```bash
pnpm build
pnpm preview
```

The build produces `dist`, including localized shells. The preview server serves that built client output and still does not reproduce Worker API behavior.

## Command reference

| Command | Scope | External mutation |
|---|---|---|
| `pnpm dev` | Vite interface | None |
| `pnpm dev:cloudflare` | Local Worker parity | None by default; live provider calls are external requests |
| `pnpm d1:migrate:local` | Apply checked migrations to local D1 | Local `.wrangler` state only |
| `pnpm build` | Production client build and localized shells | None |
| `pnpm preview` | Built client preview | None |
| `pnpm test:content` | Focused content tests | None |
| `pnpm test:worker` | Focused Worker and production config tests | None |
| `pnpm check` | Build plus complete Node suite | None |
| `pnpm check:cloudflare-types` | Wrangler generated type drift check | None |
| `pnpm verify:production` | Full check, type check, and Wrangler dry run | None |
| `pnpm d1:migrations:list` | Remote D1 inspection | Read only, authenticated |
| `pnpm d1:migrate:production` | Remote D1 migration | Production mutation |
| `pnpm deploy:production` | Worker deployment after full gate | Production mutation |

Remote migration and deployment commands require explicit current authorization for the exact production target. A pull request, local pass, or access to credentials is not authorization.

## Test strategy

The suite uses Node's built in test runner and source owned fixtures. It covers:

- Bilingual content and localized shell metadata.
- Contrast, themes, motion, fonts, and interaction contracts.
- Ask Nhân request validation and guarded planning.
- X Nhân provider isolation, ranking, provenance, streaming, and UI state.
- WebMCP schemas, lifecycle, cancellation, result budgets, and privacy boundaries.
- Worker routing, response headers, rate limits, D1 logic, and production configuration.
- Exact repository source inventory and retired path checks.

Real provider credentials are not required for `pnpm check` or `pnpm verify:production`.

## Runtime variables

Local provider development can use these names in `.dev.vars`:

```dotenv
OPENAI_API_KEY=
OPENROUTER_API_KEY=
XNHAN_OPENAI_MODEL=
XNHAN_OPENROUTER_MODEL=
XNHAN_OPENAI_MODEL_DISPLAY_NAME=
XNHAN_OPENROUTER_MODEL_DISPLAY_NAME=
```

Do not commit values, print them in terminal output, paste them into issues, or expose them to the browser. Model display names are UI labels only; they do not change provider routing.

## Review checklist

Before handing off a source change:

1. Read the changed source, its callers, and its nearest tests.
2. Run the smallest focused test while iterating.
3. Run `pnpm check` on the final source.
4. Run `pnpm verify:production` when Worker or deployment contracts changed.
5. Review the complete diff for unrelated edits, secrets, private data, absolute machine paths, and generated residue.
6. Verify both locales and narrow mobile layout for visible interface changes.
7. Remove `node_modules`, `dist`, `.wrangler`, coverage output, and browser artifacts before a source only handoff when a clean tree is required.

Historical research, browser captures, command receipts, and operational snapshots belong outside the publishable website directory unless a specific artifact has been curated as durable public documentation.
