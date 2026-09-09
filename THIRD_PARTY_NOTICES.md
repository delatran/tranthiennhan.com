# Third Party Notices

This file summarizes the direct package and asset boundaries visible in the repository. It is informational and does not replace the license files shipped by installed packages or the terms published by their owners.

## Direct packages

The exact resolved package graph is recorded in `pnpm-lock.yaml`.

| Package | Resolved version | Copyright or project | Declared license | Upstream |
|---|---:|---|---|---|
| `@fontsource/be-vietnam-pro` | 5.3.0 | Copyright 2021 The Be Vietnam Pro Project Authors | SIL Open Font License 1.1 | [Fontsource](https://fontsource.org/fonts/be-vietnam-pro), [font source](https://github.com/bettergui/BeVietnamPro) |
| `@phosphor-icons/react` | 2.1.10 | Copyright 2020 Phosphor Icons | MIT | [Phosphor Icons](https://github.com/phosphor-icons/react) |
| `react` | 19.2.0 | Copyright Meta Platforms, Inc. and affiliates | MIT | [React](https://github.com/facebook/react) |
| `react-dom` | 19.2.0 | Copyright Meta Platforms, Inc. and affiliates | MIT | [React](https://github.com/facebook/react) |
| `@cloudflare/workers-types` | 5.20260822.1 | Cloudflare and workerd contributors | MIT OR Apache 2.0 | [workerd](https://github.com/cloudflare/workerd) |
| `@vitejs/plugin-react` | 5.0.4 | Copyright 2019 to present, Yuxi Evan You and Vite contributors | MIT | [Vite React plugin](https://github.com/vitejs/vite-plugin-react) |
| `vite` | 6.4.3 | Copyright 2019 to present, VoidZero Inc. and Vite contributors | MIT, with additional bundled dependency notices in the published package | [Vite](https://github.com/vitejs/vite) |
| `wrangler` | 4.127.1 | Copyright 2020 Cloudflare, Inc. | MIT OR Apache 2.0 | [Cloudflare Workers SDK](https://github.com/cloudflare/workers-sdk) |

The published `vite@6.4.3` license artifact also contains notices for bundled code under Apache 2.0, BSD 2 Clause, CC0 1.0, ISC, and MIT terms. Those complete upstream notices, rather than this summary, govern redistributed Vite artifacts.

`worker-configuration.d.ts` is a checked generated type contract produced by Wrangler with workerd runtime declarations. Its embedded Cloudflare, Microsoft, and Apache 2.0 notices remain part of that file and must be preserved when the file is redistributed.

## Personal imagery and organization marks

The raster files under `public/assets` are not covered by a project software license.

- The `portrait-icon-*` files are personal imagery. Their inclusion does not grant permission to reuse, republish, train on, or create derivatives from the photograph. Ownership of the depicted likeness does not by itself establish every right in the underlying photograph.
- The `kienlongbank-symbol-*`, `mercedes-benz-mark-*`, and `ptit-mark-*` files identify organizations mentioned by the portfolio. The names, logos, emblems, and related marks remain the property of their respective owners. Relevant owner pages include [KienlongBank brand identity](https://kienlongbank.com/dinh-vi-thuong-hieu), [Mercedes-Benz legal notice](https://group.mercedes-benz.com/legal-notice/), and [PTIT logo identity](https://ptit.edu.vn/gioi-thieu/tong-quan-hoc-vien/y-nghia-logo-hoc-vien/); none is represented here as an open redistribution license for the local raster files.
- Their appearance is descriptive and does not imply sponsorship, endorsement, partnership, or a general redistribution license.

A future software license must define its scope without silently licensing these images, marks, personal content, or third party material. A notice does not create permission. Anyone publishing a fork is responsible for replacing or obtaining permission for assets they are not authorized to redistribute.
