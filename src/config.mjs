import dotenv from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = resolve(__dirname, '../');  // Adjusted to point to the project root
const envPath = resolve(projectRoot, '.env');   // Ensure the .env is in the project root
dotenv.config({ path: envPath });

const {
    EMBY_API_KEY,
    EMBY_SERVER_URL,
    TRAKT_CLIENT_ID,
    SONARR_API_KEY,
    SONARR_SERVER_URL,
    RATING_THRESHOLD
} = process.env;

// Log the loaded environment variables for debugging
console.log('Loaded environment variables:');
console.log(`EMBY_API_KEY: ${EMBY_API_KEY}`);
console.log(`EMBY_SERVER_URL: ${EMBY_SERVER_URL}`);
console.log(`TRAKT_CLIENT_ID: ${TRAKT_CLIENT_ID}`);
console.log(`SONARR_API_KEY: ${SONARR_API_KEY}`);
console.log(`SONARR_SERVER_URL: ${SONARR_SERVER_URL}`);
console.log(`RATING_THRESHOLD: ${RATING_THRESHOLD}`);

export const embyApiKey = EMBY_API_KEY;
export const embyServerUrl = EMBY_SERVER_URL;
export const traktClientId = TRAKT_CLIENT_ID;
export const sonarrApiKey = SONARR_API_KEY;
export const sonarrServerUrl = SONARR_SERVER_URL;
export const ratingThreshold = parseFloat(RATING_THRESHOLD) || 6;
