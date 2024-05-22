import axios from 'axios';
import cliProgress from 'cli-progress';
import chalk from 'chalk';
import logger from '../logger.mjs';
import { embyApiKey, embyServerUrl } from '../config.mjs';
import { fetchWithRetries } from '../utils.mjs';
import pLimit from 'p-limit';
import prettyBytes from 'pretty-bytes';

const limit = pLimit(10); // Control concurrency for API requests

export async function fetchUsers() {
    const url = `${embyServerUrl}/Users`;
    const options = { params: { api_key: embyApiKey } };

    try {
        const response = await fetchWithRetries(url, options);
        logger.info(`Users fetched: ${response.data.length}`);
        return response.data;
    } catch (error) {
        logger.error(`Error fetching users: ${error.message}`);
        logger.error(`URL: ${url}`);
        logger.error(`Options: ${JSON.stringify(options)}`);
        if (error.response) {
            logger.error(`Status: ${error.response.status}`);
            logger.error(`Response data: ${JSON.stringify(error.response.data)}`);
        }
        return [];
    }
}

export async function fetchAllShows() {
    const url = `${embyServerUrl}/Items`;
    const options = {
        params: {
            IncludeItemTypes: 'Series',
            Recursive: true,
            ParentId: '3', // Specifying Library ID directly
            api_key: embyApiKey,
            Fields: 'ProviderIds,Path'
        }
    };

    try {
        const response = await fetchWithRetries(url, options);
        logger.info(`Shows fetched: ${response.data.Items.length}`);
        return response.data.Items;
    } catch (error) {
        logger.error('Error fetching all shows:', error);
        return [];
    }
}

export async function fetchEpisodes(showId, userIds) {
    try {
        const responses = await Promise.all(
            userIds.map(userId =>
                fetchWithRetries(`${embyServerUrl}/Shows/${showId}/Episodes`, {
                    params: {
                        api_key: embyApiKey,
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

export async function getFolderSize(path) {
    try {
        const response = await fetchWithRetries(`${embyServerUrl}/Items`, {
            params: {
                api_key: embyApiKey,
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

export async function checkPlayState(shows, users) {
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
