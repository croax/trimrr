# trimrr Agent Instructions

This repository is the public development line for `trimrr`.

## Project Purpose

`trimrr` helps users compare Plex and Emby inventories across one or more self-hosted media servers, find overlapping movies and TV seasons, filter likely cleanup candidates, and produce safe review artifacts before any monitoring or deletion changes happen.

Core intent:

- identify media that exists on more than one server
- suggest cleanup candidates using overlap, size, title filters, watch history, ratings, audience data, and app state
- keep destructive actions gated behind explicit approval artifacts
- produce Markdown, CSV, and JSON evidence for every review, plan, and apply step

## Branch Safety

- Treat `origin/main` as the public source of truth.
- The sibling checkout at `/Users/danielg/Documents/coding/trimrr` has private report-heavy history and is intentionally divergent. Do not merge or push that history into public `main`.
- Use this worktree, `/Users/danielg/Documents/coding/trimrr-public-dev`, for public-facing development.
- Do not commit `reports/`, `.env`, media exports, database snapshots, API keys, Plex tokens, private hostnames, or generated approval/deletion artifacts.

## Code Shape

- The current supported CLI is `npm run audit -- ...`, implemented in `src/audit.mjs`.
- The legacy single-server `node src/index.mjs` path has been removed.
- The package intentionally has no runtime npm dependencies; `src/audit.mjs` uses Node built-ins.
- Keep generated output formats stable where practical: Markdown for review, CSV for spreadsheet use, JSON for machine handoff.

## Verification

Run before claiming completion or pushing:

```sh
npm test
npm audit --omit=dev
git diff --check
```

For documentation-only changes, still run `npm test` and `git diff --check`.

## Documentation Expectations

- README should explain the intent first, then commands.
- `docs/MEDIA-CLEANUP-RUNBOOK.md` should contain operational detail and examples.
- Examples must use placeholders only. Do not include real media titles, real hostnames, real paths from private infrastructure, tokens, or generated reports.
- Keep docs oriented around the user problem: compare overlapping media, review candidates, approve deliberately, then apply safely.
