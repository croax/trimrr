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
