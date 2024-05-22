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
        new winston.transports.File({ filename: 'main_script.log' })
    ]
});

export async function fetchWithRetries(url, options, retries = 0) {
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
            if (input) {
                process.stdout.write('\n'); // Print a newline only if there is input
            }
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
