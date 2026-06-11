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

The audit workflow uses explicit flags such as `--ssh`, `--url`, `--token`, `--root`, and `--out-dir`. `.env` is optional and exists only as a local shell-helper file for repeatable multi-server commands.

Build `.env` by copying `.env.example` and replacing every placeholder:

```sh
cp .env.example .env
```

`.env.example` includes multi-server helper variables for repeatable export commands:

| Variable Pattern | Used By | Description |
| --- | --- | --- |
| `PRIMARY_PLEX_URL`, `PRIMARY_PLEX_TOKEN` | shell examples | Plex server you are reviewing or cleaning. |
| `SECONDARY_PLEX_URL`, `SECONDARY_PLEX_TOKEN` | shell examples | First Plex comparison target. |
| `TERTIARY_PLEX_URL`, `TERTIARY_PLEX_TOKEN` | shell examples | Additional Plex comparison target. |
| `PRIMARY_EMBY_URL`, `PRIMARY_EMBY_API_KEY` | shell examples | Emby server you are reviewing or cleaning. |
| `SECONDARY_EMBY_URL`, `SECONDARY_EMBY_API_KEY` | shell examples | First Emby comparison target. |
| `TERTIARY_EMBY_URL`, `TERTIARY_EMBY_API_KEY` | shell examples | Additional Emby comparison target. |

The audit commands do not automatically read those helper names. Source `.env` first if you want to use them in shell commands:

```sh
set -a
. ./.env
set +a
```

Do not commit `.env`, API tokens, raw exports, or generated reports.

## Overlap Comparison Workflow

Use overlap comparison when you want to know which movies or shows exist on more than one media server. This is a read-only workflow. It produces context for later review; it does not approve deletion.

### 1. Export The Primary Server

Plex example:

```sh
npm run audit -- plex-export \
  --url "$PRIMARY_PLEX_URL" \
  --token "$PRIMARY_PLEX_TOKEN" \
  --server-name primary \
  --types movie,tv \
  --include-media \
  --out reports/primary-plex.json
```

Emby example:

```sh
npm run audit -- emby-export \
  --url "$PRIMARY_EMBY_URL" \
  --token "$PRIMARY_EMBY_API_KEY" \
  --server-name primary \
  --types movie,tv \
  --out reports/primary-emby.json
```

Use `--library NAME` one or more times if you want to limit the export to specific libraries.

### 2. Export The Secondary Server

```sh
npm run audit -- plex-export \
  --url "$SECONDARY_PLEX_URL" \
  --token "$SECONDARY_PLEX_TOKEN" \
  --server-name secondary \
  --types movie,tv \
  --out reports/secondary-plex.json
```

You can compare Plex-to-Plex, Plex-to-Emby, or Emby-to-Emby exports as long as each export was created by `plex-export` or `emby-export`.

For three or more servers, export every server once:

```sh
npm run audit -- emby-export \
  --url "$SECONDARY_EMBY_URL" \
  --token "$SECONDARY_EMBY_API_KEY" \
  --server-name secondary-emby \
  --types movie,tv \
  --out reports/secondary-emby.json

npm run audit -- plex-export \
  --url "$TERTIARY_PLEX_URL" \
  --token "$TERTIARY_PLEX_TOKEN" \
  --server-name tertiary-plex \
  --types movie,tv \
  --out reports/tertiary-plex.json
```

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

`compare-exports` compares two inventories at a time. For multiple servers, keep the reviewed server as `--local` and run one comparison per target:

```sh
npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/secondary-plex.json \
  --out-dir reports/overlap-primary-secondary-plex

npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/secondary-emby.json \
  --out-dir reports/overlap-primary-secondary-emby

npm run audit -- compare-exports \
  --local reports/primary-plex.json \
  --remote reports/tertiary-plex.json \
  --out-dir reports/overlap-primary-tertiary-plex
```

Use one output directory per pair. That keeps the Markdown review, CSV, and JSON artifacts traceable to the exact server pair.

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

## Example Outputs

The examples below are representative. Titles, sizes, paths, and counts are placeholders so you can recognize the report shapes without exposing your own library details.

### Inventory Export

Plex and Emby exports write one JSON inventory each:

```text
Exported 842 Plex items to reports/primary-plex.json
Exported 615 Emby items to reports/secondary-emby.json
```

Inventory JSON is intentionally machine-oriented. A single item is shaped like this:

```json
{
  "source": "plex",
  "serverName": "primary",
  "items": [
    {
      "type": "movie",
      "title": "Example Movie",
      "year": 2021,
      "sizeBytes": 26306674688,
      "providerIds": {
        "imdb": "tt0000001",
        "tmdb": "100001"
      },
      "library": "Movies",
      "path": "/media/movies/Example Movie (2021)"
    }
  ]
}
```

### Overlap Comparison

`compare-exports` prints the number of matched local items and the three report paths:

```text
Overlap matches: 184
Markdown: reports/overlap/overlap-candidates.md
CSV: reports/overlap/overlap-candidates.csv
JSON: reports/overlap/overlap-candidates.json
```

The Markdown report starts with summary lines:

```md
# Media Overlap Report

Generated: 2026-01-01T12:00:00.000Z

Local: primary (plex)
Remote: secondary (emby)

## Summary

- Local items with remote overlap: 184
- Local movie size with remote overlap: 4.2 TiB
- TV full-season overlaps: 37
- TV partial-season overlaps: 12
```

