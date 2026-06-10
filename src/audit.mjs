import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';

const DEFAULT_INCLUDE =
  'Survivor|Housewives|Love Island|Bachelor|Bachelorette|MasterChef|RuPaul|Kitchen|Daily Show';
const DEFAULT_EXCLUDE = 'Law & Order';
const COLOR_ENABLED = process.env.FORCE_COLOR && process.env.FORCE_COLOR !== '0'
  ? true
  : process.env.NO_COLOR === undefined && process.stdout.isTTY;
const color = {
  bold: ansiColor('1', '22'),
  red: ansiColor('31', '39'),
  yellow: ansiColor('33', '39'),
  green: ansiColor('32', '39'),
  cyan: ansiColor('36', '39'),
  blue: ansiColor('34', '39'),
  gray: ansiColor('90', '39'),
};

function usage() {
  console.log(`trimrr read-only audit

Usage:
  npm run audit -- reality-retention --ssh media-admin@example-host --root /path/to/media/tv --out-dir reports/reality-retention
  npm run audit -- plex-export --url http://server:32400 --token TOKEN --server-name local --out reports/local-plex.json
  npm run audit -- emby-export --url http://server:8096 --token TOKEN --server-name remote --out reports/remote-emby.json
  npm run audit -- compare-exports --local reports/local-plex.json --remote reports/remote-emby.json --out-dir reports/overlap
  npm run audit -- movie-review --local reports/local-plex.json --overlap-json reports/overlap/overlap-candidates.json --out-dir reports/movie-review
  npm run audit -- movie-approval --review-json reports/movie-review/movie-review.json --priority-rank-max 1 --out-dir reports/movie-approval
  npm run audit -- radarr-movie-delete-plan --ssh media-admin@example-host --approval-json reports/movie-approval/movie-approval.json --out-dir reports/radarr-delete-plan
  npm run audit -- radarr-movie-delete-apply --ssh media-admin@example-host --plan-json reports/radarr-delete-plan/radarr-movie-delete-plan.json --out-dir reports/radarr-delete-apply
  npm run audit -- tv-cleanup-options --ssh media-admin@example-host --root /path/to/media/tv --overlap-json reports/overlap/overlap-candidates.json --out-dir reports/tv-cleanup
  npm run audit -- tv-approval --cleanup-json reports/tv-cleanup/tv-cleanup-options.json --priority other --min-candidate-gb 150 --out-dir reports/tv-approval
  npm run audit -- sonarr-unmonitor-plan --ssh media-admin@example-host --cleanup-json reports/tv-cleanup/tv-cleanup-options.json --out-dir reports/sonarr-plan
  npm run audit -- sonarr-apply-unmonitor --ssh media-admin@example-host --plan-json reports/sonarr-plan/sonarr-unmonitor-plan.json --out-dir reports/sonarr-apply
  npm run audit -- season-delete-plan --ssh media-admin@example-host --plan-json reports/sonarr-plan/sonarr-unmonitor-plan.json --out-dir reports/delete-plan
  npm run audit -- season-delete-apply --ssh media-admin@example-host --plan-json reports/delete-plan/season-delete-plan.json --exclude-show "Protected Show" --out-dir reports/delete-apply

Options:
  --ssh HOST              SSH target for the media server.
  --root PATH             TV library root. Default: /mnt/user/media/tv
  --keep-seasons N        Number of latest numbered seasons to keep. Default: 2
  --include-regex REGEX   Show title include regex. Default: common reality TV terms
  --exclude-regex REGEX   Show title exclude regex. Default: Law & Order
  --focus-regex REGEX     TV cleanup priority marker. Default: common reality TV terms
  --min-candidate-gb N    Minimum reclaim size for secondary TV options. Default: 100
  --min-movie-gb N        Minimum movie size for large movie review. Default: 20
  --low-rating-max N      Rating threshold for low-rated movie priority. Default: 6.5
  --top-n N               Number of movie rows to show in Markdown. Default: 200
  --out-dir DIR           Output report directory. Default: reports/reality-retention
  --url URL               Plex/Emby base URL for export commands.
  --token TOKEN           Plex X-Plex-Token or Emby API key for export commands.
  --server-name NAME      Human-readable server name written to inventory exports.
  --library NAME          Optional library name filter. Can be passed more than once.
  --types LIST            Export type filter: movie,tv. Default: movie,tv
  --include-media         Include Plex media part paths and sizes when exporting movies.
  --user-id ID            Optional Emby user ID for per-user watch fields.
  --out FILE              Output JSON file for export commands.
  --local FILE            Local inventory JSON for compare-exports or TV approval watch context.
  --remote FILE           Remote inventory JSON for compare-exports.
  --tautulli-db FILE      Optional Tautulli SQLite DB for TV approval user-audience context.
  --overlap-json FILE     Optional overlap JSON for TV cleanup context.
  --review-json FILE      Movie review JSON for interactive approval.
  --exclude-approval-json FILE Exclude movies already decided in an approval JSON. Can be passed more than once.
  --approval-json FILE    Movie approval JSON for Radarr delete planning.
  --tv-approval-json FILE TV approval JSON for Sonarr planning.
  --cleanup-json FILE     TV cleanup options JSON for Sonarr planning.
  --plan-json FILE        Sonarr unmonitor plan JSON for apply command.
  --radarr-container NAME Radarr container to inspect. Default: radarr
  --plex-movie-root PATH  Plex movie root in exported paths. Default: /data/movies
  --host-movie-root PATH  Host movie root to delete from. Default: /mnt/user/media/movies
  --radarr-movie-root PATH Radarr movie root. Default: /movies
  --sonarr-container NAME Sonarr container to inspect. Default: sonarr
  --host-root PATH        Host media root to map into Sonarr paths. Default: /mnt/user/media/tv
  --sonarr-root PATH      Sonarr container media root. Default: /tv
  --priority MODE         Candidate scope for Sonarr plan: focus, other, all. Default: focus
  --include-show NAME     Limit cleanup/Sonarr planning to a show. Can be passed more than once.
  --exclude-show NAME     Exclude a show from delete apply. Can be passed more than once.
  --max-items N           Maximum items to ask in interactive approval.
  --priority-rank-max N   Highest priority rank to include in interactive approval.
  --unwatched-only        Limit movie approval to never-viewed candidates.
  --remote-overlap-only   Limit movie approval to candidates found on the remote server.

Most commands are read-only. The sonarr-apply-unmonitor command changes Sonarr monitoring state only. The season-delete-apply command deletes approved season folders.`);
}

function ansiColor(openCode, closeCode) {
  return (value) => {
    const text = String(value);
    if (!COLOR_ENABLED) return text;
    return `\u001b[${openCode}m${text}\u001b[${closeCode}m`;
  };
}

function parseArgs(argv) {
  const command = argv[0]?.startsWith('-') ? undefined : argv[0];
  const rest = command ? argv.slice(1) : argv;
  const opts = {
    command,
    root: '/mnt/user/media/tv',
    keepSeasons: 2,
    includeRegex: DEFAULT_INCLUDE,
    excludeRegex: DEFAULT_EXCLUDE,
    focusRegex: DEFAULT_INCLUDE,
    minCandidateGb: 100,
    minMovieGb: 20,
    lowRatingMax: 6.5,
    topN: 200,
    outDir: 'reports/reality-retention',
    libraries: [],
    types: ['movie', 'tv'],
    sonarrContainer: 'sonarr',
    radarrContainer: 'radarr',
    hostRoot: '/mnt/user/media/tv',
    sonarrRoot: '/tv',
    plexMovieRoot: '/data/movies',
    hostMovieRoot: '/mnt/user/media/movies',
    radarrMovieRoot: '/movies',
    priority: 'focus',
    priorityRankMax: null,
    maxItems: null,
    includeShows: [],
    excludeShows: [],
    excludeApprovalJsons: [],
    tvApprovalJson: null,
  };

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    const next = rest[i + 1];
    if (arg === '--ssh') {
      opts.ssh = next;
      i += 1;
    } else if (arg === '--root') {
      opts.root = next;
      i += 1;
    } else if (arg === '--keep-seasons') {
      opts.keepSeasons = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--include-regex') {
      opts.includeRegex = next;
      i += 1;
    } else if (arg === '--exclude-regex') {
      opts.excludeRegex = next;
      i += 1;
    } else if (arg === '--focus-regex') {
      opts.focusRegex = next;
      i += 1;
    } else if (arg === '--min-candidate-gb') {
      opts.minCandidateGb = Number.parseFloat(next);
      i += 1;
    } else if (arg === '--min-movie-gb') {
      opts.minMovieGb = Number.parseFloat(next);
      i += 1;
    } else if (arg === '--low-rating-max') {
      opts.lowRatingMax = Number.parseFloat(next);
      i += 1;
    } else if (arg === '--top-n') {
      opts.topN = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--out-dir') {
      opts.outDir = next;
      i += 1;
    } else if (arg === '--url') {
      opts.url = next;
      i += 1;
    } else if (arg === '--token') {
      opts.token = next;
      i += 1;
    } else if (arg === '--server-name') {
      opts.serverName = next;
      i += 1;
    } else if (arg === '--library') {
      opts.libraries.push(next);
      i += 1;
    } else if (arg === '--types') {
      opts.types = next.split(',').map((type) => type.trim()).filter(Boolean);
      i += 1;
    } else if (arg === '--include-media') {
      opts.includeMedia = true;
    } else if (arg === '--user-id') {
      opts.userId = next;
      i += 1;
    } else if (arg === '--out') {
      opts.out = next;
      i += 1;
    } else if (arg === '--local') {
      opts.local = next;
      i += 1;
    } else if (arg === '--remote') {
      opts.remote = next;
      i += 1;
    } else if (arg === '--tautulli-db') {
      opts.tautulliDb = next;
      i += 1;
    } else if (arg === '--overlap-json') {
      opts.overlapJson = next;
      i += 1;
    } else if (arg === '--review-json') {
      opts.reviewJson = next;
      i += 1;
    } else if (arg === '--exclude-approval-json') {
      opts.excludeApprovalJsons.push(next);
      i += 1;
    } else if (arg === '--approval-json') {
      opts.approvalJson = next;
      i += 1;
    } else if (arg === '--tv-approval-json') {
      opts.tvApprovalJson = next;
      i += 1;
    } else if (arg === '--cleanup-json') {
      opts.cleanupJson = next;
      i += 1;
    } else if (arg === '--plan-json') {
      opts.planJson = next;
      i += 1;
    } else if (arg === '--sonarr-container') {
      opts.sonarrContainer = next;
      i += 1;
    } else if (arg === '--radarr-container') {
      opts.radarrContainer = next;
      i += 1;
    } else if (arg === '--host-root') {
      opts.hostRoot = next;
      i += 1;
    } else if (arg === '--sonarr-root') {
      opts.sonarrRoot = next;
      i += 1;
    } else if (arg === '--plex-movie-root') {
      opts.plexMovieRoot = next;
      i += 1;
    } else if (arg === '--host-movie-root') {
      opts.hostMovieRoot = next;
      i += 1;
    } else if (arg === '--radarr-movie-root') {
      opts.radarrMovieRoot = next;
      i += 1;
    } else if (arg === '--priority') {
      opts.priority = next;
      i += 1;
    } else if (arg === '--priority-rank-max') {
      opts.priorityRankMax = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--max-items') {
      opts.maxItems = Number.parseInt(next, 10);
      i += 1;
    } else if (arg === '--unwatched-only') {
      opts.unwatchedOnly = true;
    } else if (arg === '--remote-overlap-only') {
      opts.remoteOverlapOnly = true;
    } else if (arg === '--include-show') {
      opts.includeShows.push(next);
      i += 1;
    } else if (arg === '--exclude-show') {
      opts.excludeShows.push(next);
      i += 1;
    } else if (arg === '--help' || arg === '-h') {
      opts.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function runSsh(host, script) {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', host, script], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
}

function fetchSeasonRows(opts) {
  const root = shellQuote(opts.root);
  const script = `
set -e
root=${root}
find "$root" -mindepth 2 -maxdepth 2 -type d -name 'Season *' -print0 |
while IFS= read -r -d '' season_path; do
  show_path=$(dirname "$season_path")
  show=$(basename "$show_path")
  season=$(basename "$season_path")
  number=$(printf '%s\\n' "$season" | sed -n 's/^Season[[:space:]]*0*\\([0-9][0-9]*\\).*$/\\1/p')
  [ -n "$number" ] || continue
  size_kib=$(du -sk "$season_path" 2>/dev/null | awk '{print $1}')
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$show" "$season" "$number" "$size_kib" "$season_path"
done
`;
  return runSsh(opts.ssh, script)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [show, season, seasonNumber, sizeKiB, path] = line.split('\t');
      return {
        show,
        season,
        seasonNumber: Number.parseInt(seasonNumber, 10),
        sizeBytes: Number.parseInt(sizeKiB, 10) * 1024,
        path,
      };
    })
    .filter((row) => Number.isInteger(row.seasonNumber) && row.seasonNumber > 0);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit < 3 ? 0 : 1)} ${units[unit]}`;
}

function buildRetentionReport(rows, opts) {
  const include = new RegExp(opts.includeRegex, 'i');
  const exclude = opts.excludeRegex ? new RegExp(opts.excludeRegex, 'i') : null;
  const byShow = new Map();

  for (const row of rows) {
    if (!include.test(row.show)) continue;
    if (exclude?.test(row.show)) continue;
    if (!byShow.has(row.show)) byShow.set(row.show, []);
    byShow.get(row.show).push(row);
  }

  const shows = [...byShow.entries()].map(([show, seasons]) => {
    const sorted = seasons.toSorted((a, b) => b.seasonNumber - a.seasonNumber);
    const keep = sorted.slice(0, opts.keepSeasons);
    const candidate = sorted.slice(opts.keepSeasons);
    const totalBytes = sorted.reduce((sum, row) => sum + row.sizeBytes, 0);
    const keepBytes = keep.reduce((sum, row) => sum + row.sizeBytes, 0);
    const candidateBytes = candidate.reduce((sum, row) => sum + row.sizeBytes, 0);

    return {
      show,
      totalBytes,
      keepBytes,
      candidateBytes,
      keepSeasons: keep.map((row) => row.seasonNumber).sort((a, b) => a - b),
      candidateSeasons: candidate.map((row) => row.seasonNumber).sort((a, b) => a - b),
      candidate,
    };
  });

  shows.sort((a, b) => b.candidateBytes - a.candidateBytes);
  return shows;
}

function writeRetentionReports(shows, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const csvPath = join(opts.outDir, 'reality-retention-candidates.csv');
  const mdPath = join(opts.outDir, 'reality-retention-candidates.md');
  const jsonPath = join(opts.outDir, 'reality-retention-candidates.json');

  const totalCandidateBytes = shows.reduce((sum, show) => sum + show.candidateBytes, 0);
  const totalKeepBytes = shows.reduce((sum, show) => sum + show.keepBytes, 0);
  const totalBytes = shows.reduce((sum, show) => sum + show.totalBytes, 0);

  const csvRows = [
    'show,total,keep,candidate_reclaim,keep_seasons,candidate_seasons',
    ...shows.map((show) =>
      [
        JSON.stringify(show.show),
        show.totalBytes,
        show.keepBytes,
        show.candidateBytes,
        JSON.stringify(show.keepSeasons.join(' ')),
        JSON.stringify(show.candidateSeasons.join(' ')),
      ].join(','),
    ),
  ];

  const mdRows = [
    '# Reality TV Retention Candidates',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Policy: keep latest ${opts.keepSeasons} numbered seasons.`,
    `Include regex: \`${opts.includeRegex}\``,
    `Exclude regex: \`${opts.excludeRegex || ''}\``,
    '',
    'This report is read-only. Candidate reclaim is an estimate from folder sizes and is not approval to delete media.',
    '',
    '## Summary',
    '',
    `- Shows matched: ${shows.length}`,
    `- Matched total size: ${formatBytes(totalBytes)}`,
    `- Size retained by policy: ${formatBytes(totalKeepBytes)}`,
    `- Candidate reclaim: ${formatBytes(totalCandidateBytes)}`,
    '',
    '## Candidates',
    '',
    '| Show | Total | Keep | Candidate Reclaim | Keep Seasons | Candidate Seasons |',
    '| --- | ---: | ---: | ---: | --- | --- |',
    ...shows.map(
      (show) =>
        `| ${show.show.replaceAll('|', '\\|')} | ${formatBytes(show.totalBytes)} | ${formatBytes(show.keepBytes)} | ${formatBytes(show.candidateBytes)} | ${show.keepSeasons.join(', ')} | ${show.candidateSeasons.join(', ')} |`,
    ),
  ];

  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  writeFileSync(jsonPath, `${JSON.stringify({ options: opts, shows }, null, 2)}\n`);

  return { csvPath, mdPath, jsonPath, totalCandidateBytes, totalBytes, totalKeepBytes };
}

