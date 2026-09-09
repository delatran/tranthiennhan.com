# Security Policy

## Supported surface

Security support covers the current default branch and the current production service at [tranthiennhan.com](https://tranthiennhan.com). Historical deployments, copied instances, modified forks, and unofficial domains are outside the maintained surface.

The relevant scope includes:

- Portfolio routes at `/en` and `/vi`.
- X Nhân routes at `/xnhan` and `/xnhan/about`.
- Same origin application endpoints under `/api/*`.
- Public WebMCP tool surfaces registered by those routes.

## Report privately

Do not disclose a suspected vulnerability in a public GitHub issue, discussion, pull request, or social post.

Email [`tranthiennhan.work@gmail.com`](mailto:tranthiennhan.work@gmail.com) with the subject `Security report for tranthiennhan.com`. Include:

1. The affected route or endpoint.
2. Reproduction steps using the smallest safe request sequence.
3. The observed and expected behavior.
4. Security impact and required preconditions.
5. Redacted evidence that contains no credentials, cookies, private transcripts, or unrelated user data.

Deployable website copies are versioned in [`public/.well-known/security-policy.md`](public/.well-known/security-policy.md) and [`public/.well-known/security.txt`](public/.well-known/security.txt). A production deployment and live endpoint check are required before treating the well known URLs on `tranthiennhan.com` as synchronized with this repository.

## Safe testing boundary

- Test only with data and accounts you control.
- Stop after collecting the minimum evidence needed to explain the issue.
- Do not access, alter, retain, or disclose another person's data.
- Do not perform denial of service, load testing, automated scanning, rate limit bypass, social engineering, or physical attacks.
- Do not trigger repeated AI provider calls or create material provider cost.
- Do not attempt to obtain API keys, Cloudflare credentials, model prompts, or control plane access.

If a test could disrupt production, create external cost, or cross an authorization boundary, report the hypothesis without executing it.

## Response and disclosure

Reports are evaluated based on reproducibility, impact, and affected ownership boundary. Acknowledgment and remediation timing depend on severity and maintainer availability. Coordinate disclosure before publishing technical details.

This personal project does not operate a public bug bounty program and does not promise monetary rewards.
