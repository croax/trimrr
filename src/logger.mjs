import winston from 'winston';
import { format, transports } from 'winston';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Create a unique log file name based on the current timestamp
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const logDir = resolve(__dirname, '../logs');
const logFileName = `${logDir}/trimrr-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;

// Ensure the logs directory exists
import { existsSync, mkdirSync } from 'fs';
if (!existsSync(logDir)) {
    mkdirSync(logDir);
}

const logger = winston.createLogger({
    level: 'debug',
    format: format.combine(
        format.timestamp(),
        format.printf(info => `${info.timestamp} [${info.level.toUpperCase()}] ${info.message}`)
    ),
    transports: [
        new transports.Console(),
        new transports.File({ filename: logFileName })
    ]
});

export default logger;