function runRealityRetention(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  if (!Number.isInteger(opts.keepSeasons) || opts.keepSeasons < 1) {
    throw new Error('--keep-seasons must be a positive integer');
  }

  const rows = fetchSeasonRows(opts);
  const shows = buildRetentionReport(rows, opts);
  const result = writeRetentionReports(shows, opts);

  console.log(`Matched shows: ${shows.length}`);
  console.log(`Matched total size: ${formatBytes(result.totalBytes)}`);
  console.log(`Candidate reclaim: ${formatBytes(result.totalCandidateBytes)}`);
  console.log(`Markdown: ${result.mdPath}`);
  console.log(`CSV: ${result.csvPath}`);
  console.log(`JSON: ${result.jsonPath}`);
}

function buildOverlapShowContext(path) {
  if (!path) return new Map();

  const comparison = JSON.parse(readFileSync(path, 'utf8'));
  const byTitle = new Map();

  for (const match of comparison.matches || []) {
    if (match.local?.type !== 'show') continue;
    byTitle.set(normalizeTitle(match.local.title), {
      remoteTitle: match.remote?.title || '',
      method: match.method,
      remoteMatchCount: match.remoteMatchCount || 1,
      overlapSeasons: match.seasons?.overlap || [],
      localOnlySeasons: match.seasons?.localOnly || [],
      remoteOnlySeasons: match.seasons?.remoteOnly || [],
    });
  }

  return byTitle;
}

function overlapLabel(context) {
  if (!context) return 'not found on remote export';
  if (context.localOnlySeasons.length === 0) return 'remote has all local seasons';
  if (context.overlapSeasons.length > 0) return `partial remote overlap; local-only seasons ${context.localOnlySeasons.join(', ')}`;
  return 'matched show, no season overlap';
}

function buildTvCleanupOptions(rows, opts) {
  const exclude = opts.excludeRegex ? new RegExp(opts.excludeRegex, 'i') : null;
  const focus = opts.focusRegex ? new RegExp(opts.focusRegex, 'i') : null;
  const overlapByTitle = buildOverlapShowContext(opts.overlapJson);
  const byShow = new Map();

  for (const row of rows) {
    if (exclude?.test(row.show)) continue;
    if (!byShow.has(row.show)) byShow.set(row.show, []);
    byShow.get(row.show).push(row);
  }

  const shows = [...byShow.entries()].map(([show, seasons]) => {
    const sorted = seasons.toSorted((a, b) => b.seasonNumber - a.seasonNumber);
    const keep = sorted.slice(0, opts.keepSeasons);
    const candidate = sorted.slice(opts.keepSeasons);
    const totalBytes = sorted.reduce((sum, row) => sum + row.sizeBytes, 0);
    const keepBytes = keep.reduce((sum, row) => sum + row.sizeBytes, 0);
    const candidateBytes = candidate.reduce((sum, row) => sum + row.sizeBytes, 0);
    const remoteContext = overlapByTitle.get(normalizeTitle(show)) || null;

    return {
      show,
      focus: focus?.test(show) || false,
      totalBytes,
      keepBytes,
      candidateBytes,
      keepSeasons: keep.map((row) => row.seasonNumber).sort((a, b) => a - b),
      candidateSeasons: candidate.map((row) => row.seasonNumber).sort((a, b) => a - b),
      remoteContext,
      remoteContextLabel: overlapLabel(remoteContext),
      candidate,
    };
  });

  shows.sort((a, b) => b.candidateBytes - a.candidateBytes);
  return shows;
}

