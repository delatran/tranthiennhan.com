# Contributing

Thank you for taking the time to improve `tranthiennhan.com`. This repository is the owner maintained source for a live personal portfolio, so changes must preserve its public facts, privacy boundaries, accessibility, bilingual experience, and production safety contract.

## Before contributing

No project level software license has been selected yet. Bug reports and focused proposals are welcome, but do not submit code or asset pull requests unless the maintainer has invited the work or a repository license has been added that permits contributions.

Use the issue forms for reproducible bugs and concrete feature proposals. Security vulnerabilities must follow [`SECURITY.md`](SECURITY.md) and must never be posted publicly.

## Local setup

Use Node.js 24 and pnpm 11.19.0.

```bash
pnpm install --frozen-lockfile
pnpm dev
```

The Vite server exercises the interface without Worker parity. For intentional Worker development, copy `.dev.vars.example` to `.dev.vars`, keep all real values local, and run:

```bash
pnpm dev:cloudflare
```

The command builds the client, applies checked migrations to Wrangler's local D1 database, and starts the Worker. Provider backed calls are not required for the automated tests and can consume external allowance or cost.

## Change quality bar

Keep each change focused on one user visible outcome or one root cause. Before handoff:

```bash
pnpm check
```

Also run `pnpm verify:production` when changing Worker behavior, bindings, deployment configuration, generated Cloudflare types, or release gates. This command performs a dry run and does not deploy.

Additional expectations:

- Add or update regression tests for changed behavior.
- Verify both English and Vietnamese when public copy, locale routing, metadata, or navigation changes.
- Verify desktop and narrow mobile layouts when the interface changes.
- Preserve keyboard navigation, visible focus, reduced motion behavior, and semantic labels.
- Keep Ask Nhân as a collapsed bottom right launcher and popup.
- Keep X Nhân provider selection explicit, with no silent fallback.
- Keep questions, answers, post text, source URLs, credentials, and conversation history out of application logs and analytics.
- Update `docs/privacy.md` only when the actual data handling contract changes.
- Keep generated output, local databases, screenshots, research packets, and operational receipts outside the source tree unless they are deliberate public documentation.

## Pull request notes

An invited pull request should explain:

1. The user problem and root cause.
2. The exact source and contract changes.
3. Verification commands actually run and their results.
4. Accessibility, privacy, security, localization, and provider cost impact.
5. Before and after screenshots for visible interface changes, with sensitive data removed.

A pull request is not authorization to deploy, migrate D1, modify secrets, change DNS, or mutate any other production resource.
