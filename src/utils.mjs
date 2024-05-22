import axios from 'axios';
import winston from 'winston';
import prettyBytes from 'pretty-bytes';
import pLimit from 'p-limit';
import chalk from 'chalk';

const maxRetries = 3;
const limit = pLimit(10);

export const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'logs/trimrr.log', options: { flags: 'a' } })
    ]
});

export async function fetchWithRetries(url, options, retries = 0) {
    try {
        const response = await axios(url, options);
        return response;
    } catch (error) {
        const status = error.response ? error.response.status : 'Network Error';
        const message = error.message || 'Unknown error occurred';
        
        logger.error(`Error fetching URL: ${url}, Status: ${status}, Message: ${message}`);

        if (error.response && status === 429 && retries < maxRetries) {
            const retryAfter = error.response.headers['retry-after']
                ? parseInt(error.response.headers['retry-after']) * 1000
                : (retries + 1) * 1000;
            logger.warn(`Rate limit exceeded for URL: ${url}. Retrying in ${retryAfter / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            return fetchWithRetries(url, options, retries + 1);
        } else if (status >= 500 && retries < maxRetries) {
            const retryAfter = (retries + 1) * 1000;
            logger.warn(`Server error for URL: ${url}. Retrying in ${retryAfter / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter));
            return fetchWithRetries(url, options, retries + 1);
        } else {
            logger.error(`Failed to fetch URL: ${url} after ${retries + 1} attempts. Error: ${message}`);
            throw error;
        }
    }
}

export function formatRating(rating, ratingThreshold) {
    return rating < ratingThreshold ? chalk.red(rating) : chalk.green(rating);
}

export function formatSize(sizeString) {
    const sizeValue = parseSizeString(sizeString);
    if (sizeValue < 10 * 1024 * 1024 * 1024) { // less than 10 GB
        return chalk.green(sizeString);
    } else if (sizeValue <= 100 * 1024 * 1024 * 1024) { // between 10 GB and 100 GB
        return chalk.rgb(255, 165, 0)(sizeString); // Orange color
    } else {
        return chalk.red(sizeString);
    }
}

export async function getKeypress() {
    return new Promise((resolve) => {
        process.stdin.setRawMode(true);
        process.stdin.once('data', (data) => {
            process.stdin.setRawMode(false);
            const input = data.toString().trim();
            resolve(input);
        });
    });
}



export function parseSizeString(sizeString) {
    const sizeValue = parseFloat(sizeString);
    if (sizeString.includes('GB')) {
        return sizeValue * 1024 * 1024 * 1024; // convert GB to bytes
    } else if (sizeString.includes('MB')) {
        return sizeValue * 1024 * 1024; // convert MB to bytes
    } else if (sizeString.includes('KB')) {
        return sizeValue * 1024; // convert KB to bytes
    } else {
        return sizeValue; // assume bytes
    }
}

export { prettyBytes, limit, chalk };
