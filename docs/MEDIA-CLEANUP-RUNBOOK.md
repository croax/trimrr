# Media Cleanup Runbook

This runbook describes a repeatable cleanup workflow for self-hosted media servers.

## Principles

- Reports are read-only until an approval artifact is created.
- Approval JSON is the source of truth for anything destructive.
- Sonarr or Radarr monitoring is changed before deleting files.
- Deletion only runs from a dry-run plan that has already measured and checked target paths.
- Every destructive step gets a post-apply verification report.
- Remote overlap is context only. A secondary server should not be the only safety condition.

## Protection Checklist

Before each broad scan:

- define protected titles
- define libraries that are out of scope
- define user or household exemptions
- define minimum reclaim thresholds
- carry the same exclusions into every later plan and apply command

Suggested exclude-regex shape:

```sh
'Protected Show|Another Protected Show|Do Not Touch'
```

## Configuration

There are two configuration styles:

- The audit workflow uses explicit flags such as `--ssh`, `--url`, `--token`, `--root`, and `--out-dir`.
- The legacy `node src/index.mjs` Emby/Sonarr workflow loads `.env` from the repository root.

Build `.env` by copying `.env.example` and replacing every placeholder:

```sh
cp .env.example .env
```

Required values:

| Variable | Used By | Description |
| --- | --- | --- |
| `EMBY_SERVER_URL` | `src/index.mjs` | Base URL for the Emby server, for example `http://emby.example.local:8096`. |
| `EMBY_API_KEY` | `src/index.mjs` | Emby API key. |
| `SONARR_SERVER_URL` | `src/index.mjs` | Base URL for Sonarr, for example `http://sonarr.example.local:8989`. |
| `SONARR_API_KEY` | `src/index.mjs` | Sonarr API key. |
| `TRAKT_CLIENT_ID` | `src/index.mjs` | Trakt application client ID for rating lookups. |
| `RATING_THRESHOLD` | `src/index.mjs` | Optional numeric rating threshold. Defaults to `6`. |

Do not commit `.env`, API tokens, raw exports, or generated reports.

## Overlap Comparison Workflow

Use overlap comparison when you want to know which movies or shows exist on more than one media server. This is a read-only workflow. It produces context for later review; it does not approve deletion.

### 1. Export The Primary Server

Plex example:

```sh
npm run audit -- plex-export \
  --url http://primary-plex.example.local:32400 \
  --token primary-plex-token \
  --server-name primary \
  --types movie,tv \
  --include-media \
  --out reports/primary-plex.json
```

Emby example:

```sh
npm run audit -- emby-export \
  --url http://primary-emby.example.local:8096 \
  --token primary-emby-api-key \
  --server-name primary \
  --types movie,tv \
  --out reports/primary-emby.json
```

Use `--library NAME` one or more times if you want to limit the export to specific libraries.

### 2. Export The Secondary Server

```sh
npm run audit -- plex-export \
  --url http://secondary-plex.example.local:32400 \
  --token secondary-plex-token \
  --server-name secondary \
  --types movie,tv \
  --out reports/secondary-plex.json
```

You can compare Plex-to-Plex, Plex-to-Emby, or Emby-to-Emby exports as long as each export was created by `plex-export` or `emby-export`.

### 3. Compare Exports

```sh
npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/secondary-plex.json \
  --out-dir reports/overlap
```

The command writes:

- `reports/overlap/overlap-candidates.md`
- `reports/overlap/overlap-candidates.csv`
- `reports/overlap/overlap-candidates.json`

Matching uses available provider IDs first, then normalized title and year. For TV, the report separates full-season overlap from partial-season overlap and shows local-only seasons.

### 4. Use Overlap As Review Context

Pass the overlap JSON into later read-only review steps:

```sh
npm run audit -- tv-cleanup-options \
  --ssh media-admin@example-host \
  --root /path/to/media/tv \
  --overlap-json reports/overlap/overlap-candidates.json \
  --out-dir reports/tv-cleanup-options

npm run audit -- movie-review \
  --local reports/primary-plex.json \
  --overlap-json reports/overlap/overlap-candidates.json \
  --out-dir reports/movie-review
```

Remote overlap should reduce uncertainty, not replace local review. Keep the approval and deletion-plan sequence in place.

## TV Workflow

### 1. Generate Cleanup Options

```sh
npm run audit -- tv-cleanup-options \
  --ssh media-admin@example-host \
  --root /path/to/media/tv \
  --overlap-json reports/overlap/overlap-candidates.json \
  --exclude-regex 'Protected Show|Another Protected Show' \
  --min-candidate-gb 150 \
  --out-dir reports/tv-cleanup-options
```

This report is read-only. It shows candidate seasons and remote overlap context.

### 2. Add Watch And Audience Context

Use a Plex TV export for episode progress and a Tautulli SQLite snapshot for unique-user audience counts.

The approval prompt supports:

