import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Dynamically determine the path to the .env file
const currentWorkingDir = process.cwd();
const envPath = resolve(currentWorkingDir.includes('bin') ? currentWorkingDir : `${currentWorkingDir}/bin`, '../.env');
dotenv.config({ path: envPath });

export const embyApiKey = process.env.EMBY_API_KEY;
export const embyServerUrl = process.env.EMBY_SERVER_URL;
export const traktClientId = process.env.TRAKT_CLIENT_ID;
export const sonarrApiKey = process.env.SONARR_API_KEY;
export const sonarrServerUrl = process.env.SONARR_SERVER_URL;
export const ratingThreshold = parseFloat(process.env.RATING_THRESHOLD) || 6;

console.log('Loaded environment variables:');
console.log(`EMBY_API_KEY: ${embyApiKey}`);
console.log(`EMBY_SERVER_URL: ${embyServerUrl}`);
console.log(`TRAKT_CLIENT_ID: ${traktClientId}`);
console.log(`SONARR_API_KEY: ${sonarrApiKey}`);
console.log(`SONARR_SERVER_URL: ${sonarrServerUrl}`);
console.log(`RATING_THRESHOLD: ${ratingThreshold}`);
