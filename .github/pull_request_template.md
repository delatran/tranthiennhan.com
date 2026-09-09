## Purpose

Describe the user problem, root cause, and smallest coherent solution.

## Changes

<!-- Summarize the implementation changes. -->

## Verification

List only commands and browser checks actually run, with their results.

- [ ] Focused tests for the changed behavior pass.
- [ ] `pnpm check` passes.
- [ ] `pnpm verify:production` passes when Worker, bindings, generated types, or release gates changed.
- [ ] English and Vietnamese were checked when public copy, metadata, or locale behavior changed.
- [ ] Desktop and narrow mobile states were checked for visible interface changes.

## Impact review

- [ ] No secret, credential, production data, private transcript, or absolute machine path is included.
- [ ] Security, privacy, accessibility, localization, performance, and provider cost impacts are described.
- [ ] `docs/privacy.md` is updated if and only if the data handling contract changed.
- [ ] Generated output, local databases, research packets, and operational receipts are absent from the source payload.
- [ ] This pull request does not assume authorization to deploy or mutate Cloudflare.

## Visual evidence

For interface changes, add redacted before and after captures. Otherwise write `Not applicable`.
