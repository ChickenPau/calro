"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
dotenv_1.default.config();
exports.config = {
    telegram: {
        token: process.env.TELEGRAM_BOT_TOKEN || '',
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        textModel: process.env.GEMINI_TEXT_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite',
        imageModel: process.env.GEMINI_IMAGE_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
    database: {
        path: path_1.default.resolve(process.cwd(), process.env.DATABASE_URL || 'database/calro.db'),
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
if (!exports.config.telegram.token) {
    console.warn('TELEGRAM_BOT_TOKEN is not set in environment variables');
}
if (!exports.config.gemini.apiKey) {
    console.warn('GEMINI_API_KEY is not set in environment variables');
}
//# sourceMappingURL=index.js.map