function writeTvCleanupOptions(shows, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const csvPath = join(opts.outDir, 'tv-cleanup-options.csv');
  const mdPath = join(opts.outDir, 'tv-cleanup-options.md');
  const jsonPath = join(opts.outDir, 'tv-cleanup-options.json');
  const minCandidateBytes = Number(opts.minCandidateGb) * 1024 * 1024 * 1024;

  const candidateShows = shows.filter((show) => show.candidateBytes > 0);
  const focusShows = candidateShows.filter((show) => show.focus);
  const otherLargeShows = candidateShows.filter((show) => !show.focus && show.candidateBytes >= minCandidateBytes);
  const focusCandidateBytes = focusShows.reduce((sum, show) => sum + show.candidateBytes, 0);
  const otherLargeCandidateBytes = otherLargeShows.reduce((sum, show) => sum + show.candidateBytes, 0);

  const csvRows = [
    'priority,show,total_bytes,keep_bytes,candidate_bytes,keep_seasons,candidate_seasons,remote_context',
    ...candidateShows.map((show) =>
      [
        show.focus ? 'focus' : 'other',
        show.show,
        show.totalBytes,
        show.keepBytes,
        show.candidateBytes,
        show.keepSeasons.join(' '),
        show.candidateSeasons.join(' '),
        show.remoteContextLabel,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const tableRows = (rows) =>
    rows.map(
      (show) =>
        `| ${show.show.replaceAll('|', '\\|')} | ${show.focus ? 'yes' : 'no'} | ${formatBytes(show.totalBytes)} | ${formatBytes(show.keepBytes)} | ${formatBytes(show.candidateBytes)} | ${show.keepSeasons.join(', ')} | ${show.candidateSeasons.join(', ')} | ${show.remoteContextLabel.replaceAll('|', '\\|')} |`,
    );

  const mdRows = [
    '# TV Cleanup Options',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Policy model: keep latest ${opts.keepSeasons} numbered seasons, report older seasons as candidates.`,
    `Protected exclude regex: \`${opts.excludeRegex || ''}\``,
    `Priority focus regex: \`${opts.focusRegex || ''}\``,
    '',
    'This report is read-only. It is a review list for local-space recovery, not approval to delete media. Remote overlap is context only because the secondary Plex server is best-effort.',
    '',
    '## Summary',
    '',
    `- TV shows analyzed: ${shows.length}`,
    `- Shows with older-season candidates: ${candidateShows.length}`,
    `- Focus/reality candidate reclaim: ${formatBytes(focusCandidateBytes)}`,
    `- Other large candidate reclaim above ${opts.minCandidateGb} GB: ${formatBytes(otherLargeCandidateBytes)}`,
    `- Law & Order excluded by regex: ${opts.excludeRegex || 'none'}`,
    '',
    '## Recommended First Pass',
    '',
    '| Show | Focus | Total | Keep | Candidate Reclaim | Keep Seasons | Candidate Seasons | Remote Context |',
    '| --- | --- | ---: | ---: | ---: | --- | --- | --- |',
    ...tableRows(focusShows),
    '',
    '## Other Large Local TV Options',
    '',
    '| Show | Focus | Total | Keep | Candidate Reclaim | Keep Seasons | Candidate Seasons | Remote Context |',
    '| --- | --- | ---: | ---: | ---: | --- | --- | --- |',
    ...tableRows(otherLargeShows),
  ];

  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  writeJsonFile(jsonPath, { options: opts, shows });
  return { csvPath, mdPath, jsonPath, focusCandidateBytes, otherLargeCandidateBytes, shows };
}

function runTvCleanupOptions(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  if (!Number.isInteger(opts.keepSeasons) || opts.keepSeasons < 1) {
    throw new Error('--keep-seasons must be a positive integer');
  }
  if (!Number.isFinite(opts.minCandidateGb) || opts.minCandidateGb < 0) {
    throw new Error('--min-candidate-gb must be a non-negative number');
  }

  const rows = fetchSeasonRows(opts);
  const shows = buildTvCleanupOptions(rows, opts);
  const result = writeTvCleanupOptions(shows, opts);

  console.log(`TV shows analyzed: ${result.shows.length}`);
  console.log(`Focus/reality candidate reclaim: ${formatBytes(result.focusCandidateBytes)}`);
  console.log(`Other large candidate reclaim: ${formatBytes(result.otherLargeCandidateBytes)}`);
  console.log(`Markdown: ${result.mdPath}`);
  console.log(`CSV: ${result.csvPath}`);
  console.log(`JSON: ${result.jsonPath}`);
}

function tvApprovalCandidates(cleanup, opts) {
  if (!['focus', 'other', 'all'].includes(opts.priority)) {
    throw new Error('--priority must be one of: focus, other, all');
  }
  if (!Number.isFinite(opts.minCandidateGb) || opts.minCandidateGb < 0) {
    throw new Error('--min-candidate-gb must be a non-negative number');
  }
  if (opts.maxItems !== null && opts.maxItems !== undefined && (!Number.isInteger(opts.maxItems) || opts.maxItems < 1)) {
    throw new Error('--max-items must be a positive integer');
  }

  const minCandidateBytes = Number(opts.minCandidateGb) * 1024 * 1024 * 1024;
  const includeNames = new Set((opts.includeShows || []).map((show) => normalizeTitle(show)));
  const excludeNames = new Set((opts.excludeShows || []).map((show) => normalizeTitle(show)));
  const watchContext = buildTvWatchContext(opts.local);
  const audienceContext = buildTautulliAudienceContext(opts.tautulliDb);

  let candidates = (cleanup.shows || []).filter((show) => {
    const showName = normalizeTitle(show.show);
    if (includeNames.size > 0 && !includeNames.has(showName)) return false;
    if (excludeNames.has(showName)) return false;
    if (Number(show.candidateBytes || 0) < minCandidateBytes) return false;
    if ((show.candidateSeasons || []).length === 0) return false;
    if (opts.remoteOverlapOnly && !show.remoteContext) return false;
    if (opts.priority === 'focus') return show.focus;
    if (opts.priority === 'other') return !show.focus;
    return true;
  });

  candidates = candidates.toSorted(
    (a, b) =>
      Number(b.candidateBytes || 0) - Number(a.candidateBytes || 0) ||
      String(a.show).localeCompare(String(b.show)),
  );

  if (opts.maxItems !== null && opts.maxItems !== undefined) {
    candidates = candidates.slice(0, opts.maxItems);
  }
  return candidates.map((candidate) => ({
    ...candidate,
    allSeasons: allCleanupSeasons(candidate),
    allBytes: Number(candidate.totalBytes || 0),
    watchContext: tvWatchContextForShow(candidate, watchContext),
    audienceContext: tvAudienceContextForShow(candidate, audienceContext),
  }));
}

function allCleanupSeasons(show) {
  return [...new Set([...(show.keepSeasons || []), ...(show.candidateSeasons || [])])].sort((a, b) => a - b);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildTvWatchContext(path) {
  if (!path) return new Map();
  const inventory = normalizeInventory(JSON.parse(readFileSync(path, 'utf8')));
  const byTitle = new Map();

  for (const item of inventory.items || []) {
    if (item.type !== 'show') continue;
    byTitle.set(normalizeTitle(item.title), {
      source: inventory.source || '',
      serverName: inventory.serverName || '',
      library: item.library || '',
      ratingKey: item.ratingKey || null,
      episodeCount: numberOrNull(item.leafCount),
      watchedEpisodeCount: numberOrNull(item.viewedLeafCount),
      viewCount: numberOrNull(item.viewCount),
      lastViewedAt: item.lastViewedAt || null,
      lastViewedAtIso: item.lastViewedAtIso || null,
      seasonStats: Array.isArray(item.seasonStats) ? item.seasonStats : [],
    });
  }

  return byTitle;
}

function buildTautulliAudienceContext(path) {
  if (!path) return new Map();
  const query = `
select
  coalesce(m.grandparent_title, '') as show_title,
  coalesce(m.parent_media_index, 0) as season_number,
  h.user_id,
  coalesce(u.friendly_name, u.username, h.user, cast(h.user_id as text)) as user_name,
  count(*) as plays,
  max(h.started) as last_played_at
from session_history h
join session_history_metadata m on m.id = h.id
left join users u on u.user_id = h.user_id
where m.media_type = 'episode'
  and h.user_id is not null
  and h.user_id != 0
  and coalesce(m.grandparent_title, '') != ''
  and coalesce(m.parent_media_index, 0) > 0
group by show_title, season_number, h.user_id, user_name
`;
  const output = execFileSync('sqlite3', ['-json', path, query], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 128,
  }).trim();
  const rows = output ? JSON.parse(output) : [];
  const byShow = new Map();

  for (const row of rows) {
    const showKey = normalizeTitle(row.show_title);
    if (!showKey) continue;
    if (!byShow.has(showKey)) {
      byShow.set(showKey, {
        users: new Map(),
        seasons: new Map(),
      });
    }
    const show = byShow.get(showKey);
    const userId = String(row.user_id);
    const user = {
      userId,
      userName: row.user_name || userId,
      plays: Number(row.plays || 0),
      lastPlayedAt: numberOrNull(row.last_played_at),
    };
    const existingUser = show.users.get(userId);
    show.users.set(userId, mergeAudienceUser(existingUser, user));

    const seasonNumber = Number(row.season_number);
    if (!show.seasons.has(seasonNumber)) show.seasons.set(seasonNumber, new Map());
    const seasonUsers = show.seasons.get(seasonNumber);
    const existingSeasonUser = seasonUsers.get(userId);
    seasonUsers.set(userId, mergeAudienceUser(existingSeasonUser, user));
  }

  return byShow;
}

function mergeAudienceUser(existing, next) {
  if (!existing) return next;
  return {
    userId: existing.userId,
    userName: existing.userName || next.userName,
    plays: Number(existing.plays || 0) + Number(next.plays || 0),
    lastPlayedAt: Math.max(Number(existing.lastPlayedAt || 0), Number(next.lastPlayedAt || 0)) || null,
  };
}

function sumSeasonWatchStats(seasonStats, seasons) {
  const requested = new Set(seasons || []);
  const matching = (seasonStats || []).filter((season) => requested.has(season.seasonNumber));
  if (matching.length === 0) return { episodeCount: null, watchedEpisodeCount: null };
  const episodeValues = matching.map((season) => numberOrNull(season.leafCount));
  const watchedValues = matching.map((season) => numberOrNull(season.viewedLeafCount));
  return {
    episodeCount: episodeValues.every((value) => value !== null)
      ? episodeValues.reduce((sum, value) => sum + value, 0)
      : null,
    watchedEpisodeCount: watchedValues.every((value) => value !== null)
      ? watchedValues.reduce((sum, value) => sum + value, 0)
      : null,
  };
}

function tvWatchContextForShow(show, watchContext) {
  const context = watchContext.get(normalizeTitle(show.show));
  if (!context) {
    return {
      available: false,
      label: 'watch data unavailable',
      candidateLabel: 'candidate watch data unavailable',
    };
  }
  const candidate = sumSeasonWatchStats(context.seasonStats, show.candidateSeasons || []);
  return {
    ...context,
    available: true,
    label: tvWatchLabel(context.watchedEpisodeCount, context.episodeCount, context.lastViewedAtIso),
    candidateWatchedEpisodeCount: candidate.watchedEpisodeCount,
    candidateEpisodeCount: candidate.episodeCount,
    candidateLabel: tvWatchLabel(candidate.watchedEpisodeCount, candidate.episodeCount, null, 'candidate'),
  };
}

function tvAudienceContextForShow(show, audienceContext) {
  const context = audienceContext.get(normalizeTitle(show.show));
  if (!context) {
    return {
      available: false,
      label: 'audience unavailable',
      candidateLabel: 'candidate audience unavailable',
      userCount: null,
      candidateUserCount: null,
      plays: null,
      candidatePlays: null,
    };
  }

  const allUsers = [...context.users.values()].toSorted((a, b) => String(a.userName).localeCompare(String(b.userName)));
  const candidateUsersById = new Map();
  for (const seasonNumber of show.candidateSeasons || []) {
    const seasonUsers = context.seasons.get(seasonNumber);
    if (!seasonUsers) continue;
    for (const user of seasonUsers.values()) {
      candidateUsersById.set(user.userId, mergeAudienceUser(candidateUsersById.get(user.userId), user));
    }
  }
  const candidateUsers = [...candidateUsersById.values()].toSorted((a, b) => String(a.userName).localeCompare(String(b.userName)));
  const plays = allUsers.reduce((sum, user) => sum + Number(user.plays || 0), 0);
  const candidatePlays = candidateUsers.reduce((sum, user) => sum + Number(user.plays || 0), 0);

  return {
    available: true,
    userCount: allUsers.length,
    candidateUserCount: candidateUsers.length,
    plays,
    candidatePlays,
    label: audienceLabel(allUsers.length, plays),
    candidateLabel: audienceLabel(candidateUsers.length, candidatePlays, 'candidate users'),
  };
}

function audienceLabel(userCount, plays, prefix = 'users') {
  return `${prefix} ${userCount}, plays ${plays}`;
}

function compactAudienceLabel(context, prefix = '') {
  if (!context?.available) return `${prefix ? `${prefix} ` : ''}unknown`;
  const labelPrefix = prefix ? `${prefix} ` : '';
  return `${labelPrefix}${context.userCount ?? 0} users / ${context.plays ?? 0} plays`;
}

function compactCandidateAudienceLabel(context) {
  if (!context?.available) return 'older unknown';
  return `older ${context.candidateUserCount ?? 0} users / ${context.candidatePlays ?? 0} plays`;
}

function tvWatchLabel(watched, total, lastViewedAtIso, prefix = 'watched') {
  if (watched === null || watched === undefined || total === null || total === undefined) {
    return `${prefix} unknown`;
  }
  const percent = total > 0 ? `, ${Math.round((watched / total) * 100)}%` : '';
  const lastViewed = lastViewedAtIso ? `, last viewed ${lastViewedAtIso.slice(0, 10)}` : '';
  return `${prefix} ${watched}/${total} eps${percent}${lastViewed}`;
}

function compactWatchLabel(context, prefix = '') {
  if (!context?.available || context.watchedEpisodeCount === null || context.episodeCount === null) {
    return `${prefix ? `${prefix} ` : ''}unknown`;
  }
  const labelPrefix = prefix ? `${prefix} ` : '';
  return `${labelPrefix}${context.watchedEpisodeCount}/${context.episodeCount} eps`;
}

function compactCandidateWatchLabel(context) {
  if (!context?.available || context.candidateWatchedEpisodeCount === null || context.candidateEpisodeCount === null) {
    return 'older unknown';
  }
  return `older ${context.candidateWatchedEpisodeCount}/${context.candidateEpisodeCount} eps`;
}

function seasonRangeLabel(seasons) {
  const values = [...new Set(seasons || [])].sort((a, b) => a - b);
  if (values.length === 0) return 'none';
  const ranges = [];
  let start = values[0];
  let previous = values[0];

  for (const value of values.slice(1)) {
    if (value === previous + 1) {
      previous = value;
      continue;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    start = value;
    previous = value;
  }
  ranges.push(start === previous ? String(start) : `${start}-${previous}`);
  return ranges.join(', ');
}

function renderTvApprovalPrompt(show, index, total) {
  const title = color.bold(`[${index + 1}/${total}] ${show.show}`);
  const reclaim = [
    color.bold(`all ${formatBytes(show.allBytes)}`),
    color.yellow(`older ${formatBytes(show.candidateBytes)}`),
  ].join(' | ');
  const audience = [
    color.cyan(compactAudienceLabel(show.audienceContext, 'all')),
    color.cyan(compactCandidateAudienceLabel(show.audienceContext)),
  ].join(' | ');
  const watch = [
    color.blue(compactWatchLabel(show.watchContext, 'all')),
    color.blue(compactCandidateWatchLabel(show.watchContext)),
  ].join(' | ');
  const seasons = [
    `all ${seasonRangeLabel(show.allSeasons)}`,
    `older ${seasonRangeLabel(show.candidateSeasons)}`,
    `keep ${seasonRangeLabel(show.keepSeasons)}`,
  ].join(' | ');
  const remote = show.remoteContextLabel || 'no remote context';

  return [
    '',
    title,
    `  Reclaim: ${reclaim}`,
    `  Audience: ${audience}`,
    `  Watch: ${watch}`,
    `  Seasons: ${seasons}`,
    `  Remote: ${remote}`,
  ].join('\n');
}

function tvApprovalPromptText() {
  return `${color.red('[a] all')}  ${color.yellow('[o] older only')}  ${color.green('[k] keep')}  ${color.gray('[s] skip')}  [q] quit: `;
}

async function askTvApproval(candidates) {
  const pipedAnswers = process.stdin.isTTY
    ? null
    : readFileSync(0, 'utf8').split(/\r?\n/);
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const decisions = [];
  let pipedAnswerIndex = 0;

  const ask = async (prompt) => {
    if (pipedAnswers) {
      const answer = pipedAnswers[pipedAnswerIndex] ?? 'q';
      pipedAnswerIndex += 1;
      process.stdout.write(prompt);
      process.stdout.write(`${answer}\n`);
      return answer;
    }
    return rl.question(prompt);
  };

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const show = candidates[index];
      console.log(renderTvApprovalPrompt(show, index, candidates.length));

      let decision = null;
      while (!decision) {
        const answer = await ask(tvApprovalPromptText());
        decision = tvApprovalDecisionFromAnswer(answer);
        if (!decision) console.log('Please answer a, o, k, s, or q.');
      }

      if (decision === 'quit') break;
      const cleanupMode = cleanupModeForDecision(decision);
      decisions.push({
        decision: normalizedApprovalDecision(decision),
        cleanupMode,
        decidedAt: new Date().toISOString(),
        show: show.show,
        focus: Boolean(show.focus),
        totalBytes: Number(show.totalBytes || 0),
        keepBytes: Number(show.keepBytes || 0),
        candidateBytes: cleanupMode === 'remove-all' ? Number(show.allBytes || 0) : Number(show.candidateBytes || 0),
        olderCandidateBytes: Number(show.candidateBytes || 0),
        allBytes: Number(show.allBytes || 0),
        keepSeasons: cleanupMode === 'remove-all' ? [] : show.keepSeasons || [],
        candidateSeasons: cleanupMode === 'remove-all' ? show.allSeasons || [] : show.candidateSeasons || [],
        olderCandidateSeasons: show.candidateSeasons || [],
        allSeasons: show.allSeasons || [],
        watchContext: show.watchContext || null,
        audienceContext: show.audienceContext || null,
        remoteContextLabel: show.remoteContextLabel || '',
        remoteContext: show.remoteContext || null,
      });
    }
  } finally {
    rl?.close();
  }

  return decisions;
}

function writeTvApprovalReport(decisions, candidates, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'tv-approval.json');
  const csvPath = join(opts.outDir, 'tv-approval.csv');
  const mdPath = join(opts.outDir, 'tv-approval.md');
  const counts = decisions.reduce((memo, row) => {
    memo[row.decision] = (memo[row.decision] || 0) + 1;
    return memo;
  }, {});
  const approved = decisions.filter((row) => row.decision === 'approve-remove');
  const approvedAll = approved.filter((row) => row.cleanupMode === 'remove-all');
  const approvedOlder = approved.filter((row) => row.cleanupMode !== 'remove-all');
  const kept = decisions.filter((row) => row.decision === 'keep');
  const skipped = decisions.filter((row) => row.decision === 'skip');
  const approvedBytes = approved.reduce((sum, row) => sum + Number(row.candidateBytes || 0), 0);
  const keptBytes = kept.reduce((sum, row) => sum + Number(row.candidateBytes || 0), 0);
  const skippedBytes = skipped.reduce((sum, row) => sum + Number(row.candidateBytes || 0), 0);

  const csvRows = [
    'decision,cleanup_mode,show,candidate_bytes,candidate_size,total_bytes,keep_bytes,watch_status,candidate_watch_status,audience_users,candidate_audience_users,audience_plays,candidate_audience_plays,watched_episodes,total_episodes,candidate_watched_episodes,candidate_total_episodes,keep_seasons,candidate_seasons,older_candidate_seasons,all_seasons,remote_context',
    ...decisions.map((show) =>
      [
        show.decision,
        show.cleanupMode || '',
        show.show,
        show.candidateBytes,
        formatBytes(show.candidateBytes),
        show.totalBytes,
        show.keepBytes,
        show.watchContext?.label || '',
        show.watchContext?.candidateLabel || '',
        show.audienceContext?.userCount ?? '',
        show.audienceContext?.candidateUserCount ?? '',
        show.audienceContext?.plays ?? '',
        show.audienceContext?.candidatePlays ?? '',
        show.watchContext?.watchedEpisodeCount ?? '',
        show.watchContext?.episodeCount ?? '',
        show.watchContext?.candidateWatchedEpisodeCount ?? '',
        show.watchContext?.candidateEpisodeCount ?? '',
        show.keepSeasons.join(' '),
        show.candidateSeasons.join(' '),
        (show.olderCandidateSeasons || []).join(' '),
        (show.allSeasons || []).join(' '),
        show.remoteContextLabel,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const tableRows = (rows) =>
    rows.map((show) =>
      `| ${String(show.show).replaceAll('|', '\\|')} | ${show.cleanupMode || ''} | ${formatBytes(show.candidateBytes)} | ${String(show.audienceContext?.label || '').replaceAll('|', '\\|')} | ${String(show.audienceContext?.candidateLabel || '').replaceAll('|', '\\|')} | ${String(show.watchContext?.label || '').replaceAll('|', '\\|')} | ${String(show.watchContext?.candidateLabel || '').replaceAll('|', '\\|')} | ${show.keepSeasons.join(', ')} | ${show.candidateSeasons.join(', ')} | ${String(show.remoteContextLabel || '').replaceAll('|', '\\|')} |`,
    );

  const mdRows = [
    '# TV Approval Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This report records review decisions only. It does not delete media or change Sonarr.',
    '',
    '## Summary',
    '',
    `- Candidates offered: ${candidates.length}`,
    `- Decisions recorded: ${decisions.length}`,
    `- Complete review: ${decisions.length === candidates.length ? 'yes' : 'no'}`,
    `- Approved for removal: ${counts['approve-remove'] || 0} (${formatBytes(approvedBytes)})`,
    `- Approved remove all: ${approvedAll.length}`,
    `- Approved remove older only: ${approvedOlder.length}`,
    `- Kept/exempted: ${counts.keep || 0} (${formatBytes(keptBytes)})`,
    `- Skipped: ${counts.skip || 0} (${formatBytes(skippedBytes)})`,
    '',
    '## Approved For Removal',
    '',
    '| Show | Cleanup Mode | Reclaim | Audience | Candidate Audience | Watch | Candidate Watch | Keep Seasons | Delete Seasons | Remote Context |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
    ...tableRows(approved),
    '',
    '## Kept / Exempted',
    '',
    '| Show | Cleanup Mode | Reclaim | Audience | Candidate Audience | Watch | Candidate Watch | Keep Seasons | Delete Seasons | Remote Context |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
    ...tableRows(kept),
    '',
    '## Skipped',
    '',
    '| Show | Cleanup Mode | Reclaim | Audience | Candidate Audience | Watch | Candidate Watch | Keep Seasons | Delete Seasons | Remote Context |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
    ...tableRows(skipped),
  ];

  writeJsonFile(jsonPath, {
    options: opts,
    summary: {
      candidates: candidates.length,
      decisions: decisions.length,
      complete: decisions.length === candidates.length,
      approved: approved.length,
      approvedBytes,
      approvedAll: approvedAll.length,
      approvedOlder: approvedOlder.length,
      kept: kept.length,
      keptBytes,
      skipped: skipped.length,
      skippedBytes,
    },
    decisions,
  });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);

  return { jsonPath, csvPath, mdPath, approved, kept, skipped, approvedBytes };
}

async function runTvApproval(opts) {
  requireOption(opts, 'cleanupJson');
  const cleanup = JSON.parse(readFileSync(opts.cleanupJson, 'utf8'));
  const candidates = tvApprovalCandidates(cleanup, opts);
  if (candidates.length === 0) throw new Error('No TV candidates matched the approval filters');

  const decisions = await askTvApproval(candidates);
  const report = writeTvApprovalReport(decisions, candidates, opts);

  console.log('');
  console.log(`Decisions recorded: ${decisions.length}/${candidates.length}`);
  console.log(`Approved for removal: ${report.approved.length}`);
  console.log(`Approved size: ${formatBytes(report.approvedBytes)}`);
  console.log(`Kept/exempted: ${report.kept.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function movieIdentityKeys(item) {
  return [
    ...providerKeys(item).map((key) => `provider:${key}`),
    `fallback:${fallbackKey(item)}`,
  ];
}

function buildMovieOverlapContext(path) {
  if (!path) return new Map();

  const comparison = JSON.parse(readFileSync(path, 'utf8'));
  const byKey = new Map();

  for (const match of comparison.matches || []) {
    if (match.local?.type !== 'movie') continue;
    const context = {
      remoteTitle: match.remote?.title || '',
      remoteYear: match.remote?.year || null,
      remoteLibrary: match.remote?.library || '',
      method: match.method,
      remoteMatchCount: match.remoteMatchCount || 1,
    };
    for (const key of movieIdentityKeys(match.local)) {
      byKey.set(key, context);
    }
  }

  return byKey;
}

function findMovieOverlapContext(movie, overlapByKey) {
  for (const key of movieIdentityKeys(movie)) {
    const context = overlapByKey.get(key);
    if (context) return context;
  }
  return null;
}

function daysSinceUnix(value, nowMs) {
  const parsed = plexTimestamp(value);
  if (!parsed) return null;
  return Math.floor((nowMs - parsed * 1000) / (24 * 60 * 60 * 1000));
}

function movieWatchStatus(movie) {
  const viewCount = Number(movie.viewCount || 0);
  if (viewCount > 0 && movie.lastViewedAt) return `watched ${viewCount}x`;
  if (viewCount > 0) return `watched ${viewCount}x, date unknown`;
  if (movie.lastViewedAt) return 'viewed, count unknown';
  return 'never viewed';
}

function normalizedRatingValue(value) {
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating <= 0) return null;
  if (rating > 10 && rating <= 100) return rating / 10;
  if (rating > 10) return null;
  return rating;
}

function movieRatingSources(movie) {
  return [
    ['critic', movie.rating],
    ['audience', movie.audienceRating],
    ['user', movie.userRating],
  ]
    .map(([source, value]) => ({ source, value: normalizedRatingValue(value) }))
    .filter((rating) => rating.value !== null);
}

function movieRatingContext(movie, lowRatingMax) {
  const sources = movieRatingSources(movie);
  const publicSources = sources.filter((rating) => rating.source !== 'user');
  const comparedSources = publicSources.length > 0 ? publicSources : sources;
  const lowSources = comparedSources.filter((rating) => rating.value <= lowRatingMax);
  const lowest = comparedSources.toSorted((a, b) => a.value - b.value)[0] || null;

  return {
    lowRated: lowSources.length > 0,
    lowRatingMax,
    lowestRating: lowest?.value ?? null,
    lowestRatingSource: lowest?.source ?? null,
    ratingLabel: sources.map((rating) => `${rating.source}:${rating.value.toFixed(1)}`).join(' ') || '',
  };
}

function movieReviewPriority(movie, remoteContext, nowMs, lowRatingMax) {
  const viewCount = Number(movie.viewCount || 0);
  const watched = viewCount > 0 || Boolean(movie.lastViewedAt);
  const daysSinceViewed = daysSinceUnix(movie.lastViewedAt, nowMs);
  const sizeGb = Number(movie.sizeBytes || 0) / 1024 / 1024 / 1024;
  const ratingContext = movieRatingContext(movie, lowRatingMax);

  if (!watched && ratingContext.lowRated && remoteContext) return { rank: 0, label: 'highest: never viewed, low-rated, remote overlap' };
  if (!watched && ratingContext.lowRated) return { rank: 1, label: 'highest: never viewed and low-rated' };
  if (!watched && remoteContext) return { rank: 2, label: 'high: never viewed and remote overlap' };
  if (!watched) return { rank: 3, label: 'high: never viewed' };
  if (remoteContext && daysSinceViewed !== null && daysSinceViewed >= 730) {
    return { rank: 4, label: 'high: remote overlap and not viewed in 2y' };
  }
  if (sizeGb >= 30 && remoteContext) return { rank: 5, label: 'medium: very large with remote overlap' };
  if (daysSinceViewed !== null && daysSinceViewed >= 365) return { rank: 6, label: 'medium: not viewed in 1y' };
  if (remoteContext) return { rank: 7, label: 'review: remote overlap' };
  return { rank: 8, label: 'review: local size only' };
}

function buildMovieReview(localInventory, opts) {
  const minMovieBytes = Number(opts.minMovieGb) * 1024 * 1024 * 1024;
  const nowMs = Date.now();
  const overlapByKey = buildMovieOverlapContext(opts.overlapJson);
  const movies = localInventory.items.filter((item) => item.type === 'movie');

  const candidates = movies
    .filter((movie) => Number(movie.sizeBytes || 0) >= minMovieBytes)
    .map((movie) => {
      const remoteContext = findMovieOverlapContext(movie, overlapByKey);
      const ratingContext = movieRatingContext(movie, opts.lowRatingMax);
      const priority = movieReviewPriority(movie, remoteContext, nowMs, opts.lowRatingMax);
      const viewCount = Number(movie.viewCount || 0);
      const lastViewedDaysAgo = daysSinceUnix(movie.lastViewedAt, nowMs);
      const addedDaysAgo = daysSinceUnix(movie.addedAt, nowMs);
      return {
        title: movie.title,
        year: movie.year || null,
        library: movie.library || '',
        sizeBytes: Number(movie.sizeBytes || 0),
        path: movie.path || '',
        viewCount,
        lastViewedAt: movie.lastViewedAt || null,
        lastViewedAtIso: movie.lastViewedAtIso || timestampIso(movie.lastViewedAt),
        lastViewedDaysAgo,
        addedAt: movie.addedAt || null,
        addedAtIso: movie.addedAtIso || timestampIso(movie.addedAt),
        addedDaysAgo,
        originallyAvailableAt: movie.originallyAvailableAt || null,
        contentRating: movie.contentRating || null,
        rating: movie.rating ?? null,
        audienceRating: movie.audienceRating ?? null,
        userRating: movie.userRating ?? null,
        ratingLabel: ratingContext.ratingLabel,
        lowRated: ratingContext.lowRated,
        lowRatingMax: ratingContext.lowRatingMax,
        lowestRating: ratingContext.lowestRating,
        lowestRatingSource: ratingContext.lowestRatingSource,
        durationMs: movie.durationMs || null,
        watchStatus: movieWatchStatus(movie),
        priority: priority.label,
        priorityRank: priority.rank,
        remoteOverlap: Boolean(remoteContext),
        remoteContext,
      };
    });

  candidates.sort(
    (a, b) =>
      a.priorityRank - b.priorityRank ||
      Number(b.sizeBytes || 0) - Number(a.sizeBytes || 0) ||
      String(a.title).localeCompare(String(b.title)),
  );

  return { movies, candidates };
}

function formatDays(days) {
  if (days === null || days === undefined || Number.isNaN(days)) return '';
  if (days < 31) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}

function writeMovieReviewReport(review, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'movie-review.json');
  const csvPath = join(opts.outDir, 'movie-review.csv');
  const mdPath = join(opts.outDir, 'movie-review.md');
  const topN = Number.isInteger(opts.topN) && opts.topN > 0 ? opts.topN : 200;
  const tableCandidates = review.candidates.slice(0, topN);
  const totalMovieBytes = review.movies.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);
  const candidateBytes = review.candidates.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);
  const neverViewed = review.candidates.filter((movie) => movie.watchStatus === 'never viewed');
  const neverViewedBytes = neverViewed.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);
  const lowRated = review.candidates.filter((movie) => movie.lowRated);
  const lowRatedBytes = lowRated.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);
  const neverViewedLowRated = review.candidates.filter((movie) => movie.watchStatus === 'never viewed' && movie.lowRated);
  const neverViewedLowRatedBytes = neverViewedLowRated.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);
  const remoteOverlap = review.candidates.filter((movie) => movie.remoteOverlap);
  const remoteOverlapBytes = remoteOverlap.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);
  const highest = review.candidates.filter((movie) => movie.priorityRank <= 3);
  const highestBytes = highest.reduce((sum, movie) => sum + Number(movie.sizeBytes || 0), 0);

  const csvRows = [
    'priority,title,year,size_bytes,size,watch_status,rating,low_rated,last_viewed,days_since_viewed,added,days_since_added,remote_overlap,remote_title,remote_library,remote_extra_copies,path',
    ...review.candidates.map((movie) =>
      [
        movie.priority,
        movie.title,
        movie.year ?? '',
        movie.sizeBytes,
        formatBytes(movie.sizeBytes),
        movie.watchStatus,
        movie.ratingLabel,
        movie.lowRated ? 'yes' : 'no',
        movie.lastViewedAtIso || '',
        movie.lastViewedDaysAgo ?? '',
        movie.addedAtIso || '',
        movie.addedDaysAgo ?? '',
        movie.remoteOverlap ? 'yes' : 'no',
        movie.remoteContext?.remoteTitle || '',
        movie.remoteContext?.remoteLibrary || '',
        movie.remoteContext ? movie.remoteContext.remoteMatchCount - 1 : '',
        movie.path,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const mdRows = [
    '# Large Movie Review',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Minimum movie size: ${opts.minMovieGb} GB`,
    `Low-rating threshold: ${opts.lowRatingMax}/10`,
    '',
    'This report is read-only. Remote overlap is context only because the secondary Plex server is best-effort.',
    '',
    '## Summary',
    '',
    `- Local movies analyzed: ${review.movies.length}`,
    `- Local movie library size represented in export: ${formatBytes(totalMovieBytes)}`,
    `- Large movie candidates: ${review.candidates.length}`,
    `- Large movie candidate size: ${formatBytes(candidateBytes)}`,
    `- Never-viewed large candidates: ${neverViewed.length} (${formatBytes(neverViewedBytes)})`,
    `- Low-rated large candidates: ${lowRated.length} (${formatBytes(lowRatedBytes)})`,
    `- Never-viewed and low-rated large candidates: ${neverViewedLowRated.length} (${formatBytes(neverViewedLowRatedBytes)})`,
    `- Large candidates also found on remote: ${remoteOverlap.length} (${formatBytes(remoteOverlapBytes)})`,
    `- Highest/high priority candidate size: ${formatBytes(highestBytes)}`,
    '',
    `## Top ${tableCandidates.length} Candidates`,
    '',
    '| Priority | Movie | Size | Watch | Rating | Last Viewed | Remote | Path |',
    '| --- | --- | ---: | --- | --- | ---: | --- | --- |',
    ...tableCandidates.map((movie) => {
      const title = `${movie.title}${movie.year ? ` (${movie.year})` : ''}`.replaceAll('|', '\\|');
      const remote = movie.remoteOverlap
        ? `${movie.remoteContext.remoteTitle}${movie.remoteContext.remoteYear ? ` (${movie.remoteContext.remoteYear})` : ''} / ${movie.remoteContext.remoteLibrary}`.replaceAll('|', '\\|')
        : '';
      return `| ${movie.priority.replaceAll('|', '\\|')} | ${title} | ${formatBytes(movie.sizeBytes)} | ${movie.watchStatus.replaceAll('|', '\\|')} | ${String(movie.ratingLabel || '').replaceAll('|', '\\|')} | ${formatDays(movie.lastViewedDaysAgo)} | ${remote} | \`${String(movie.path).replaceAll('`', '\\`')}\` |`;
    }),
  ];

  writeJsonFile(jsonPath, {
    options: opts,
    summary: {
      movies: review.movies.length,
      totalMovieBytes,
      candidates: review.candidates.length,
      candidateBytes,
      neverViewed: neverViewed.length,
      neverViewedBytes,
      lowRated: lowRated.length,
      lowRatedBytes,
      neverViewedLowRated: neverViewedLowRated.length,
      neverViewedLowRatedBytes,
      remoteOverlap: remoteOverlap.length,
      remoteOverlapBytes,
      highest: highest.length,
      highestBytes,
    },
    candidates: review.candidates,
  });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);

  return { jsonPath, csvPath, mdPath, summary: { candidateBytes, candidates: review.candidates.length, highestBytes, highest: highest.length } };
}

function runMovieReview(opts) {
  requireOption(opts, 'local');
  if (!Number.isFinite(opts.minMovieGb) || opts.minMovieGb < 0) {
    throw new Error('--min-movie-gb must be a non-negative number');
  }
  if (!Number.isFinite(opts.lowRatingMax) || opts.lowRatingMax < 0 || opts.lowRatingMax > 10) {
    throw new Error('--low-rating-max must be a number from 0 to 10');
  }
  if (!Number.isInteger(opts.topN) || opts.topN < 1) {
    throw new Error('--top-n must be a positive integer');
  }

  const local = normalizeInventory(JSON.parse(readFileSync(opts.local, 'utf8')));
  const review = buildMovieReview(local, opts);
  const report = writeMovieReviewReport(review, opts);

  console.log(`Large movie candidates: ${report.summary.candidates}`);
  console.log(`Large movie candidate size: ${formatBytes(report.summary.candidateBytes)}`);
  console.log(`Highest/high priority candidates: ${report.summary.highest}`);
  console.log(`Highest/high priority size: ${formatBytes(report.summary.highestBytes)}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function movieApprovalCandidates(review, opts) {
  let candidates = [...(review.candidates || [])];
  if (!Number.isFinite(opts.minMovieGb) || opts.minMovieGb < 0) {
    throw new Error('--min-movie-gb must be a non-negative number');
  }
  if (opts.minMovieGb > 0) {
    const minBytes = Number(opts.minMovieGb) * 1024 * 1024 * 1024;
    candidates = candidates.filter((candidate) => Number(candidate.sizeBytes || 0) >= minBytes);
  }
  if (opts.unwatchedOnly) {
    candidates = candidates.filter((candidate) => candidate.watchStatus === 'never viewed');
  }
  if (opts.remoteOverlapOnly) {
    candidates = candidates.filter((candidate) => candidate.remoteOverlap === true);
  }
  if ((opts.excludeApprovalJsons || []).length > 0) {
    const excludedPaths = new Set();
    for (const path of opts.excludeApprovalJsons) {
      const approval = JSON.parse(readFileSync(path, 'utf8'));
      for (const decision of approval.decisions || []) {
        if (decision.path) excludedPaths.add(decision.path);
      }
    }
    candidates = candidates.filter((candidate) => !excludedPaths.has(candidate.path));
  }
  if (opts.priorityRankMax !== null && opts.priorityRankMax !== undefined) {
    if (!Number.isInteger(opts.priorityRankMax) || opts.priorityRankMax < 0) {
      throw new Error('--priority-rank-max must be a non-negative integer');
    }
    candidates = candidates.filter((candidate) => Number(candidate.priorityRank) <= opts.priorityRankMax);
  }
  if (opts.maxItems !== null && opts.maxItems !== undefined) {
    if (!Number.isInteger(opts.maxItems) || opts.maxItems < 1) {
      throw new Error('--max-items must be a positive integer');
    }
    candidates = candidates.slice(0, opts.maxItems);
  }
  return candidates;
}

function movieLabel(movie) {
  return `${movie.title}${movie.year ? ` (${movie.year})` : ''}`;
}

function approvalDecisionFromAnswer(answer) {
  const normalized = String(answer || '').trim().toLowerCase();
  if (['y', 'yes', 'approve', 'delete', 'remove'].includes(normalized)) return 'approve-remove';
  if (['n', 'no', 'keep', 'exempt'].includes(normalized)) return 'keep';
  if (['s', 'skip'].includes(normalized)) return 'skip';
  if (['q', 'quit', 'exit'].includes(normalized)) return 'quit';
  return null;
}

function tvApprovalDecisionFromAnswer(answer) {
  const normalized = String(answer || '').trim().toLowerCase();
  if (['a', 'all', 'approve-all', 'delete-all', 'remove-all'].includes(normalized)) return 'approve-remove-all';
  if (['o', 'old', 'older', 'approve-older', 'delete-older', 'remove-older', 'y', 'yes', 'approve', 'delete', 'remove'].includes(normalized)) return 'approve-remove-older';
  if (['k', 'n', 'no', 'keep', 'exempt'].includes(normalized)) return 'keep';
  if (['s', 'skip'].includes(normalized)) return 'skip';
  if (['q', 'quit', 'exit'].includes(normalized)) return 'quit';
  return null;
}

function cleanupModeForDecision(decision) {
  if (decision === 'approve-remove-all') return 'remove-all';
  if (decision === 'approve-remove-older' || decision === 'approve-remove') return 'remove-older';
  return null;
}

function normalizedApprovalDecision(decision) {
  if (decision === 'approve-remove-all' || decision === 'approve-remove-older' || decision === 'approve-remove') {
    return 'approve-remove';
  }
  return decision;
}

async function askMovieApproval(candidates) {
  const pipedAnswers = process.stdin.isTTY
    ? null
    : readFileSync(0, 'utf8').split(/\r?\n/);
  const rl = process.stdin.isTTY
    ? createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const decisions = [];
  let pipedAnswerIndex = 0;

  const ask = async (prompt) => {
    if (pipedAnswers) {
      const answer = pipedAnswers[pipedAnswerIndex] ?? 'q';
      pipedAnswerIndex += 1;
      process.stdout.write(prompt);
      process.stdout.write(`${answer}\n`);
      return answer;
    }
    return rl.question(prompt);
  };

  try {
    for (let index = 0; index < candidates.length; index += 1) {
      const movie = candidates[index];
      const remote = movie.remoteOverlap
        ? `${movie.remoteContext?.remoteTitle || 'remote match'}${movie.remoteContext?.remoteLibrary ? ` / ${movie.remoteContext.remoteLibrary}` : ''}`
        : 'no remote match';

      console.log('');
      console.log(`[${index + 1}/${candidates.length}] ${movieLabel(movie)}`);
      console.log(`  Size: ${formatBytes(movie.sizeBytes)} | Watch: ${movie.watchStatus} | Rating: ${movie.ratingLabel || 'none'} | Remote: ${remote}`);
      console.log(`  Priority: ${movie.priority}`);
      console.log(`  Path: ${movie.path}`);

      let decision = null;
      while (!decision) {
        const answer = await ask('Approve removal? [y]es / [n]o keep / [s]kip / [q]uit: ');
        decision = approvalDecisionFromAnswer(answer);
        if (!decision) console.log('Please answer y, n, s, or q.');
      }

      if (decision === 'quit') break;
      decisions.push({
        decision,
        decidedAt: new Date().toISOString(),
        ...movie,
      });
    }
  } finally {
    rl?.close();
  }

  return decisions;
}

function writeMovieApprovalReport(decisions, candidates, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'movie-approval.json');
  const csvPath = join(opts.outDir, 'movie-approval.csv');
  const mdPath = join(opts.outDir, 'movie-approval.md');
  const counts = decisions.reduce((memo, row) => {
    memo[row.decision] = (memo[row.decision] || 0) + 1;
    return memo;
  }, {});
  const approved = decisions.filter((row) => row.decision === 'approve-remove');
  const kept = decisions.filter((row) => row.decision === 'keep');
  const skipped = decisions.filter((row) => row.decision === 'skip');
  const approvedBytes = approved.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
  const keptBytes = kept.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);
  const skippedBytes = skipped.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0);

  const csvRows = [
    'decision,title,year,size_bytes,size,watch_status,rating,priority,remote_overlap,path',
    ...decisions.map((movie) =>
      [
        movie.decision,
        movie.title,
        movie.year ?? '',
        movie.sizeBytes,
        formatBytes(movie.sizeBytes),
        movie.watchStatus,
        movie.ratingLabel,
        movie.priority,
        movie.remoteOverlap ? 'yes' : 'no',
        movie.path,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const tableRows = (rows) =>
    rows.map((movie) =>
      `| ${movieLabel(movie).replaceAll('|', '\\|')} | ${formatBytes(movie.sizeBytes)} | ${String(movie.ratingLabel || '').replaceAll('|', '\\|')} | ${String(movie.priority || '').replaceAll('|', '\\|')} | \`${String(movie.path || '').replaceAll('`', '\\`')}\` |`,
    );

  const mdRows = [
    '# Movie Approval Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This report records review decisions only. It does not delete media or change Radarr.',
    '',
    '## Summary',
    '',
    `- Candidates offered: ${candidates.length}`,
    `- Decisions recorded: ${decisions.length}`,
    `- Complete review: ${decisions.length === candidates.length ? 'yes' : 'no'}`,
    `- Approved for removal: ${counts['approve-remove'] || 0} (${formatBytes(approvedBytes)})`,
    `- Kept/exempted: ${counts.keep || 0} (${formatBytes(keptBytes)})`,
    `- Skipped: ${counts.skip || 0} (${formatBytes(skippedBytes)})`,
    '',
    '## Approved For Removal',
    '',
    '| Movie | Size | Rating | Priority | Path |',
    '| --- | ---: | --- | --- | --- |',
    ...tableRows(approved),
    '',
    '## Kept / Exempted',
    '',
    '| Movie | Size | Rating | Priority | Path |',
    '| --- | ---: | --- | --- | --- |',
    ...tableRows(kept),
    '',
    '## Skipped',
    '',
    '| Movie | Size | Rating | Priority | Path |',
    '| --- | ---: | --- | --- | --- |',
    ...tableRows(skipped),
  ];

  writeJsonFile(jsonPath, {
    options: opts,
    summary: {
      candidates: candidates.length,
      decisions: decisions.length,
      complete: decisions.length === candidates.length,
      approved: approved.length,
      approvedBytes,
      kept: kept.length,
      keptBytes,
      skipped: skipped.length,
      skippedBytes,
    },
    decisions,
  });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);

  return { jsonPath, csvPath, mdPath, approved, kept, skipped, approvedBytes };
}

async function runMovieApproval(opts) {
  requireOption(opts, 'reviewJson');
  const review = JSON.parse(readFileSync(opts.reviewJson, 'utf8'));
  const candidates = movieApprovalCandidates(review, opts);
  if (candidates.length === 0) throw new Error('No movie candidates matched the approval filters');

  const decisions = await askMovieApproval(candidates);
  const report = writeMovieApprovalReport(decisions, candidates, opts);

  console.log('');
  console.log(`Decisions recorded: ${decisions.length}/${candidates.length}`);
  console.log(`Approved for removal: ${report.approved.length}`);
  console.log(`Approved size: ${formatBytes(report.approvedBytes)}`);
  console.log(`Kept/exempted: ${report.kept.length}`);
  console.log(`Skipped: ${report.skipped.length}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function mapRootPath(path, fromRoot, toRoot) {
  const normalizedPath = normalizePath(path);
  const normalizedFrom = normalizePath(fromRoot);
  const normalizedTo = normalizePath(toRoot);
  if (normalizedPath === normalizedFrom) return normalizedTo;
  if (!normalizedPath.startsWith(`${normalizedFrom}/`)) return null;
  return joinPath(normalizedTo, normalizedPath.slice(normalizedFrom.length + 1));
}

function movieFolderPath(filePath) {
  return normalizePath(dirname(filePath));
}

function approvedMovieDecisions(approval) {
  return (approval.decisions || []).filter((decision) => decision.decision === 'approve-remove');
}

function fetchRadarrMovies(opts) {
  const container = shellQuote(opts.radarrContainer);
  const script = `
set -e
container=${container}
config_dir=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "$container")
[ -n "$config_dir" ] || { echo "Missing /config mount for $container" >&2; exit 1; }
api_key=$(sed -n 's:.*<ApiKey>\\(.*\\)</ApiKey>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
[ -n "$api_key" ] || { echo "Missing Radarr API key for $container" >&2; exit 1; }
url_base=$(sed -n 's:.*<UrlBase>\\(.*\\)</UrlBase>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
url_base=$(printf '%s' "$url_base" | sed 's:/*$::')
ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
[ -n "$ip" ] || { echo "Missing container IP for $container" >&2; exit 1; }
curl -fsSL -H "X-Api-Key: $api_key" "http://$ip:7878\${url_base}/api/v3/movie"
`;
  return JSON.parse(runSsh(opts.ssh, script));
}

function findRadarrMovie(candidate, movies, opts) {
  const byPath = movies.find((movie) => normalizePath(movie.path) === normalizePath(candidate.radarrFolder));
  if (byPath) return { movie: byPath, matchMethod: 'path' };

  const title = normalizeTitle(candidate.title);
  const byTitleYear = movies.find((movie) =>
    normalizeTitle(movie.title) === title &&
    String(movie.year || '') === String(candidate.year || ''),
  );
  if (byTitleYear) return { movie: byTitleYear, matchMethod: 'title-year' };

  return { movie: null, matchMethod: 'none' };
}

function buildRadarrMovieCandidates(approval, movies, opts) {
  const entries = [];

  for (const decision of approvedMovieDecisions(approval)) {
    const plexFolder = movieFolderPath(decision.path);
    const hostFolder = mapRootPath(plexFolder, opts.plexMovieRoot, opts.hostMovieRoot);
    const hostFile = mapRootPath(decision.path, opts.plexMovieRoot, opts.hostMovieRoot);
    const radarrFolder = mapRootPath(plexFolder, opts.plexMovieRoot, opts.radarrMovieRoot);

    const base = {
      title: decision.title,
      year: decision.year || null,
      sizeBytes: decision.sizeBytes || 0,
      ratingLabel: decision.ratingLabel || '',
      watchStatus: decision.watchStatus || '',
      priority: decision.priority || '',
      plexPath: decision.path,
      plexFolder,
      hostFile,
      hostFolder,
      radarrFolder,
    };

    if (!hostFolder || !hostFile || !radarrFolder) {
      entries.push({ ...base, status: 'path-map-failed', matchMethod: 'none' });
      continue;
    }

    const match = findRadarrMovie(base, movies, opts);
    if (!match.movie) {
      entries.push({ ...base, status: 'missing-radarr-movie', matchMethod: match.matchMethod });
      continue;
    }

    entries.push({
      ...base,
      status: 'pending-disk-verify',
      matchMethod: match.matchMethod,
      radarrId: match.movie.id,
      tmdbId: match.movie.tmdbId,
      imdbId: match.movie.imdbId,
      radarrTitle: match.movie.title,
      radarrYear: match.movie.year || null,
      radarrPath: match.movie.path,
      monitored: match.movie.monitored,
    });
  }

  return entries;
}

function verifyRadarrMovieDeleteCandidates(opts, entries) {
  if (entries.length === 0) return [];

  const payloadBase64 = Buffer.from(JSON.stringify(entries)).toString('base64');
  const safeRoot = shellQuote(normalizePath(opts.hostMovieRoot));
  const script = `
set -e
safe_root=${safeRoot}
payload=$(printf '%s' ${shellQuote(payloadBase64)} | base64 -d)
printf '%s\\n' "$payload" | jq -c '.[]' | while IFS= read -r row; do
  status=$(printf '%s\\n' "$row" | jq -r '.status')
  folder=$(printf '%s\\n' "$row" | jq -r '.hostFolder // ""')
  file=$(printf '%s\\n' "$row" | jq -r '.hostFile // ""')
  path_safe=no
  disk_status=not-checked
  file_status=not-checked
  actual_bytes=0
  file_count=0

  case "$folder" in
    "$safe_root"/*) path_safe=yes ;;
  esac

  if [ "$status" = pending-disk-verify ] && [ "$path_safe" = yes ] && [ ! -L "$folder" ] && [ -d "$folder" ]; then
    disk_status=exists
    if [ -f "$file" ]; then file_status=exists; else file_status=missing; fi
    size_kib=$(du -sk -- "$folder" 2>/dev/null | awk '{print $1}')
    file_count=$(find "$folder" -type f 2>/dev/null | wc -l | tr -d ' ')
    actual_bytes=$((size_kib * 1024))
    status=ready
  elif [ "$status" = pending-disk-verify ] && [ "$path_safe" != yes ]; then
    status=blocked-unsafe-path
    disk_status=blocked
  elif [ "$status" = pending-disk-verify ] && [ -L "$folder" ]; then
    status=blocked-symlink
    disk_status=blocked
  elif [ "$status" = pending-disk-verify ] && [ ! -d "$folder" ]; then
    status=missing-disk-folder
    disk_status=missing
  fi

  printf '%s\\n' "$row" | jq -c \
    --arg status "$status" \
    --arg diskStatus "$disk_status" \
    --arg fileStatus "$file_status" \
    --arg pathSafe "$path_safe" \
    --argjson actualBytes "$actual_bytes" \
    --argjson fileCount "$file_count" \
    '. + {status: $status, diskStatus: $diskStatus, fileStatus: $fileStatus, pathSafe: $pathSafe, actualBytes: $actualBytes, fileCount: $fileCount}'
done
`;

  return runSsh(opts.ssh, script)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeRadarrMovieDeletePlan(entries, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'radarr-movie-delete-plan.json');
  const csvPath = join(opts.outDir, 'radarr-movie-delete-plan.csv');
  const mdPath = join(opts.outDir, 'radarr-movie-delete-plan.md');
  const counts = entries.reduce((memo, entry) => {
    memo[entry.status] = (memo[entry.status] || 0) + 1;
    return memo;
  }, {});
  const ready = entries.filter((entry) => entry.status === 'ready');
  const readyBytes = ready.reduce((sum, entry) => sum + Number(entry.actualBytes || 0), 0);
  const readyFiles = ready.reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0);

  const csvRows = [
    'status,title,year,radarr_id,monitored,match_method,host_folder,actual_bytes,file_count,rating,watch_status',
    ...entries.map((entry) =>
      [
        entry.status,
        entry.title,
        entry.year ?? '',
        entry.radarrId ?? '',
        entry.monitored ?? '',
        entry.matchMethod,
        entry.hostFolder ?? '',
        entry.actualBytes ?? '',
        entry.fileCount ?? '',
        entry.ratingLabel,
        entry.watchStatus,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const mdRows = [
    '# Radarr Movie Delete Plan',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Radarr container: ${opts.radarrContainer}`,
    `Path mapping: \`${opts.plexMovieRoot}\` -> \`${opts.hostMovieRoot}\` and \`${opts.radarrMovieRoot}\``,
    '',
    'This is a dry-run delete review. No files were deleted. Apply only after reviewing ready entries.',
    '',
    '## Summary',
    '',
    `- Approved movie decisions: ${entries.length}`,
    `- Ready to unmonitor/delete: ${counts.ready || 0}`,
    `- Missing Radarr movie: ${counts['missing-radarr-movie'] || 0}`,
    `- Missing disk folder: ${counts['missing-disk-folder'] || 0}`,
    `- Blocked unsafe/symlink/path-map: ${(counts['blocked-unsafe-path'] || 0) + (counts['blocked-symlink'] || 0) + (counts['path-map-failed'] || 0)}`,
    `- Estimated ready reclaim: ${formatBytes(readyBytes)}`,
    `- Files under ready folders: ${readyFiles}`,
    '',
    '## Entries',
    '',
    '| Status | Movie | Size | Files | Radarr ID | Monitored | Match | Folder |',
    '| --- | --- | ---: | ---: | ---: | --- | --- | --- |',
    ...entries.map((entry) =>
      `| ${entry.status} | ${movieLabel(entry).replaceAll('|', '\\|')} | ${formatBytes(entry.actualBytes || entry.sizeBytes || 0)} | ${entry.fileCount || 0} | ${entry.radarrId ?? ''} | ${entry.monitored ?? ''} | ${entry.matchMethod} | \`${String(entry.hostFolder || '').replaceAll('`', '\\`')}\` |`,
    ),
  ];

  writeJsonFile(jsonPath, { options: opts, counts, summary: { ready: ready.length, readyBytes, readyFiles }, entries });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath, counts, ready, readyBytes, readyFiles };
}

function runRadarrMovieDeletePlan(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  requireOption(opts, 'approvalJson');

  const approval = JSON.parse(readFileSync(opts.approvalJson, 'utf8'));
  const movies = fetchRadarrMovies(opts);
  const candidates = buildRadarrMovieCandidates(approval, movies, opts);
  const verified = verifyRadarrMovieDeleteCandidates(opts, candidates);
  const report = writeRadarrMovieDeletePlan(verified, opts);

  console.log(`Ready to unmonitor/delete: ${report.counts.ready || 0}`);
  console.log(`Missing Radarr movie: ${report.counts['missing-radarr-movie'] || 0}`);
  console.log(`Missing disk folder: ${report.counts['missing-disk-folder'] || 0}`);
  console.log(`Estimated ready reclaim: ${formatBytes(report.readyBytes)}`);
  console.log(`Files under ready folders: ${report.readyFiles}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function applyRadarrMovieDeletes(opts, entries) {
  if (entries.length === 0) return [];

  const payloadBase64 = Buffer.from(JSON.stringify(entries)).toString('base64');
  const container = shellQuote(opts.radarrContainer);
  const safeRoot = shellQuote(normalizePath(opts.hostMovieRoot));
  const script = `
set -e
container=${container}
safe_root=${safeRoot}
payload=$(printf '%s' ${shellQuote(payloadBase64)} | base64 -d)
config_dir=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "$container")
[ -n "$config_dir" ] || { echo "Missing /config mount for $container" >&2; exit 1; }
api_key=$(sed -n 's:.*<ApiKey>\\(.*\\)</ApiKey>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
[ -n "$api_key" ] || { echo "Missing Radarr API key for $container" >&2; exit 1; }
url_base=$(sed -n 's:.*<UrlBase>\\(.*\\)</UrlBase>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
url_base=$(printf '%s' "$url_base" | sed 's:/*$::')
ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
[ -n "$ip" ] || { echo "Missing container IP for $container" >&2; exit 1; }
base_url="http://$ip:7878\${url_base}"

printf '%s\\n' "$payload" | jq -c '.[]' | while IFS= read -r row; do
  folder=$(printf '%s\\n' "$row" | jq -r '.hostFolder')
  movie_id=$(printf '%s\\n' "$row" | jq -r '.radarrId')
  case "$folder" in
    "$safe_root"/*) path_safe=yes ;;
    *) path_safe=no ;;
  esac

  if [ "$path_safe" != yes ]; then
    apply_status=blocked-unsafe-path
    monitored_remaining=null
    actual_bytes=0
    file_count=0
  elif [ -L "$folder" ]; then
    apply_status=blocked-symlink
    monitored_remaining=null
    actual_bytes=0
    file_count=0
  elif [ ! -d "$folder" ]; then
    apply_status=missing-before-delete
    monitored_remaining=null
    actual_bytes=0
    file_count=0
  else
    movie_json=$(curl -fsSL -H "X-Api-Key: $api_key" "$base_url/api/v3/movie/$movie_id")
    updated_json=$(printf '%s\\n' "$movie_json" | jq '.monitored = false')
    printf '%s\\n' "$updated_json" | curl -fsSL -X PUT -H "X-Api-Key: $api_key" -H "Content-Type: application/json" --data-binary @- "$base_url/api/v3/movie/$movie_id" >/dev/null
    verify_json=$(curl -fsSL -H "X-Api-Key: $api_key" "$base_url/api/v3/movie/$movie_id")
    monitored_remaining=$(printf '%s\\n' "$verify_json" | jq '.monitored')
    size_kib=$(du -sk -- "$folder" 2>/dev/null | awk '{print $1}')
    file_count=$(find "$folder" -type f 2>/dev/null | wc -l | tr -d ' ')
    actual_bytes=$((size_kib * 1024))
    rm -rf -- "$folder"
    if [ -e "$folder" ]; then
      apply_status=delete-failed
    else
      apply_status=deleted
    fi
  fi

  printf '%s\\n' "$row" | jq -c \
    --arg applyStatus "$apply_status" \
    --argjson monitoredRemaining "$monitored_remaining" \
    --argjson actualBytes "$actual_bytes" \
    --argjson fileCount "$file_count" \
    '. + {applyStatus: $applyStatus, monitoredRemaining: $monitoredRemaining, actualBytes: $actualBytes, fileCount: $fileCount}'
done
`;

  return runSsh(opts.ssh, script)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeRadarrMovieDeleteApplyReport(results, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'radarr-movie-delete-apply.json');
  const csvPath = join(opts.outDir, 'radarr-movie-delete-apply.csv');
  const mdPath = join(opts.outDir, 'radarr-movie-delete-apply.md');
  const counts = results.reduce((memo, entry) => {
    memo[entry.applyStatus] = (memo[entry.applyStatus] || 0) + 1;
    return memo;
  }, {});
  const deletedBytes = results
    .filter((entry) => entry.applyStatus === 'deleted')
    .reduce((sum, entry) => sum + Number(entry.actualBytes || 0), 0);
  const deletedFiles = results
    .filter((entry) => entry.applyStatus === 'deleted')
    .reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0);
  const stillMonitored = results.filter((entry) => entry.monitoredRemaining === true).length;

  const csvRows = [
    'apply_status,title,year,radarr_id,monitored_remaining,host_folder,actual_bytes,file_count',
    ...results.map((entry) =>
      [
        entry.applyStatus,
        entry.title,
        entry.year ?? '',
        entry.radarrId ?? '',
        entry.monitoredRemaining ?? '',
        entry.hostFolder,
        entry.actualBytes ?? '',
        entry.fileCount ?? '',
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const mdRows = [
    '# Radarr Movie Delete Apply Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This report records Radarr unmonitoring and filesystem deletion for approved movie folders.',
    '',
    '## Summary',
    '',
    `- Deleted folders: ${counts.deleted || 0}`,
    `- Missing before delete: ${counts['missing-before-delete'] || 0}`,
    `- Blocked unsafe paths: ${(counts['blocked-unsafe-path'] || 0) + (counts['blocked-symlink'] || 0)}`,
    `- Delete failures: ${counts['delete-failed'] || 0}`,
    `- Radarr movies still monitored after apply: ${stillMonitored}`,
    `- Deleted bytes measured before removal: ${formatBytes(deletedBytes)}`,
    `- Deleted files measured before removal: ${deletedFiles}`,
    '',
    '## Results',
    '',
    '| Status | Movie | Size | Files | Radarr ID | Monitored Remaining | Folder |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
    ...results.map((entry) =>
      `| ${entry.applyStatus} | ${movieLabel(entry).replaceAll('|', '\\|')} | ${formatBytes(entry.actualBytes || 0)} | ${entry.fileCount || 0} | ${entry.radarrId ?? ''} | ${entry.monitoredRemaining ?? ''} | \`${String(entry.hostFolder || '').replaceAll('`', '\\`')}\` |`,
    ),
  ];

  writeJsonFile(jsonPath, { options: opts, counts, summary: { deletedBytes, deletedFiles, stillMonitored }, results });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath, counts, deletedBytes, deletedFiles, stillMonitored };
}

function runRadarrMovieDeleteApply(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  requireOption(opts, 'planJson');

  const plan = JSON.parse(readFileSync(opts.planJson, 'utf8'));
  const entries = (plan.entries || []).filter((entry) => entry.status === 'ready');
  const results = applyRadarrMovieDeletes(opts, entries);
  const report = writeRadarrMovieDeleteApplyReport(results, opts);

  console.log(`Deleted folders: ${report.counts.deleted || 0}`);
  console.log(`Missing before delete: ${report.counts['missing-before-delete'] || 0}`);
  console.log(`Blocked unsafe paths: ${(report.counts['blocked-unsafe-path'] || 0) + (report.counts['blocked-symlink'] || 0)}`);
  console.log(`Delete failures: ${report.counts['delete-failed'] || 0}`);
  console.log(`Radarr movies still monitored: ${report.stillMonitored}`);
  console.log(`Deleted bytes: ${formatBytes(report.deletedBytes)}`);
  console.log(`Deleted files: ${report.deletedFiles}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function normalizePath(path) {
  return String(path || '').replace(/\/+$/g, '');
}

function joinPath(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && String(part) !== '')
    .map((part, index) => String(part).replace(index === 0 ? /\/+$/g : /^\/+|\/+$/g, ''))
    .join('/');
}

function hostSeasonPath(show, seasonNumber, opts) {
  return joinPath(opts.hostRoot, show, `Season ${String(seasonNumber).padStart(2, '0')}`);
}

function sonarrSeriesPath(show, opts) {
  return joinPath(opts.sonarrRoot, show);
}

function fetchSonarrSeries(opts) {
  const container = shellQuote(opts.sonarrContainer);
  const script = `
set -e
container=${container}
config_dir=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "$container")
[ -n "$config_dir" ] || { echo "Missing /config mount for $container" >&2; exit 1; }
api_key=$(sed -n 's:.*<ApiKey>\\(.*\\)</ApiKey>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
[ -n "$api_key" ] || { echo "Missing Sonarr API key for $container" >&2; exit 1; }
url_base=$(sed -n 's:.*<UrlBase>\\(.*\\)</UrlBase>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
url_base=$(printf '%s' "$url_base" | sed 's:/*$::')
ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
[ -n "$ip" ] || { echo "Missing container IP for $container" >&2; exit 1; }
curl -fsSL -H "X-Api-Key: $api_key" "http://$ip:8989\${url_base}/api/v3/series"
`;
  return JSON.parse(runSsh(opts.ssh, script));
}

function filterCleanupShows(cleanup, opts) {
  if (!['focus', 'other', 'all'].includes(opts.priority)) {
    throw new Error('--priority must be one of: focus, other, all');
  }
  const includeNames = new Set((opts.includeShows || []).map((show) => normalizeTitle(show)));
  const excludeNames = new Set((opts.excludeShows || []).map((show) => normalizeTitle(show)));
  const approvedDecisions = opts.approvedTvShows || null;

  return cleanup.shows
    .filter((show) => {
      const showName = normalizeTitle(show.show);
      if (includeNames.size > 0 && !includeNames.has(showName)) return false;
      if (excludeNames.has(showName)) return false;
      if (approvedDecisions && !approvedDecisions.has(showName)) return false;
      if (show.candidateBytes <= 0 || show.candidateSeasons.length === 0) return false;
      if (opts.priority === 'focus') return show.focus;
      if (opts.priority === 'other') return !show.focus;
      return true;
    })
    .map((show) => applyTvApprovalScope(show, approvedDecisions?.get(normalizeTitle(show.show))));
}

function approvedTvShowsFromApproval(path) {
  if (!path) return null;
  const approval = JSON.parse(readFileSync(path, 'utf8'));
  const approved = new Map();
  for (const decision of approval.decisions || []) {
    if (decision.decision !== 'approve-remove') continue;
    const showName = normalizeTitle(decision.show);
    if (!showName) continue;
    approved.set(showName, decision);
  }
  return approved;
}

function applyTvApprovalScope(show, approvalDecision) {
  if (!approvalDecision) return show;
  if (approvalDecision.cleanupMode !== 'remove-all') {
    return {
      ...show,
      cleanupMode: approvalDecision.cleanupMode || 'remove-older',
    };
  }

  const candidateSeasons = allCleanupSeasons(show);
  return {
    ...show,
    cleanupMode: 'remove-all',
    keepSeasons: [],
    candidateSeasons,
    candidateBytes: Number(show.totalBytes || approvalDecision.candidateBytes || 0),
  };
}

function findSonarrSeries(show, series, opts) {
  const expectedPath = normalizePath(sonarrSeriesPath(show.show, opts));
  const byPath = series.find((item) => normalizePath(item.path) === expectedPath);
  if (byPath) return { series: byPath, matchMethod: 'path' };

  const showTitle = normalizeTitle(show.show);
  const byTitle = series.find((item) => normalizeTitle(item.title) === showTitle);
  if (byTitle) return { series: byTitle, matchMethod: 'title' };

  return { series: null, matchMethod: 'none' };
}

function buildSonarrUnmonitorPlan(cleanup, series, opts) {
  const shows = filterCleanupShows(cleanup, opts);
  const entries = [];

  for (const show of shows) {
    const match = findSonarrSeries(show, series, opts);
    if (!match.series) {
      entries.push({
        show: show.show,
        status: 'missing-series',
        cleanupMode: show.cleanupMode || 'remove-older',
        matchMethod: match.matchMethod,
        candidateBytes: show.candidateBytes,
        showCandidateBytes: show.candidateBytes,
        candidateSeasons: show.candidateSeasons,
        keepSeasons: show.keepSeasons,
        remoteContextLabel: show.remoteContextLabel,
      });
      continue;
    }

    const seasonsByNumber = new Map((match.series.seasons || []).map((season) => [season.seasonNumber, season]));
    for (const seasonNumber of show.candidateSeasons) {
      const season = seasonsByNumber.get(seasonNumber);
      entries.push({
        show: show.show,
        status: season ? (season.monitored ? 'needs-unmonitor' : 'already-unmonitored') : 'missing-season',
        cleanupMode: show.cleanupMode || 'remove-older',
        matchMethod: match.matchMethod,
        seriesId: match.series.id,
        tvdbId: match.series.tvdbId,
        sonarrTitle: match.series.title,
        sonarrPath: match.series.path,
        seasonNumber,
        monitored: season?.monitored ?? null,
        candidatePath: hostSeasonPath(show.show, seasonNumber, opts),
        candidateBytes: show.candidate
          ?.find((candidate) => candidate.seasonNumber === seasonNumber)
          ?.sizeBytes ?? null,
        showCandidateBytes: show.candidateBytes,
        keepSeasons: show.keepSeasons,
        remoteContextLabel: show.remoteContextLabel,
      });
    }
  }

  return entries;
}

function writeSonarrUnmonitorPlan(entries, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'sonarr-unmonitor-plan.json');
  const csvPath = join(opts.outDir, 'sonarr-unmonitor-plan.csv');
  const mdPath = join(opts.outDir, 'sonarr-unmonitor-plan.md');

  const counts = entries.reduce((memo, entry) => {
    memo[entry.status] = (memo[entry.status] || 0) + 1;
    return memo;
  }, {});
  const plannedEntries = entries.filter((entry) => entry.status === 'needs-unmonitor' || entry.status === 'already-unmonitored');
  const removeAllByShow = new Map();
  const plannedBytes = plannedEntries.reduce((sum, entry) => {
    if (entry.cleanupMode !== 'remove-all') return sum + Number(entry.candidateBytes || 0);
    const key = normalizeTitle(entry.show);
    if (removeAllByShow.has(key)) return sum;
    removeAllByShow.set(key, true);
    return sum + Number(entry.showCandidateBytes || 0);
  }, 0);

  const csvRows = [
    'status,cleanup_mode,show,season,series_id,tvdb_id,sonarr_title,sonarr_path,candidate_path,candidate_bytes,match_method,remote_context',
    ...entries.map((entry) =>
      [
        entry.status,
        entry.cleanupMode || '',
        entry.show,
        entry.seasonNumber ?? '',
        entry.seriesId ?? '',
        entry.tvdbId ?? '',
        entry.sonarrTitle ?? '',
        entry.sonarrPath ?? '',
        entry.candidatePath ?? '',
        entry.candidateBytes ?? '',
        entry.matchMethod,
        entry.remoteContextLabel ?? '',
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const rows = entries.map((entry) => {
    const size = entry.candidateBytes ? formatBytes(entry.candidateBytes) : '';
    return `| ${entry.status} | ${entry.cleanupMode || ''} | ${String(entry.show).replaceAll('|', '\\|')} | ${entry.seasonNumber ?? ''} | ${entry.seriesId ?? ''} | ${size} | ${entry.matchMethod} | ${String(entry.remoteContextLabel || '').replaceAll('|', '\\|')} |`;
  });

  const mdRows = [
    '# Sonarr Unmonitor Plan',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Sonarr container: ${opts.sonarrContainer}`,
    `Candidate priority scope: ${opts.priority}`,
    `Path mapping: \`${opts.hostRoot}\` -> \`${opts.sonarrRoot}\``,
    '',
    'This report is read-only. Apply unmonitoring in Sonarr before deleting season folders, and delete only after reviewing the exact candidate paths.',
    '',
    '## Summary',
    '',
    `- Candidate season entries: ${entries.length}`,
    `- Needs unmonitor: ${counts['needs-unmonitor'] || 0}`,
    `- Already unmonitored: ${counts['already-unmonitored'] || 0}`,
    `- Missing Sonarr series: ${counts['missing-series'] || 0}`,
    `- Missing Sonarr season rows: ${counts['missing-season'] || 0}`,
    `- Candidate reclaim represented by mapped/unmonitored seasons: ${formatBytes(plannedBytes)}`,
    '',
    '## Entries',
    '',
    '| Status | Cleanup Mode | Show | Season | Series ID | Size | Match | Remote Context |',
    '| --- | --- | --- | ---: | ---: | ---: | --- | --- |',
    ...rows,
  ];

  writeJsonFile(jsonPath, { options: opts, counts, entries });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath, counts, plannedBytes };
}

function runSonarrUnmonitorPlan(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  requireOption(opts, 'cleanupJson');

  const cleanup = JSON.parse(readFileSync(opts.cleanupJson, 'utf8'));
  opts.approvedTvShows = approvedTvShowsFromApproval(opts.tvApprovalJson);
  const series = fetchSonarrSeries(opts);
  const entries = buildSonarrUnmonitorPlan(cleanup, series, opts);
  const result = writeSonarrUnmonitorPlan(entries, opts);

  console.log(`Candidate season entries: ${entries.length}`);
  console.log(`Needs unmonitor: ${result.counts['needs-unmonitor'] || 0}`);
  console.log(`Already unmonitored: ${result.counts['already-unmonitored'] || 0}`);
  console.log(`Missing Sonarr series: ${result.counts['missing-series'] || 0}`);
  console.log(`Missing Sonarr season rows: ${result.counts['missing-season'] || 0}`);
  console.log(`Mapped candidate reclaim: ${formatBytes(result.plannedBytes)}`);
  console.log(`Markdown: ${result.mdPath}`);
  console.log(`CSV: ${result.csvPath}`);
  console.log(`JSON: ${result.jsonPath}`);
}

function buildSonarrApplyActions(plan) {
  const actions = {};

  for (const entry of plan.entries || []) {
    if (entry.status !== 'needs-unmonitor') continue;
    if (!entry.seriesId || !Number.isInteger(entry.seasonNumber)) continue;
    const key = String(entry.seriesId);
    if (!actions[key]) actions[key] = [];
    actions[key].push(entry.seasonNumber);
  }

  return Object.fromEntries(
    Object.entries(actions).map(([seriesId, seasons]) => [
      seriesId,
      [...new Set(seasons)].sort((a, b) => a - b),
    ]),
  );
}

function applySonarrUnmonitorActions(opts, actions) {
  const container = shellQuote(opts.sonarrContainer);
  const actionsBase64 = Buffer.from(JSON.stringify(actions)).toString('base64');
  const script = `
set -e
container=${container}
actions_json=$(printf '%s' ${shellQuote(actionsBase64)} | base64 -d)
[ "$(printf '%s' "$actions_json" | jq 'length')" -gt 0 ] || exit 0
config_dir=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/config"}}{{.Source}}{{end}}{{end}}' "$container")
[ -n "$config_dir" ] || { echo "Missing /config mount for $container" >&2; exit 1; }
api_key=$(sed -n 's:.*<ApiKey>\\(.*\\)</ApiKey>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
[ -n "$api_key" ] || { echo "Missing Sonarr API key for $container" >&2; exit 1; }
url_base=$(sed -n 's:.*<UrlBase>\\(.*\\)</UrlBase>.*:\\1:p' "$config_dir/config.xml" | head -n 1)
url_base=$(printf '%s' "$url_base" | sed 's:/*$::')
ip=$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$container")
[ -n "$ip" ] || { echo "Missing container IP for $container" >&2; exit 1; }
base_url="http://$ip:8989\${url_base}"

printf '%s\\n' "$actions_json" | jq -r 'keys[]' | while IFS= read -r series_id; do
  seasons_json=$(printf '%s\\n' "$actions_json" | jq -c --arg id "$series_id" '.[$id]')
  series_json=$(curl -fsSL -H "X-Api-Key: $api_key" "$base_url/api/v3/series/$series_id")
  before=$(printf '%s\\n' "$series_json" | jq --argjson seasons "$seasons_json" '[.seasons[] | select(.seasonNumber as $seasonNumber | (($seasons | index($seasonNumber)) != null and .monitored == true))] | length')
  updated_json=$(printf '%s\\n' "$series_json" | jq --argjson seasons "$seasons_json" '.seasons |= map(.seasonNumber as $seasonNumber | if (($seasons | index($seasonNumber)) != null) then (.monitored = false) else . end)')
  printf '%s\\n' "$updated_json" | curl -fsSL -X PUT -H "X-Api-Key: $api_key" -H "Content-Type: application/json" --data-binary @- "$base_url/api/v3/series/$series_id" >/dev/null
  verify_json=$(curl -fsSL -H "X-Api-Key: $api_key" "$base_url/api/v3/series/$series_id")
  remaining=$(printf '%s\\n' "$verify_json" | jq --argjson seasons "$seasons_json" '[.seasons[] | select(.seasonNumber as $seasonNumber | (($seasons | index($seasonNumber)) != null and .monitored == true))] | length')
  season_csv=$(printf '%s\\n' "$seasons_json" | jq -r 'join(",")')
  title=$(printf '%s\\n' "$verify_json" | jq -r '.title')
  printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$series_id" "$title" "$before" "$remaining" "$season_csv"
done
`;

  return runSsh(opts.ssh, script)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [seriesId, title, before, remaining, seasonCsv] = line.split('\t');
      return {
        seriesId: Number.parseInt(seriesId, 10),
        title,
        seasons: seasonCsv.split(',').filter(Boolean).map((season) => Number.parseInt(season, 10)),
        monitoredBefore: Number.parseInt(before, 10),
        monitoredRemaining: Number.parseInt(remaining, 10),
      };
    });
}

function writeSonarrApplyReport(results, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'sonarr-unmonitor-apply.json');
  const csvPath = join(opts.outDir, 'sonarr-unmonitor-apply.csv');
  const mdPath = join(opts.outDir, 'sonarr-unmonitor-apply.md');
  const totalSeasons = results.reduce((sum, result) => sum + result.seasons.length, 0);
  const remaining = results.reduce((sum, result) => sum + result.monitoredRemaining, 0);

  const csvRows = [
    'series_id,title,seasons,monitored_before,monitored_remaining',
    ...results.map((result) =>
      [
        result.seriesId,
        result.title,
        result.seasons.join(' '),
        result.monitoredBefore,
        result.monitoredRemaining,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const mdRows = [
    '# Sonarr Unmonitor Apply Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This report records Sonarr monitoring changes only. It does not delete media files.',
    '',
    '## Summary',
    '',
    `- Series updated: ${results.length}`,
    `- Candidate seasons requested: ${totalSeasons}`,
    `- Seasons still monitored after apply: ${remaining}`,
    '',
    '## Updated Series',
    '',
    '| Series ID | Title | Seasons | Monitored Before | Monitored Remaining |',
    '| ---: | --- | --- | ---: | ---: |',
    ...results.map(
      (result) =>
        `| ${result.seriesId} | ${String(result.title).replaceAll('|', '\\|')} | ${result.seasons.join(', ')} | ${result.monitoredBefore} | ${result.monitoredRemaining} |`,
    ),
  ];

  writeJsonFile(jsonPath, { options: opts, results });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath, totalSeasons, remaining };
}

function runSonarrApplyUnmonitor(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  requireOption(opts, 'planJson');

  const plan = JSON.parse(readFileSync(opts.planJson, 'utf8'));
  const actions = buildSonarrApplyActions(plan);
  const actionCount = Object.values(actions).reduce((sum, seasons) => sum + seasons.length, 0);
  const results = actionCount === 0 ? [] : applySonarrUnmonitorActions(opts, actions);
  const report = writeSonarrApplyReport(results, opts);

  console.log(`Series updated: ${results.length}`);
  console.log(`Candidate seasons requested: ${report.totalSeasons}`);
  console.log(`Seasons still monitored after apply: ${report.remaining}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function buildSeasonDeleteCandidates(plan) {
  return (plan.entries || [])
    .filter((entry) => entry.status === 'already-unmonitored')
    .filter((entry) => entry.candidatePath && Number.isInteger(entry.seasonNumber))
    .map((entry) => ({
      show: entry.show,
      cleanupMode: entry.cleanupMode || 'remove-older',
      seasonNumber: entry.seasonNumber,
      seriesId: entry.seriesId,
      candidatePath: entry.candidatePath,
      expectedBytes: entry.candidateBytes || 0,
      remoteContextLabel: entry.remoteContextLabel || '',
    }));
}

function verifySeasonDeleteCandidates(opts, candidates) {
  if (candidates.length === 0) return [];

  const payloadBase64 = Buffer.from(JSON.stringify(candidates)).toString('base64');
  const script = `
set -e
payload=$(printf '%s' ${shellQuote(payloadBase64)} | base64 -d)
printf '%s\\n' "$payload" | jq -c '.[]' | while IFS= read -r row; do
  path=$(printf '%s\\n' "$row" | jq -r '.candidatePath')
  if [ -d "$path" ]; then
    size_kib=$(du -sk -- "$path" 2>/dev/null | awk '{print $1}')
    file_count=$(find "$path" -type f 2>/dev/null | wc -l | tr -d ' ')
    status=exists
    actual_bytes=$((size_kib * 1024))
  else
    status=missing
    actual_bytes=0
    file_count=0
  fi
  printf '%s\\n' "$row" | jq -c \
    --arg status "$status" \
    --argjson actualBytes "$actual_bytes" \
    --argjson fileCount "$file_count" \
    '. + {diskStatus: $status, actualBytes: $actualBytes, fileCount: $fileCount}'
done
`;

  return runSsh(opts.ssh, script)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeSeasonDeletePlan(verified, blockedEntries, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'season-delete-plan.json');
  const csvPath = join(opts.outDir, 'season-delete-plan.csv');
  const mdPath = join(opts.outDir, 'season-delete-plan.md');

  const existing = verified.filter((entry) => entry.diskStatus === 'exists');
  const missing = verified.filter((entry) => entry.diskStatus !== 'exists');
  const totalBytes = existing.reduce((sum, entry) => sum + Number(entry.actualBytes || 0), 0);
  const totalFiles = existing.reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0);

  const csvRows = [
    'disk_status,cleanup_mode,show,season,series_id,path,actual_bytes,expected_bytes,file_count,remote_context',
    ...verified.map((entry) =>
      [
        entry.diskStatus,
        entry.cleanupMode || '',
        entry.show,
        entry.seasonNumber,
        entry.seriesId ?? '',
        entry.candidatePath,
        entry.actualBytes,
        entry.expectedBytes,
        entry.fileCount,
        entry.remoteContextLabel,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const mdRows = [
    '# Season Delete Plan',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'This is a dry-run delete review. No files were deleted. Only seasons already unmonitored in Sonarr are included as delete candidates.',
    '',
    '## Summary',
    '',
    `- Delete candidate season folders found on disk: ${existing.length}`,
    `- Candidate folders missing on disk: ${missing.length}`,
    `- Blocked entries still monitored or otherwise unsafe: ${blockedEntries.length}`,
    `- Estimated reclaim from existing folders: ${formatBytes(totalBytes)}`,
    `- Files under candidate folders: ${totalFiles}`,
    '',
    '## Candidate Folders',
    '',
    '| Status | Cleanup Mode | Show | Season | Size | Files | Path | Remote Context |',
    '| --- | --- | --- | ---: | ---: | ---: | --- | --- |',
    ...verified.map(
      (entry) =>
        `| ${entry.diskStatus} | ${entry.cleanupMode || ''} | ${String(entry.show).replaceAll('|', '\\|')} | ${entry.seasonNumber} | ${formatBytes(entry.actualBytes || 0)} | ${entry.fileCount || 0} | \`${String(entry.candidatePath).replaceAll('`', '\\`')}\` | ${String(entry.remoteContextLabel || '').replaceAll('|', '\\|')} |`,
    ),
  ];

  if (blockedEntries.length > 0) {
    mdRows.push(
      '',
      '## Blocked Entries',
      '',
      '| Status | Cleanup Mode | Show | Season | Path |',
      '| --- | --- | --- | ---: | --- |',
      ...blockedEntries.map(
        (entry) =>
          `| ${entry.status} | ${entry.cleanupMode || ''} | ${String(entry.show).replaceAll('|', '\\|')} | ${entry.seasonNumber ?? ''} | \`${String(entry.candidatePath || '').replaceAll('`', '\\`')}\` |`,
      ),
    );
  }

  writeJsonFile(jsonPath, { options: opts, summary: { existing: existing.length, missing: missing.length, blocked: blockedEntries.length, totalBytes, totalFiles }, candidates: verified, blockedEntries });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath, existing, missing, blockedEntries, totalBytes, totalFiles };
}

function runSeasonDeletePlan(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  requireOption(opts, 'planJson');

  const plan = JSON.parse(readFileSync(opts.planJson, 'utf8'));
  const candidates = buildSeasonDeleteCandidates(plan);
  const blockedEntries = (plan.entries || []).filter((entry) => entry.status !== 'already-unmonitored');
  const verified = verifySeasonDeleteCandidates(opts, candidates);
  const report = writeSeasonDeletePlan(verified, blockedEntries, opts);

  console.log(`Delete candidate season folders found: ${report.existing.length}`);
  console.log(`Candidate folders missing: ${report.missing.length}`);
  console.log(`Blocked entries: ${report.blockedEntries.length}`);
  console.log(`Estimated reclaim: ${formatBytes(report.totalBytes)}`);
  console.log(`Files under candidate folders: ${report.totalFiles}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function splitDeleteApplyCandidates(plan, opts) {
  const excludedNames = new Set((opts.excludeShows || []).map((show) => show.toLowerCase()));
  const allCandidates = (plan.candidates || []).filter((entry) => entry.diskStatus === 'exists');
  const excluded = allCandidates
    .filter((entry) => excludedNames.has(String(entry.show || '').toLowerCase()))
    .map((entry) => ({ ...entry, applyStatus: 'excluded' }));
  const approved = allCandidates.filter((entry) => !excludedNames.has(String(entry.show || '').toLowerCase()));
  return { approved, excluded };
}

function applySeasonDeletes(opts, candidates) {
  if (candidates.length === 0) return [];

  const payloadBase64 = Buffer.from(JSON.stringify(candidates)).toString('base64');
  const hostRoot = String(opts.hostRoot || '').replace(/\/+$/, '');
  const script = `
set -e
host_root=${shellQuote(hostRoot)}
payload=$(printf '%s' ${shellQuote(payloadBase64)} | base64 -d)
printf '%s\\n' "$payload" | jq -c '.[]' | while IFS= read -r row; do
  path=$(printf '%s\\n' "$row" | jq -r '.candidatePath')
  case "$path" in
    "$host_root"/*/Season\\ *) path_safe=yes ;;
    *) path_safe=no ;;
  esac

  if [ "$path_safe" != yes ]; then
    status=blocked-unsafe-path
    actual_bytes=0
    file_count=0
  elif [ -L "$path" ]; then
    status=blocked-symlink
    actual_bytes=0
    file_count=0
  elif [ ! -d "$path" ]; then
    status=missing-before
    actual_bytes=0
    file_count=0
  else
    size_kib=$(du -sk -- "$path" 2>/dev/null | awk '{print $1}')
    file_count=$(find "$path" -type f 2>/dev/null | wc -l | tr -d ' ')
    actual_bytes=$((size_kib * 1024))
    rm -rf -- "$path"
    if [ -e "$path" ]; then
      status=delete-failed
    else
      status=deleted
    fi
  fi

  printf '%s\\n' "$row" | jq -c \
    --arg status "$status" \
    --argjson actualBytes "$actual_bytes" \
    --argjson fileCount "$file_count" \
    '. + {applyStatus: $status, actualBytes: $actualBytes, fileCount: $fileCount}'
done
`;

  return runSsh(opts.ssh, script)
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeSeasonDeleteApplyReport(results, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'season-delete-apply.json');
  const csvPath = join(opts.outDir, 'season-delete-apply.csv');
  const mdPath = join(opts.outDir, 'season-delete-apply.md');

  const counts = results.reduce((memo, entry) => {
    memo[entry.applyStatus] = (memo[entry.applyStatus] || 0) + 1;
    return memo;
  }, {});
  const deletedBytes = results
    .filter((entry) => entry.applyStatus === 'deleted')
    .reduce((sum, entry) => sum + Number(entry.actualBytes || 0), 0);
  const deletedFiles = results
    .filter((entry) => entry.applyStatus === 'deleted')
    .reduce((sum, entry) => sum + Number(entry.fileCount || 0), 0);

  const csvRows = [
    'apply_status,show,season,path,actual_bytes,file_count,remote_context',
    ...results.map((entry) =>
      [
        entry.applyStatus,
        entry.show,
        entry.seasonNumber,
        entry.candidatePath,
        entry.actualBytes ?? '',
        entry.fileCount ?? '',
        entry.remoteContextLabel ?? '',
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];

  const mdRows = [
    '# Season Delete Apply Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Excluded shows: ${(opts.excludeShows || []).join(', ') || 'none'}`,
    '',
    'This report records filesystem deletion results for approved season folders.',
    '',
    '## Summary',
    '',
    `- Deleted folders: ${counts.deleted || 0}`,
    `- Excluded folders: ${counts.excluded || 0}`,
    `- Missing before delete: ${counts['missing-before'] || 0}`,
    `- Blocked unsafe paths: ${(counts['blocked-unsafe-path'] || 0) + (counts['blocked-symlink'] || 0)}`,
    `- Delete failures: ${counts['delete-failed'] || 0}`,
    `- Deleted bytes measured before removal: ${formatBytes(deletedBytes)}`,
    `- Deleted files measured before removal: ${deletedFiles}`,
    '',
    '## Results',
    '',
    '| Status | Show | Season | Size | Files | Path |',
    '| --- | --- | ---: | ---: | ---: | --- |',
    ...results.map(
      (entry) =>
        `| ${entry.applyStatus} | ${String(entry.show).replaceAll('|', '\\|')} | ${entry.seasonNumber} | ${formatBytes(entry.actualBytes || 0)} | ${entry.fileCount || 0} | \`${String(entry.candidatePath).replaceAll('`', '\\`')}\` |`,
    ),
  ];

  writeJsonFile(jsonPath, { options: opts, counts, results });
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath, counts, deletedBytes, deletedFiles };
}

