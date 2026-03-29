import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  telegram: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3-flash',
    textModel: process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash-lite',
    imageModel: process.env.GEMINI_IMAGE_MODEL || process.env.GEMINI_MODEL || 'gemini-3-flash',
  },
  database: {
    path: path.resolve(process.cwd(), process.env.DATABASE_URL || 'database/calro.db'),
  },
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
  server: {
    port: parseInt(process.env.PORT || '3000', 10),
    env: process.env.NODE_ENV || 'development',
  },
};

// Validate required config
if (!config.telegram.token) {
  console.warn('TELEGRAM_BOT_TOKEN is not set in environment variables');
}
if (!config.gemini.apiKey) {
  console.warn('GEMINI_API_KEY is not set in environment variables');
}
