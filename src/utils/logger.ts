/**
 * シンプルなログユーティリティ
 */

type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';

const formatTimestamp = (): string => {
  return new Date().toISOString();
};

const log = (level: LogLevel, message: string, meta?: unknown): void => {
  const timestamp = formatTimestamp();
  const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${timestamp}] [${level}] ${message}${metaStr}`);
};

export const logger = {
  info: (message: string, meta?: unknown) => log('INFO', message, meta),
  warn: (message: string, meta?: unknown) => log('WARN', message, meta),
  error: (message: string, meta?: unknown) => log('ERROR', message, meta),
  debug: (message: string, meta?: unknown) => {
    if (process.env.DEBUG === 'true') {
      log('DEBUG', message, meta);
    }
  },
};
