import { fetchWithRetries, prettyBytes, limit, logger, chalk } from '../utils.mjs';
import { config } from '../config.mjs';
import cliProgress from 'cli-progress';

export async function fetchUsers() {
    try {
        const response = await fetchWithRetries(`${config.embyServerUrl}/Users`, { params: { api_key: config.embyApiKey } });
        logger.info(`Users fetched: ${chalk.green(response.data.length)}`);
        return response.data;
    } catch (error) {
        logger.error('Error fetching users:', error);
        return [];
    }
}

export async function fetchAllShows() {
    try {
        const response = await fetchWithRetries(`${config.embyServerUrl}/Items`, {
            params: {
                IncludeItemTypes: 'Series',
                Recursive: true,
                ParentId: '3', // Specifying Library ID directly
                api_key: config.embyApiKey,
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

export async function fetchEpisodes(showId, userIds) {
    try {
        const responses = await Promise.all(
            userIds.map(userId =>
                fetchWithRetries(`${config.embyServerUrl}/Shows/${showId}/Episodes`, {
                    params: {
                        api_key: config.embyApiKey,
                        userId: userId,
                        Fields: 'UserData'
                    }
                })
            )
        );
        return responses.map(response => response.data.Items).flat();
    } catch (error) {
        logger.error(`Error fetching episodes for show ID ${showId} and user IDs ${userIds.join(',')}:`, error);
        return [];
    }
}

export async function getFolderSize(path) {
    try {
        const response = await fetchWithRetries(`${config.embyServerUrl}/Items`, {
            params: {
                api_key: config.embyApiKey,
                Recursive: true,
                ParentId: path,
                Fields: 'Size'
            }
        });
        const totalSize = response.data.Items.reduce((acc, item) => acc + (item.Size || 0), 0);
        return prettyBytes(totalSize);
    } catch (error) {
        logger.error(`Error fetching folder size for path ${path}: ${error.message}`);
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
