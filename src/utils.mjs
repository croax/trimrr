import axios from 'axios';
import logger from './logger.mjs';
import chalk from 'chalk';

const maxRetries = 3;

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
    const sizeValue = parseFloat(sizeString);
    if (sizeValue < 10) {
        return chalk.green(sizeString);
    } else if (sizeValue <= 100) {
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
            resolve(data.toString());
        });
    });
}
