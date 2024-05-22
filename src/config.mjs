import dotenv from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env file
const envPath = resolve(process.cwd(), '.env');
dotenv.config({ path: envPath });

const {
    EMBY_API_KEY,
    EMBY_SERVER_URL,
    TRAKT_CLIENT_ID,
    SONARR_API_KEY,
    SONARR_SERVER_URL,
    RATING_THRESHOLD
} = process.env;

export const config = {
    embyApiKey: EMBY_API_KEY,
    embyServerUrl: EMBY_SERVER_URL,
    traktClientId: TRAKT_CLIENT_ID,
    sonarrApiKey: SONARR_API_KEY,
    sonarrServerUrl: SONARR_SERVER_URL,
    ratingThreshold: parseFloat(RATING_THRESHOLD) || 6
};

// Log confirmation message
console.log('Environment variables loaded.');
