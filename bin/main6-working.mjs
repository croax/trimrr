import dotenv from 'dotenv';
import axios from 'axios';
import winston from 'winston';
import cliProgress from 'cli-progress';
import pLimit from 'p-limit';
import readline from 'readline';
import chalk from 'chalk';
import prettyBytes from 'pretty-bytes';

dotenv.config({ path: '../.env' });
const { EMBY_API_KEY, EMBY_SERVER_URL, TRAKT_CLIENT_ID, SONARR_API_KEY, SONARR_SERVER_URL } = process.env;

const limit = pLimit(10); // Control concurrency for API requests
const ratingThreshold = parseFloat(process.env.RATING_THRESHOLD) || 6;
const maxRetries = 3;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

async function getKeypress() {
    return new Promise((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.once('data', (data) => {
            process.stdin.setRawMode(false);
            resolve(data.toString());
        });
    });
}

// Setup logging
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'main_script.log' })
    ]
});

async function fetchWithRetries(url, options, retries = 0) {
    try {
        return await axios(url, options);
    } catch (error) {
        if (error.response && error.response.status === 429 && retries < maxRetries) {
            const retryAfter = error.response.headers['retry-after']
                ? parseInt(error.response.headers['retry-after']) * 1000
                : (retries + 1) * 1000;
            logger.warn(`Rate limit exceeded for URL: ${url}`);
            logger.warn(`Response headers: ${JSON.stringify(error.response.headers)}`);
            logger.warn(`Retrying in ${retryAfter / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            return fetchWithRetries(url, options, retries + 1);
        } else {
            throw error;
        }
    }
}

async function fetchUsers() {
    try {
        const response = await fetchWithRetries(`${EMBY_SERVER_URL}/Users`, { params: { api_key: EMBY_API_KEY } });
        logger.info(`Users fetched: ${chalk.green(response.data.length)}`);
        return response.data;
    } catch (error) {
        logger.error('Error fetching users:', error);
        return [];
    }
}

async function fetchAllShows() {
    try {
        const response = await fetchWithRetries(`${EMBY_SERVER_URL}/Items`, {
            params: {
                IncludeItemTypes: 'Series',
                Recursive: true,
                ParentId: '3', // Specifying Library ID directly
                api_key: EMBY_API_KEY,
                Fields: 'ProviderIds,Path'
            }
        });
        logger.info(`Shows fetched: ${chalk.green(response.data.Items.length)}`);
        return response.data.Items;
    } catch (error) {
        logger.error('Error fetching all shows:', error);
        return [];
    }
}

async function fetchEpisodes(showId, userIds) {
    try {
        const responses = await Promise.all(
            userIds.map(userId =>
                fetchWithRetries(`${EMBY_SERVER_URL}/Shows/${showId}/Episodes`, {
                    params: {
                        api_key: EMBY_API_KEY,
                        userId: userId,
                        Fields: 'UserData'
                    }
                })
            )
        );
        return responses.map(response => response.data.Items).flat();
    } catch (error) {
        logger.error(`Error fetching episodes for show ID ${showId} and user IDs ${userIds}:`, error);
        return [];
    }
}

async function getFolderSize(path) {
    try {
        const response = await fetchWithRetries(`${EMBY_SERVER_URL}/Items`, {
            params: {
                api_key: EMBY_API_KEY,
                Recursive: true,
                ParentId: path,
                Fields: 'Size'
            }
        });
        const totalSize = response.data.Items.reduce((acc, item) => acc + (item.Size || 0), 0);
        return prettyBytes(totalSize);
    } catch (error) {
        logger.error(`Error fetching folder size for path ${path}:`, error);
        return 'Unknown';
    }
}

async function checkPlayState(shows, users) {
    logger.info('Checking play state for shows...');
    const userIds = users.map(user => user.Id);
    const showsWithNoPlays = [];

    const progressBar = new cliProgress.SingleBar({
        format: 'Checking play state |' + chalk.cyan('{bar}') + '| {percentage}% || {value}/{total} shows',
        barCompleteChar: '\u2588',
        barIncompleteChar: '\u2591',
        hideCursor: true
    }, cliProgress.Presets.shades_classic);

    progressBar.start(shows.length, 0);

    await Promise.all(shows.map(show =>
        limit(async () => {
            const episodes = await fetchEpisodes(show.Id, userIds);
            let totalEpisodesPlayed = 0;

            episodes.forEach(episode => {
                if (episode.UserData && episode.UserData.Played) {
                    totalEpisodesPlayed++;
                }
            });

            if (totalEpisodesPlayed === 0) {
                showsWithNoPlays.push(show);
            }

            progressBar.increment();
        })
    ));

    progressBar.stop();
    logger.info(`Shows with no plays found: ${chalk.red(showsWithNoPlays.length)}`);
    return showsWithNoPlays;
}

async function fetchRatingFromTrakt(imdbId, showName) {
    try {
        const response = await fetchWithRetries(`https://api.trakt.tv/search/imdb/${imdbId}?extended=full`, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': TRAKT_CLIENT_ID
            }
        });
        if (response.data.length > 0 && response.data[0].show) {
            const rating = response.data[0].show.rating.toFixed(2);
            logger.info(`Trakt rating for ${showName}: ${rating < ratingThreshold ? chalk.red(rating) : chalk.green(rating)}`);
            return rating;
        } else {
            logger.info(`Trakt rating for ${showName}: No rating found`);
            return null;
        }
    } catch (error) {
        logger.error(`Error fetching rating from Trakt for ${showName}:`, error);
        return null;
    }
}

async function findSeriesId(seriesTitle) {
    try {
        const response = await fetchWithRetries(`${SONARR_SERVER_URL}/api/v3/series`, {
            params: { apiKey: SONARR_API_KEY }
        });

        const series = response.data.find(s => s.title.toLowerCase() === seriesTitle.toLowerCase());
        if (series) {
            logger.info(`Series found: ${series.title} (ID: ${series.id})`);
            return series.id;
        } else {
            logger.warn(`Series "${seriesTitle}" not found.`);
            return null;
        }
    } catch (error) {
        logger.error(`Error fetching series: ${error.message}`);
        return null;
    }
}

async function deleteSeriesFromSonarr(seriesId) {
    try {
        logger.info(`Attempting to delete series with ID ${seriesId} from Sonarr...`);
        const response = await axios.delete(`${SONARR_SERVER_URL}/api/v3/series/${seriesId}`, {
            params: {
                apiKey: SONARR_API_KEY,
                deleteFiles: true
            }
        });

        if (response.status === 200) {
            logger.info(`Series with ID ${seriesId} successfully deleted from Sonarr.`);
        } else {
            logger.warn(`Unexpected response status from Sonarr: ${response.status}`);
        }
    } catch (error) {
        logger.error(`Error deleting series from Sonarr: ${error.message}`);
    }
}

function formatRating(rating) {
    return rating < ratingThreshold ? chalk.red(rating) : chalk.green(rating);
}

function formatSize(sizeString) {
    const sizeValue = parseFloat(sizeString);
    if (sizeValue < 10) {
        return chalk.green(sizeString);
    } else if (sizeValue <= 100) {
        return chalk.rgb(255, 165, 0)(sizeString); // Orange color
    } else {
        return chalk.red(sizeString);
    }
}

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
    showsToDelete.forEach(show => logger.info(`${show.name} (Rating: ${formatRating(show.rating)}, Size: ${formatSize(show.size)})`));

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
                process.stdout.write(`Delete "${show.name}" (Rating: ${formatRating(show.rating)}, Size: ${formatSize(show.size)})? (Yes/No/Cancel): `);
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

