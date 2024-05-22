import { fetchWithRetries, logger, chalk } from '../utils.mjs';
import { traktClientId, ratingThreshold } from '../config.mjs';

export async function fetchRatingFromTrakt(imdbId, showName) {
    try {
        const response = await fetchWithRetries(`https://api.trakt.tv/search/imdb/${imdbId}?extended=full`, {
            headers: {
                'Content-Type': 'application/json',
                'trakt-api-version': '2',
                'trakt-api-key': traktClientId
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
