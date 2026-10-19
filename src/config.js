import { readFileSync } from 'node:fs';

export function loadEnv(path = '.env') {
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/);
      if (match && process.env[match[1]] === undefined) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2').trim();
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function configFromEnv() {
  const token = process.env.BOT_TOKEN?.trim();
  if (!token || !/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error('BOT_TOKEN .env faylida to‘g‘ri berilishi kerak.');
  }
  const adminIds = new Set((process.env.ADMIN_IDS ?? '')
    .split(',').map((id) => id.trim()).filter(Boolean));
  return {
    token,
    adminIds,
    databaseUrl: process.env.DATABASE_URL || null,
    databasePath: process.env.DATABASE_PATH || './data/bot.sqlite',
  };
}
