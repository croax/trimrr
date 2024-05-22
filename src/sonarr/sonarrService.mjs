import axios from 'axios';
import { logger, fetchWithRetries } from '../utils.mjs';
import { sonarrApiKey, sonarrServerUrl } from '../config.mjs';

export async function findSeriesId(seriesTitle) {
    try {
        const response = await fetchWithRetries(`${sonarrServerUrl}/api/v3/series`, {
            params: { apiKey: sonarrApiKey }
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

export async function deleteSeriesFromSonarr(seriesId) {
    try {
        logger.info(`Attempting to delete series with ID ${seriesId} from Sonarr...`);
        const response = await axios.delete(`${sonarrServerUrl}/api/v3/series/${seriesId}`, {
            params: {
                apiKey: sonarrApiKey,
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