The overlap table shows the local item, chosen remote match, matching method, and TV season differences:

```md
| Type | Local | Local Size | Remote | Match | Extra Remote Matches | Overlap Seasons | Local-Only Seasons |
| --- | --- | ---: | --- | --- | ---: | --- | --- |
| movie | Example Movie (2021) | 24.5 GiB | Example Movie (2021) | provider-id | 0 |  |  |
| show | Example Show | 180.2 GiB | Example Show | title-year | 0 | 1, 2 | 3 |
```

CSV reports contain the same data in spreadsheet-friendly form:

```csv
type,local_title,local_year,remote_title,remote_year,match_method,local_library,remote_library,remote_alternatives,local_size_bytes,overlap_seasons,local_only_seasons,remote_only_seasons
movie,"Example Movie","2021","Example Movie","2021","provider-id","Movies","Movies","0","26306674688","","",""
show,"Example Show","","Example Show","","title-year","TV","TV","0","193488216883","1 2","3","4"
```

### TV Cleanup Options

`tv-cleanup-options` summarizes the scan and writes the review files:

```text
TV shows analyzed: 128
Focus/reality candidate reclaim: 2.1 TiB
Other large candidate reclaim: 740.4 GiB
Markdown: reports/tv-cleanup-options/tv-cleanup-options.md
CSV: reports/tv-cleanup-options/tv-cleanup-options.csv
JSON: reports/tv-cleanup-options/tv-cleanup-options.json
```

The Markdown report separates priority groups and lists candidate seasons:

```md
# TV Cleanup Options

## Summary

- Shows analyzed: 128
- Focus/reality candidate reclaim: 2.1 TiB
- Other large candidate reclaim: 740.4 GiB

| Priority | Show | Candidate Size | Candidate Seasons | Keep Latest | Remote Context |
| --- | --- | ---: | --- | ---: | --- |
| focus | Example Reality Show | 340.8 GiB | 1, 2, 3, 4 | 2 | full remote overlap |
| other-large | Example Drama | 180.2 GiB | 1, 2 | 2 | partial remote overlap; local-only seasons 2 |
```

### Interactive Approvals

Approval commands prompt one candidate at a time and then summarize the recorded decisions:

```text
[1/3] Example Reality Show
  Candidate size: 340.8 GiB | Seasons: 1, 2, 3, 4 | Remote: full remote overlap
  Audience: 1 unique user | Latest watch: 2023-05-10
  Decision [a=remove all, o=older only, k=keep, s=skip, q=quit]:

Decisions recorded: 3/3
Approved for removal: 2
Approved size: 512.1 GiB
Kept/exempted: 1
Skipped: 0
Markdown: reports/tv-approval/tv-approval.md
CSV: reports/tv-approval/tv-approval.csv
JSON: reports/tv-approval/tv-approval.json
```

Approval JSON is the artifact later planning steps consume:

```json
{
  "decisions": [
    {
      "decision": "approve",
      "cleanupMode": "remove-old",
      "show": "Example Reality Show",
      "approvedSeasons": [1, 2],
      "candidateBytes": 366001111040
    }
  ]
}
```

### Sonarr And Radarr Plans

Planning commands do not delete files. They map approvals to app records and disk paths:

```text
Candidate season entries: 12
Needs unmonitor: 12
Already unmonitored: 0
Missing Sonarr series: 0
Missing Sonarr season rows: 0
Mapped candidate reclaim: 512.1 GiB
Markdown: reports/sonarr-unmonitor-plan/sonarr-unmonitor-plan.md
CSV: reports/sonarr-unmonitor-plan/sonarr-unmonitor-plan.csv
JSON: reports/sonarr-unmonitor-plan/sonarr-unmonitor-plan.json
```

Expected plan rows look like this:

```md
| Status | Cleanup Mode | Show | Season | Series ID | Monitored | Path |
| --- | --- | --- | ---: | ---: | --- | --- |
| needs-unmonitor | remove-old | Example Reality Show | 1 | 1001 | true | `/path/to/media/tv/Example Reality Show/Season 01` |
| already-unmonitored | remove-old | Example Reality Show | 2 | 1001 | false | `/path/to/media/tv/Example Reality Show/Season 02` |
```

### Apply And Delete Reports

Apply commands print outcome counters. For unmonitoring:

```text
Series updated: 1
Candidate seasons requested: 12
Seasons still monitored after apply: 0
Markdown: reports/sonarr-unmonitor-apply/sonarr-unmonitor-apply.md
CSV: reports/sonarr-unmonitor-apply/sonarr-unmonitor-apply.csv
JSON: reports/sonarr-unmonitor-apply/sonarr-unmonitor-apply.json
```

For filesystem deletion:

```text
Deleted folders: 12
Excluded folders: 0
Missing before delete: 0
Blocked unsafe paths: 0
Delete failures: 0
Deleted bytes: 512.1 GiB
Deleted files: 428
Markdown: reports/season-delete-apply/season-delete-apply.md
CSV: reports/season-delete-apply/season-delete-apply.csv
JSON: reports/season-delete-apply/season-delete-apply.json
```

Treat any non-zero blocked, missing, or failure counter as a review point before proceeding.

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