function runSeasonDeleteApply(opts) {
  if (!opts.ssh) throw new Error('--ssh is required');
  requireOption(opts, 'planJson');

  const plan = JSON.parse(readFileSync(opts.planJson, 'utf8'));
  const { approved, excluded } = splitDeleteApplyCandidates(plan, opts);
  const deletedResults = applySeasonDeletes(opts, approved);
  const results = [...deletedResults, ...excluded];
  const report = writeSeasonDeleteApplyReport(results, opts);

  console.log(`Deleted folders: ${report.counts.deleted || 0}`);
  console.log(`Excluded folders: ${report.counts.excluded || 0}`);
  console.log(`Missing before delete: ${report.counts['missing-before'] || 0}`);
  console.log(`Blocked unsafe paths: ${(report.counts['blocked-unsafe-path'] || 0) + (report.counts['blocked-symlink'] || 0)}`);
  console.log(`Delete failures: ${report.counts['delete-failed'] || 0}`);
  console.log(`Deleted bytes: ${formatBytes(report.deletedBytes)}`);
  console.log(`Deleted files: ${report.deletedFiles}`);
  console.log(`Markdown: ${report.mdPath}`);
  console.log(`CSV: ${report.csvPath}`);
  console.log(`JSON: ${report.jsonPath}`);
}