- `a`: remove all seasons for the show
- `o`: remove older seasons only, preserving the latest configured seasons
- `k`: keep/exempt
- `s`: skip
- `q`: quit

For `remove-all`, the workflow unmonitors every numbered season and deletes the local season folders. It does not remove the Sonarr series row itself.

```sh
npm run audit -- tv-approval \
  --cleanup-json reports/tv-cleanup-options/tv-cleanup-options.json \
  --local reports/tv-watch/local-plex-tv.json \
  --tautulli-db reports/tautulli-watch/tautulli.db \
  --priority other \
  --min-candidate-gb 150 \
  --out-dir reports/tv-approval
```

The prompt is compact and color-coded when the terminal supports color. Use `FORCE_COLOR=1` to force ANSI colors, or `NO_COLOR=1` to disable colors.

### 3. Generate Sonarr Unmonitor Plan

```sh
npm run audit -- sonarr-unmonitor-plan \
  --ssh media-admin@example-host \
  --cleanup-json reports/tv-cleanup-options/tv-cleanup-options.json \
  --tv-approval-json reports/tv-approval/tv-approval.json \
  --priority other \
  --out-dir reports/sonarr-unmonitor-plan
```

Review:

- no missing Sonarr series
- no missing Sonarr season rows
- only approved shows
- expected `cleanup_mode`
- expected reclaim total

### 4. Apply Sonarr Unmonitoring

```sh
npm run audit -- sonarr-apply-unmonitor \
  --ssh media-admin@example-host \
  --plan-json reports/sonarr-unmonitor-plan/sonarr-unmonitor-plan.json \
  --out-dir reports/sonarr-unmonitor-apply
```

Immediately generate a post-apply plan:

```sh
npm run audit -- sonarr-unmonitor-plan \
  --ssh media-admin@example-host \
  --cleanup-json reports/tv-cleanup-options/tv-cleanup-options.json \
  --tv-approval-json reports/tv-approval/tv-approval.json \
  --priority other \
  --out-dir reports/sonarr-unmonitor-plan-postapply
```

Proceed only if `Needs unmonitor` is `0`.

### 5. Generate Delete Dry-Run

```sh
npm run audit -- season-delete-plan \
  --ssh media-admin@example-host \
  --plan-json reports/sonarr-unmonitor-plan-postapply/sonarr-unmonitor-plan.json \
  --host-root /path/to/media/tv \
  --out-dir reports/season-delete-plan
```

Review:

- candidate folder count
- blocked entries
- missing entries
- measured reclaim
- approved shows and seasons
- no protected titles

### 6. Apply Filesystem Deletion

```sh
npm run audit -- season-delete-apply \
  --ssh media-admin@example-host \
  --plan-json reports/season-delete-plan/season-delete-plan.json \
  --host-root /path/to/media/tv \
  --out-dir reports/season-delete-apply
```

Immediately generate a post-delete plan:

```sh
npm run audit -- season-delete-plan \
  --ssh media-admin@example-host \
  --plan-json reports/sonarr-unmonitor-plan-postapply/sonarr-unmonitor-plan.json \
  --host-root /path/to/media/tv \
  --out-dir reports/season-delete-plan-postdelete
```

Successful deletion should show:

- delete failures: `0`
- blocked entries: `0`
- post-delete candidate folders found: `0`
- post-delete candidate folders missing: expected deleted count

## Movie Workflow

### 1. Generate Review

```sh
npm run audit -- movie-review \
  --local reports/movie-review/local-movies-plex.json \
  --overlap-json reports/overlap/overlap-candidates.json \
  --min-movie-gb 20 \
  --low-rating-max 6.5 \
  --out-dir reports/movie-review
```

### 2. Record Approval

```sh
npm run audit -- movie-approval \
  --review-json reports/movie-review/movie-review.json \
  --exclude-approval-json reports/movie-approval-previous/movie-approval.json \
  --unwatched-only \
  --min-movie-gb 20 \
  --out-dir reports/movie-approval
```

Use `--priority-rank-max`, `--unwatched-only`, `--remote-overlap-only`, and `--max-items` to constrain review batches.

### 3. Plan And Apply Radarr Deletion

```sh
npm run audit -- radarr-movie-delete-plan \
  --ssh media-admin@example-host \
  --approval-json reports/movie-approval/movie-approval.json \
  --out-dir reports/radarr-movie-delete-plan

npm run audit -- radarr-movie-delete-apply \
  --ssh media-admin@example-host \
  --plan-json reports/radarr-movie-delete-plan/radarr-movie-delete-plan.json \
  --out-dir reports/radarr-movie-delete-apply
```

Generate a post-delete Radarr plan after each apply and verify that approved folders are missing or no longer ready for deletion.

## What Not To Commit

The following are ignored intentionally:

- `reports/`
- `.env`
- raw media-server exports
- local database snapshots
- generated approval and deletion reports

These files can include private library contents, watch history, hostnames, and secrets-adjacent material.
