import axios from 'axios';
import { fetchWithRetries } from '../utils.mjs';
import logger from '../logger.mjs';

const SONARR_API_KEY = process.env.SONARR_API_KEY;
const SONARR_SERVER_URL = process.env.SONARR_SERVER_URL;

export async function findSeriesId(seriesTitle) {
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

export async function deleteSeriesFromSonarr(seriesId) {
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