function requireOption(opts, name) {
  if (!opts[name]) throw new Error(`--${name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required`);
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function buildUrl(baseUrl, path, params = {}) {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

async function fetchJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GET ${url.origin}${url.pathname} failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function extractGuidProviderIds(values) {
  const ids = {};
  for (const value of values.filter(Boolean).map(String)) {
    const simple = value.match(/\b(imdb|tmdb|tvdb):\/\/([^/?&#]+)/i);
    if (simple) ids[simple[1].toLowerCase()] = simple[2];

    const legacyTmdb = value.match(/themoviedb:\/\/([^/?&#]+)/i);
    if (legacyTmdb) ids.tmdb = legacyTmdb[1];

    const legacyTvdb = value.match(/thetvdb:\/\/([^/?&#]+)/i);
    if (legacyTvdb) ids.tvdb = legacyTvdb[1];
  }
  return ids;
}

function extractPlexProviderIds(item) {
  return extractGuidProviderIds([
    item.guid,
    ...(item.Guid || []).map((guid) => guid.id),
  ]);
}

function extractEmbyProviderIds(item) {
  const providerIds = item.ProviderIds || {};
  return Object.fromEntries(
    Object.entries({
      imdb: providerIds.Imdb,
      tmdb: providerIds.Tmdb,
      tvdb: providerIds.Tvdb,
    }).filter(([, value]) => value),
  );
}

function mediaSizeBytes(item) {
  return (item.Media || []).reduce(
    (mediaSum, media) =>
      mediaSum + (media.Part || []).reduce((partSum, part) => partSum + Number(part.size || 0), 0),
    0,
  );
}

function plexTimestamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null;
}

function timestampIso(value) {
  const parsed = plexTimestamp(value);
  return parsed ? new Date(parsed * 1000).toISOString() : null;
}

function dateIso(value) {
  const parsed = dateTimestamp(value);
  return parsed ? new Date(parsed * 1000).toISOString() : null;
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeInventory(inventory) {
  return {
    ...inventory,
    items: inventory.items.map((item) => ({
      ...item,
      normalizedTitle: item.normalizedTitle || normalizeTitle(item.title),
      providerIds: item.providerIds || {},
      seasons: [...new Set(item.seasons || [])].sort((a, b) => a - b),
    })),
  };
}

function selectedLibrary(opts, name) {
  return opts.libraries.length === 0 || opts.libraries.some((library) => library.toLowerCase() === name.toLowerCase());
}

async function plexGet(opts, path, params = {}) {
  return fetchJson(buildUrl(opts.url, path, params), {
    Accept: 'application/json',
    'X-Plex-Token': opts.token,
  });
}

async function plexGetPagedMetadata(opts, path, params = {}, pageSize = 500) {
  const results = [];
  let start = 0;

  while (true) {
    const response = await plexGet(opts, path, {
      ...params,
      'X-Plex-Container-Start': start,
      'X-Plex-Container-Size': pageSize,
    });
    const container = response.MediaContainer || {};
    const page = container.Metadata || [];
    results.push(...page);

    const totalSize = Number(container.totalSize || container.size || results.length);
    if (page.length === 0 || results.length >= totalSize) break;
    start += page.length;
  }

  return results;
}

async function runPlexExport(opts) {
  requireOption(opts, 'url');
  requireOption(opts, 'token');
  requireOption(opts, 'out');

  const sectionsResponse = await plexGet(opts, '/library/sections');
  const sections = sectionsResponse.MediaContainer?.Directory || [];
  const items = [];

  for (const section of sections) {
    if (!selectedLibrary(opts, section.title)) continue;

    if (section.type === 'movie' && opts.types.includes('movie')) {
      console.error(`Exporting Plex movie library: ${section.title}`);
      const movies = await plexGetPagedMetadata(opts, `/library/sections/${section.key}/all`, {
        includeGuids: 1,
        includeMedia: opts.includeMedia ? 1 : undefined,
      });
      for (const movie of movies) {
        items.push({
          type: 'movie',
          title: movie.title,
          year: movie.year || null,
          library: section.title,
          ratingKey: movie.ratingKey,
          providerIds: extractPlexProviderIds(movie),
          path: movie.Media?.[0]?.Part?.[0]?.file || null,
          sizeBytes: mediaSizeBytes(movie),
          viewCount: Number(movie.viewCount || 0),
          lastViewedAt: plexTimestamp(movie.lastViewedAt),
          lastViewedAtIso: timestampIso(movie.lastViewedAt),
          addedAt: plexTimestamp(movie.addedAt),
          addedAtIso: timestampIso(movie.addedAt),
          originallyAvailableAt: movie.originallyAvailableAt || null,
          contentRating: movie.contentRating || null,
          rating: movie.rating ?? null,
          audienceRating: movie.audienceRating ?? null,
          userRating: movie.userRating ?? null,
          durationMs: Number(movie.duration || 0) || null,
        });
      }
    }

    if (section.type === 'show' && opts.types.includes('tv')) {
      console.error(`Exporting Plex TV library: ${section.title}`);
      const shows = await plexGetPagedMetadata(opts, `/library/sections/${section.key}/all`, { includeGuids: 1 });
      const seasons = await plexGetPagedMetadata(opts, `/library/sections/${section.key}/all`, { type: 3 });
      const episodes = await plexGetPagedMetadata(opts, `/library/sections/${section.key}/all`, { type: 4 });
      const seasonsByShow = new Map();
      const seasonStatsByShow = new Map();
      for (const season of seasons) {
        const seasonNumber = Number(season.index);
        if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) continue;
        const showKey = season.parentRatingKey || season.parentGuid || season.parentTitle;
        if (!showKey) continue;
        if (!seasonsByShow.has(showKey)) seasonsByShow.set(showKey, []);
        seasonsByShow.get(showKey).push(seasonNumber);
        if (!seasonStatsByShow.has(showKey)) seasonStatsByShow.set(showKey, []);
        seasonStatsByShow.get(showKey).push({
          seasonNumber,
          leafCount: numberOrNull(season.leafCount),
          viewedLeafCount: numberOrNull(season.viewedLeafCount),
        });
      }
      for (const episode of episodes) {
        const seasonNumber = Number(episode.parentIndex);
        if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) continue;
        const showKey = episode.grandparentRatingKey || episode.grandparentGuid || episode.grandparentTitle;
        if (!showKey) continue;
        if (!seasonStatsByShow.has(showKey)) seasonStatsByShow.set(showKey, []);
        let stat = seasonStatsByShow.get(showKey).find((row) => row.seasonNumber === seasonNumber);
        if (!stat) {
          stat = { seasonNumber, leafCount: 0, viewedLeafCount: 0 };
          seasonStatsByShow.get(showKey).push(stat);
        }
        stat.leafCount = numberOrNull(stat.leafCount) ?? 0;
        stat.viewedLeafCount = numberOrNull(stat.viewedLeafCount) ?? 0;
        stat.leafCount += 1;
        if (Number(episode.viewCount || 0) > 0 || episode.lastViewedAt) stat.viewedLeafCount += 1;
      }

      for (const show of shows) {
        const showSeasons = seasonsByShow.get(show.ratingKey) || seasonsByShow.get(show.guid) || seasonsByShow.get(show.title) || [];
        const seasonStats = seasonStatsByShow.get(show.ratingKey) || seasonStatsByShow.get(show.guid) || seasonStatsByShow.get(show.title) || [];
        const statEpisodeCount = seasonStats.reduce((sum, stat) => sum + (numberOrNull(stat.leafCount) ?? 0), 0);
        const statViewedEpisodeCount = seasonStats.reduce((sum, stat) => sum + (numberOrNull(stat.viewedLeafCount) ?? 0), 0);
        items.push({
          type: 'show',
          title: show.title,
          year: show.year || null,
          library: section.title,
          ratingKey: show.ratingKey,
          providerIds: extractPlexProviderIds(show),
          path: show.Location?.[0]?.path || null,
          seasons: [...new Set(showSeasons)].sort((a, b) => a - b),
          leafCount: numberOrNull(show.leafCount) ?? statEpisodeCount,
          viewedLeafCount: numberOrNull(show.viewedLeafCount) ?? statViewedEpisodeCount,
          viewCount: numberOrNull(show.viewCount),
          lastViewedAt: plexTimestamp(show.lastViewedAt),
          lastViewedAtIso: timestampIso(show.lastViewedAt),
          seasonStats: seasonStats.toSorted((a, b) => a.seasonNumber - b.seasonNumber),
        });
      }
    }
  }

  const inventory = normalizeInventory({
    source: 'plex',
    serverName: opts.serverName || 'plex',
    generatedAt: new Date().toISOString(),
    url: new URL(opts.url).origin,
    items,
  });
  writeJsonFile(opts.out, inventory);
  console.log(`Exported ${items.length} Plex items to ${opts.out}`);
}

async function embyGet(opts, path, params = {}) {
  return fetchJson(buildUrl(opts.url, path, { ...params, api_key: opts.token }));
}

async function runEmbyExport(opts) {
  requireOption(opts, 'url');
  requireOption(opts, 'token');
  requireOption(opts, 'out');

  const response = await embyGet(opts, '/Items', {
    Recursive: true,
    IncludeItemTypes: opts.types.includes('tv') && opts.types.includes('movie')
      ? 'Movie,Series'
      : opts.types.includes('tv')
        ? 'Series'
        : 'Movie',
    Fields: 'ProviderIds,Path,ProductionYear,UserData,DateCreated,PremiereDate,OfficialRating,CommunityRating,CriticRating,RunTimeTicks',
    UserId: opts.userId,
  });

  const items = [];
  for (const item of response.Items || []) {
    if (opts.libraries.length > 0 && item.CollectionName && !selectedLibrary(opts, item.CollectionName)) continue;

    if (item.Type === 'Movie') {
      items.push({
        type: 'movie',
        title: item.Name,
        year: item.ProductionYear || null,
        library: item.CollectionName || null,
        itemId: item.Id,
        providerIds: extractEmbyProviderIds(item),
        path: item.Path || null,
        viewCount: Number(item.UserData?.PlayCount || 0),
        lastViewedAt: dateTimestamp(item.UserData?.LastPlayedDate),
        lastViewedAtIso: dateIso(item.UserData?.LastPlayedDate),
        addedAt: dateTimestamp(item.DateCreated),
        addedAtIso: dateIso(item.DateCreated),
        originallyAvailableAt: item.PremiereDate || null,
        contentRating: item.OfficialRating || null,
        rating: item.CommunityRating ?? null,
        audienceRating: item.CriticRating ?? null,
        userRating: item.UserData?.UserRating ?? null,
        durationMs: item.RunTimeTicks ? Math.round(Number(item.RunTimeTicks) / 10000) : null,
      });
    }

    if (item.Type === 'Series') {
      const seasonsResponse = await embyGet(opts, `/Shows/${item.Id}/Seasons`, { Fields: 'IndexNumber,UserData,RecursiveItemCount,ChildCount' });
      const seasonItems = seasonsResponse.Items || [];
      const seasons = seasonItems
        .map((season) => Number(season.IndexNumber))
        .filter((season) => Number.isInteger(season) && season > 0);
      const seasonStats = seasonItems
        .map((season) => {
          const seasonNumber = Number(season.IndexNumber);
          const leafCount = numberOrNull(season.RecursiveItemCount ?? season.ChildCount);
          return {
            seasonNumber,
            leafCount,
            viewedLeafCount: season.UserData?.Played && leafCount !== null ? leafCount : null,
          };
        })
        .filter((season) => Number.isInteger(season.seasonNumber) && season.seasonNumber > 0)
        .sort((a, b) => a.seasonNumber - b.seasonNumber);
      items.push({
        type: 'show',
        title: item.Name,
        year: item.ProductionYear || null,
        library: item.CollectionName || null,
        itemId: item.Id,
        providerIds: extractEmbyProviderIds(item),
        path: item.Path || null,
        seasons: [...new Set(seasons)].sort((a, b) => a - b),
        leafCount: numberOrNull(item.RecursiveItemCount ?? item.ChildCount),
        viewedLeafCount: item.UserData?.Played && numberOrNull(item.RecursiveItemCount ?? item.ChildCount) !== null
          ? numberOrNull(item.RecursiveItemCount ?? item.ChildCount)
          : null,
        viewCount: Number(item.UserData?.PlayCount || 0),
        lastViewedAt: dateTimestamp(item.UserData?.LastPlayedDate),
        lastViewedAtIso: dateIso(item.UserData?.LastPlayedDate),
        seasonStats,
      });
    }
  }

  const inventory = normalizeInventory({
    source: 'emby',
    serverName: opts.serverName || 'emby',
    generatedAt: new Date().toISOString(),
    url: new URL(opts.url).origin,
    items,
  });
  writeJsonFile(opts.out, inventory);
  console.log(`Exported ${items.length} Emby items to ${opts.out}`);
}

function providerKeys(item) {
  return Object.entries(item.providerIds || {}).map(([provider, id]) => `${provider}:${String(id).toLowerCase()}`);
}

function fallbackKey(item) {
  return `${item.type}:${item.normalizedTitle}:${item.year || ''}`;
}

function buildRemoteIndex(remote) {
  const byProvider = new Map();
  const byFallback = new Map();

  for (const item of remote.items) {
    for (const key of providerKeys(item)) {
      if (!byProvider.has(key)) byProvider.set(key, []);
      byProvider.get(key).push(item);
    }
    const key = fallbackKey(item);
    if (!byFallback.has(key)) byFallback.set(key, []);
    byFallback.get(key).push(item);
  }

  return { byProvider, byFallback };
}

function findRemoteMatches(item, index) {
  const providerMatches = providerKeys(item).flatMap((key) => index.byProvider.get(key) || []);
  if (providerMatches.length > 0) {
    return { method: 'provider-id', matches: [...new Set(providerMatches)] };
  }
  return { method: 'title-year', matches: index.byFallback.get(fallbackKey(item)) || [] };
}

function compareShowSeasons(local, remote) {
  const localSeasons = new Set(local.seasons || []);
  const remoteSeasons = new Set(remote.seasons || []);
  const overlap = [...localSeasons].filter((season) => remoteSeasons.has(season)).sort((a, b) => a - b);
  const localOnly = [...localSeasons].filter((season) => !remoteSeasons.has(season)).sort((a, b) => a - b);
  const remoteOnly = [...remoteSeasons].filter((season) => !localSeasons.has(season)).sort((a, b) => a - b);
  return { overlap, localOnly, remoteOnly };
}

function chooseBestRemoteMatch(localItem, remoteItems) {
  return remoteItems.toSorted((a, b) => {
    if (localItem.type === 'show') {
      const aOverlap = compareShowSeasons(localItem, a).overlap.length;
      const bOverlap = compareShowSeasons(localItem, b).overlap.length;
      if (aOverlap !== bOverlap) return bOverlap - aOverlap;
    }

    const aYearDelta = Math.abs(Number(localItem.year || 0) - Number(a.year || 0));
    const bYearDelta = Math.abs(Number(localItem.year || 0) - Number(b.year || 0));
    if (aYearDelta !== bYearDelta) return aYearDelta - bYearDelta;

    const aLibrary = String(a.library || '');
    const bLibrary = String(b.library || '');
    const aIs4k = /\b4k\b/i.test(aLibrary);
    const bIs4k = /\b4k\b/i.test(bLibrary);
    if (aIs4k !== bIs4k) return aIs4k ? 1 : -1;

    return String(a.title || '').localeCompare(String(b.title || ''));
  })[0];
}

function writeOverlapReports(comparison, opts) {
  mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = join(opts.outDir, 'overlap-candidates.json');
  const csvPath = join(opts.outDir, 'overlap-candidates.csv');
  const mdPath = join(opts.outDir, 'overlap-candidates.md');

  const rows = comparison.matches.map((match) => ({
    type: match.local.type,
    localTitle: match.local.title,
    localYear: match.local.year || '',
    remoteTitle: match.remote.title,
    remoteYear: match.remote.year || '',
    method: match.method,
    localLibrary: match.local.library || '',
    remoteLibrary: match.remote.library || '',
    remoteAlternatives: match.remoteMatchCount - 1,
    localSizeBytes: match.local.sizeBytes || 0,
    overlapSeasons: match.seasons?.overlap?.join(' ') || '',
    localOnlySeasons: match.seasons?.localOnly?.join(' ') || '',
    remoteOnlySeasons: match.seasons?.remoteOnly?.join(' ') || '',
  }));

  const csvRows = [
    'type,local_title,local_year,remote_title,remote_year,match_method,local_library,remote_library,remote_alternatives,local_size_bytes,overlap_seasons,local_only_seasons,remote_only_seasons',
    ...rows.map((row) =>
      [
        row.type,
        row.localTitle,
        row.localYear,
        row.remoteTitle,
        row.remoteYear,
        row.method,
        row.localLibrary,
        row.remoteLibrary,
        row.remoteAlternatives,
        row.localSizeBytes,
        row.overlapSeasons,
        row.localOnlySeasons,
        row.remoteOnlySeasons,
      ].map((value) => JSON.stringify(String(value))).join(','),
    ),
  ];
  const overlappedMovieBytes = comparison.matches
    .filter((match) => match.local.type === 'movie')
    .reduce((sum, match) => sum + Number(match.local.sizeBytes || 0), 0);

  const mdRows = [
    '# Media Overlap Candidates',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Local: ${comparison.local.serverName} (${comparison.local.source})`,
    `Remote: ${comparison.remote.serverName} (${comparison.remote.source})`,
    '',
    'This report is read-only. It identifies local media that appears to exist on the remote server and is not approval to delete media.',
    '',
    '## Summary',
    '',
    `- Local items: ${comparison.local.items.length}`,
    `- Remote items: ${comparison.remote.items.length}`,
    `- Local items with remote overlap: ${comparison.matches.length}`,
    `- Provider-ID matches: ${comparison.matches.filter((match) => match.method === 'provider-id').length}`,
    `- Title/year fallback matches: ${comparison.matches.filter((match) => match.method === 'title-year').length}`,
    `- Additional remote duplicate matches collapsed: ${comparison.matches.reduce((sum, match) => sum + match.remoteMatchCount - 1, 0)}`,
    `- Overlapped local movie size: ${formatBytes(overlappedMovieBytes)}`,
    `- TV full-season overlaps: ${comparison.matches.filter((match) => match.local.type === 'show' && match.seasons.localOnly.length === 0).length}`,
    `- TV partial-season overlaps: ${comparison.matches.filter((match) => match.local.type === 'show' && match.seasons.localOnly.length > 0).length}`,
    '',
    '## Matches',
    '',
    '| Type | Local | Local Size | Remote | Method | Extra Remote Copies | Overlap Seasons | Local-only Seasons |',
    '| --- | --- | ---: | --- | --- | ---: | --- | --- |',
    ...comparison.matches.map((match) => {
      const local = `${match.local.title}${match.local.year ? ` (${match.local.year})` : ''}`.replaceAll('|', '\\|');
      const remote = `${match.remote.title}${match.remote.year ? ` (${match.remote.year})` : ''}`.replaceAll('|', '\\|');
      const localSize = match.local.sizeBytes ? formatBytes(match.local.sizeBytes) : '';
      return `| ${match.local.type} | ${local} | ${localSize} | ${remote} | ${match.method} | ${match.remoteMatchCount - 1} | ${match.seasons?.overlap?.join(', ') || ''} | ${match.seasons?.localOnly?.join(', ') || ''} |`;
    }),
  ];

  writeJsonFile(jsonPath, comparison);
  writeFileSync(csvPath, `${csvRows.join('\n')}\n`);
  writeFileSync(mdPath, `${mdRows.join('\n')}\n`);
  return { jsonPath, csvPath, mdPath };
}

function runCompareExports(opts) {
  requireOption(opts, 'local');
  requireOption(opts, 'remote');
  const local = normalizeInventory(JSON.parse(readFileSync(opts.local, 'utf8')));
  const remote = normalizeInventory(JSON.parse(readFileSync(opts.remote, 'utf8')));
  const index = buildRemoteIndex(remote);
  const matches = [];

  for (const item of local.items) {
    const result = findRemoteMatches(item, index);
    const typedMatches = result.matches.filter((candidate) => candidate.type === item.type);
    if (typedMatches.length === 0) continue;

    const remoteItem = chooseBestRemoteMatch(item, typedMatches);
    matches.push({
      method: result.method,
      local: item,
      remote: remoteItem,
      remoteMatchCount: typedMatches.length,
      seasons: item.type === 'show' ? compareShowSeasons(item, remoteItem) : null,
    });
  }

  matches.sort(
    (a, b) =>
      Number(b.local.sizeBytes || 0) - Number(a.local.sizeBytes || 0) ||
      a.local.type.localeCompare(b.local.type) ||
      a.local.title.localeCompare(b.local.title),
  );
  const paths = writeOverlapReports({ local, remote, matches }, opts);
  console.log(`Overlap matches: ${matches.length}`);
  console.log(`Markdown: ${paths.mdPath}`);
  console.log(`CSV: ${paths.csvPath}`);
  console.log(`JSON: ${paths.jsonPath}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.command) {
    usage();
    return;
  }
  if (opts.command === 'reality-retention') {
    runRealityRetention(opts);
    return;
  }
  if (opts.command === 'tv-cleanup-options') {
    runTvCleanupOptions(opts);
    return;
  }
  if (opts.command === 'tv-approval') {
    await runTvApproval(opts);
    return;
  }
  if (opts.command === 'sonarr-unmonitor-plan') {
    runSonarrUnmonitorPlan(opts);
    return;
  }
  if (opts.command === 'sonarr-apply-unmonitor') {
    runSonarrApplyUnmonitor(opts);
    return;
  }
  if (opts.command === 'season-delete-plan') {
    runSeasonDeletePlan(opts);
    return;
  }
  if (opts.command === 'season-delete-apply') {
    runSeasonDeleteApply(opts);
    return;
  }
  if (opts.command === 'plex-export') {
    await runPlexExport(opts);
    return;
  }
  if (opts.command === 'emby-export') {
    await runEmbyExport(opts);
    return;
  }
  if (opts.command === 'compare-exports') {
    runCompareExports(opts);
    return;
  }
  if (opts.command === 'movie-review') {
    runMovieReview(opts);
    return;
  }
  if (opts.command === 'movie-approval') {
    await runMovieApproval(opts);
    return;
  }
  if (opts.command === 'radarr-movie-delete-plan') {
    runRadarrMovieDeletePlan(opts);
    return;
  }
  if (opts.command === 'radarr-movie-delete-apply') {
    runRadarrMovieDeleteApply(opts);
    return;
  }
  throw new Error(`Unknown command: ${opts.command}`);
}

try {
  await main();
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
