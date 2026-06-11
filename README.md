# trimrr

`trimrr` helps you find media that is probably safe to remove from one self-hosted library because it already exists somewhere else.

It compares Plex and Emby inventories across one or more media servers, reports overlapping movies and TV seasons, then lets you filter the results by size, title patterns, watch history, ratings, audience data, and remote availability. The goal is to turn "I think these libraries overlap" into a reviewable set of cleanup candidates with enough context to make deliberate decisions.

The tool does not treat overlap as automatic permission to delete. It builds Markdown, CSV, and JSON reports first, records explicit approvals, maps approved items back to Sonarr or Radarr, creates dry-run delete plans, and only then applies monitoring or filesystem changes from those approved artifacts.

Use it when you want to answer questions like:

- Which movies or shows exist on both my main and backup media servers?
- Which large local items also exist remotely and have little or no recent watch activity?
- Which TV seasons are local-only versus already covered by another server?
- How much space could I reclaim if I remove only approved, already-unmonitored items?
- What exact files, app records, and report artifacts prove what changed?

## How It Works

`trimrr` is designed as a conservative review pipeline:

1. Export media inventories from Plex or Emby servers.
2. Compare inventories pairwise to find overlapping movies and TV seasons.
3. Generate filtered cleanup reports using overlap, size, watch, rating, audience, and title-scope context.
4. Record approval decisions in durable JSON, CSV, and Markdown artifacts.
5. Build Sonarr or Radarr plans from those approvals.
6. Apply monitoring changes before deleting files.
7. Generate filesystem delete dry-runs and post-apply verification reports.

## Setup

Install dependencies:

```sh
npm install
```

Run syntax validation:

```sh
npm run check
```

## Configuration

`npm run audit -- ...` commands take configuration through command-line flags so reports are reproducible. `.env` is optional: use it as a local shell-helper file when you work with several Plex or Emby servers repeatedly.

Create a local `.env` from the example:

```sh
cp .env.example .env
```

Then fill in the values for your own servers. The example includes helper variables such as `PRIMARY_PLEX_URL`, `SECONDARY_PLEX_URL`, and `TERTIARY_EMBY_API_KEY`. Those names are not read automatically by the audit script; they are meant to be sourced into your shell so command examples stay repeatable:

```sh
set -a
. ./.env
set +a
```

Do not commit `.env`. API keys, Plex tokens, private hostnames, and exported inventory/report data are local operator material.

Generated reports are written under `reports/` by convention. That directory is ignored because exports and approval artifacts can contain private library contents, watch history, hostnames, and other environment-specific data.

## Common Commands

Compare overlapping media between two servers:

```sh
npm run audit -- plex-export \
  --url "$PRIMARY_PLEX_URL" \
  --token "$PRIMARY_PLEX_TOKEN" \
  --server-name primary \
  --types movie,tv \
  --include-media \
  --out reports/primary-plex.json

npm run audit -- emby-export \
  --url "$SECONDARY_EMBY_URL" \
  --token "$SECONDARY_EMBY_API_KEY" \
  --server-name secondary \
  --types movie,tv \
  --out reports/secondary-emby.json

npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/secondary-emby.json \
  --out-dir reports/overlap
```

`compare-exports` writes `overlap-candidates.md`, `.csv`, and `.json`. The overlap output can be passed into `tv-cleanup-options` or `movie-review` as remote context; it is not approval to delete anything.

For multiple Plex or Emby servers, export each inventory once, then compare pairwise. Put the server you are reviewing as `--local` and each comparison target as `--remote`:

```sh
npm run audit -- plex-export \
  --url "$TERTIARY_PLEX_URL" \
  --token "$TERTIARY_PLEX_TOKEN" \
  --server-name tertiary \
  --types movie,tv \
  --out reports/tertiary-plex.json

npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/secondary-emby.json \
  --out-dir reports/overlap-primary-secondary

npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/tertiary-plex.json \
  --out-dir reports/overlap-primary-tertiary
```

`compare-exports` is pairwise. If you have three or more comparison targets, keep one output directory per pair so the review trail stays clear.

Typical command output is a short terminal summary plus Markdown, CSV, and JSON report files:

```text
Overlap matches: 184
Markdown: reports/overlap/overlap-candidates.md
CSV: reports/overlap/overlap-candidates.csv
JSON: reports/overlap/overlap-candidates.json
```

The generated Markdown reports start with a summary and then a review table. Example overlap rows look like this:

```md
| Type | Local | Local Size | Remote | Match | Extra Remote Matches | Overlap Seasons | Local-Only Seasons |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| movie | Example Movie (2021) | 24.5 GiB | Example Movie (2021) | provider-id | 0 |  |  |
| show | Example Show | 180.2 GiB | Example Show | title-year | 0 | 1, 2 | 3 |
```

Generate a TV cleanup options report:

```sh
npm run audit -- tv-cleanup-options \
  --ssh media-admin@example-host \
  --root /path/to/media/tv \
  --overlap-json reports/overlap/overlap-candidates.json \
  --exclude-regex 'Protected Show|Another Protected Show' \
  --min-candidate-gb 150 \
  --out-dir reports/tv-cleanup-options
```

Run interactive TV approval with Plex watch progress and Tautulli audience counts:

```sh
npm run audit -- tv-approval \
  --cleanup-json reports/tv-cleanup-options/tv-cleanup-options.json \
  --local reports/tv-watch/local-plex-tv.json \
  --tautulli-db reports/tautulli-watch/tautulli.db \
  --priority other \
  --min-candidate-gb 150 \
  --out-dir reports/tv-approval
```

Create and apply Sonarr unmonitoring from an approval file:

```sh
npm run audit -- sonarr-unmonitor-plan \
  --ssh media-admin@example-host \
  --cleanup-json reports/tv-cleanup-options/tv-cleanup-options.json \
  --tv-approval-json reports/tv-approval/tv-approval.json \
  --priority other \
  --out-dir reports/sonarr-unmonitor-plan

npm run audit -- sonarr-apply-unmonitor \
  --ssh media-admin@example-host \
  --plan-json reports/sonarr-unmonitor-plan/sonarr-unmonitor-plan.json \
  --out-dir reports/sonarr-unmonitor-apply
```

Create and apply a season delete plan:

```sh
npm run audit -- season-delete-plan \
  --ssh media-admin@example-host \
  --plan-json reports/sonarr-unmonitor-plan-postapply/sonarr-unmonitor-plan.json \
  --host-root /path/to/media/tv \
  --out-dir reports/season-delete-plan

npm run audit -- season-delete-apply \
  --ssh media-admin@example-host \
  --plan-json reports/season-delete-plan/season-delete-plan.json \
  --host-root /path/to/media/tv \
  --out-dir reports/season-delete-apply
```

For the full process and safety checks, see [Media Cleanup Runbook](docs/MEDIA-CLEANUP-RUNBOOK.md).

## Safety Notes

- Do not commit raw Plex exports, Tautulli database snapshots, `.env`, or generated report artifacts.
- Remote overlap is context only; local removal still requires explicit approval.
- Protected titles and user exemptions must be carried forward into every new cleanup report.
- Never run filesystem deletion directly from a candidate report. Always use the approval, Sonarr/Radarr plan, apply, delete-plan, delete-apply, and post-delete verification sequence.
