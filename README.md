# trimrr

`trimrr` is a local audit and cleanup toolkit for self-hosted media libraries. It builds review reports from Plex, Emby, Sonarr, Radarr, Tautulli, and filesystem data, then records explicit approval artifacts before any monitoring or deletion changes happen.

The workflow is intentionally conservative:

- generate read-only reports first
- record cleanup approvals in JSON, CSV, and Markdown
- unmonitor approved media in Sonarr or Radarr
- create a filesystem delete dry-run
- delete only paths from the approved dry-run
- generate post-apply verification reports

## Setup

Install dependencies:

```sh
npm install
```

Run syntax validation:

```sh
npm run check
```

Generated reports are written under `reports/` by convention. That directory is ignored because exports and approval artifacts can contain private library contents, watch history, hostnames, and other environment-specific data.

## Common Commands

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
