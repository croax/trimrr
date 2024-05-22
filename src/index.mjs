import { fetchUsers, fetchAllShows, fetchEpisodes, getFolderSize, checkPlayState } from './emby/embyService.mjs';
import { fetchRatingFromTrakt } from './trakt/traktService.mjs';
import { findSeriesId, deleteSeriesFromSonarr } from './sonarr/sonarrService.mjs';
import logger from './logger.mjs';
import chalk from 'chalk';
import prettyBytes from 'pretty-bytes';
import readline from 'readline';
import { getKeypress, formatRating, formatSize } from './utils.mjs';
import { ratingThreshold } from './config.mjs';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

async function processShows() {
    logger.info('Fetching users...');
    const users = await fetchUsers();
    if (users.length === 0) {
        logger.info('No users found.');
        return;
    }

    logger.info('Fetching shows...');
    const shows = await fetchAllShows();
    if (shows.length === 0) {
        logger.info('No shows found.');
        return;
    }

    logger.info('Calculating play counts...');
    const showsWithNoPlays = await checkPlayState(shows, users);

    logger.info('Fetching Trakt ratings for shows with no plays...');
    const showsToDelete = [];
    for (const show of showsWithNoPlays) {
        const imdbId = show.ProviderIds?.IMDB || show.ProviderIds?.Imdb;
        if (imdbId) {
            const rating = await fetchRatingFromTrakt(imdbId, show.Name);
            if (rating && parseFloat(rating) < ratingThreshold) {
                const size = await getFolderSize(show.Id);
                showsToDelete.push({ name: show.Name, rating, size });
            }
        } else {
            logger.info(`No IMDB ID found for ${show.Name}`);
        }
    }

    logger.info('Shows with rating lower than threshold:');
    showsToDelete.forEach(show => logger.info(`${show.name} (Rating: ${formatRating(show.rating, ratingThreshold)}, Size: ${formatSize(show.size)})`));

    let totalDeletedSize = 0;
    let totalRecommendedSize = showsToDelete.reduce((acc, show) => acc + parseFloat(show.size), 0);

    if (showsToDelete.length > 0) {
        process.stdout.write('Would you like to delete all recommended shows? (Yes/No/Cancel): ');
        const allResponse = await getKeypress().then(key => key.trim().toLowerCase());
        console.log(allResponse);
        if (allResponse === 'y') {
            for (const show of showsToDelete) {
                const seriesId = await findSeriesId(show.name);
                if (seriesId !== null) {
                    await deleteSeriesFromSonarr(seriesId);
                    totalDeletedSize += parseFloat(show.size);
                }
            }
        } else if (allResponse === 'n') {
            for (const show of showsToDelete) {
                process.stdout.write(`Delete "${show.name}" (Rating: ${formatRating(show.rating, ratingThreshold)}, Size: ${formatSize(show.size)})? (Yes/No/Cancel): `);
                const response = await getKeypress().then(key => key.trim().toLowerCase());
                console.log(response);
                if (response === 'y') {
                    const seriesId = await findSeriesId(show.name);
                    if (seriesId !== null) {
                        await deleteSeriesFromSonarr(seriesId);
                        totalDeletedSize += parseFloat(show.size);
                    }
                } else if (response === 'c') {
                    break;
                }
            }
        }
    } else {
        logger.info('No shows to delete.');
    }

    logger.info(`Process completed.\nStatistics:\n- Total shows detected: ${shows.length}\n- Shows recommended for deletion: ${showsToDelete.length}\n- Total size of recommended deletions: ${prettyBytes(totalRecommendedSize * 1024 * 1024 * 1024)}\n- Total size of actual deletions: ${prettyBytes(totalDeletedSize * 1024 * 1024 * 1024)}`);
    rl.close();
}

processShows();
