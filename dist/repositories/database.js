"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.databaseRepository = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("@/config");
class DatabaseRepository {
    constructor() {
        const dbDir = path_1.default.dirname(config_1.config.database.path);
        if (!fs_1.default.existsSync(dbDir)) {
            fs_1.default.mkdirSync(dbDir, { recursive: true });
        }
        this.db = new better_sqlite3_1.default(config_1.config.database.path);
        this.db.pragma('foreign_keys = ON');
        this.initialize();
    }
    initialize() {
        const initScriptPathPrimary = path_1.default.resolve(process.cwd(), 'database/init.sql');
        const initScriptPathFallback = path_1.default.resolve(process.cwd(), 'schema/init.sql');
        const initScriptPath = fs_1.default.existsSync(initScriptPathPrimary) ? initScriptPathPrimary : initScriptPathFallback;
        const initScript = fs_1.default.readFileSync(initScriptPath, 'utf8');
        this.db.exec(initScript);
        this.runMigrations();
    }
    runMigrations() {
        const nutritionCols = this.db.prepare(`PRAGMA table_info(nutrition_entries)`).all();
        const nutritionColNames = new Set(nutritionCols.map((c) => c.name));
        if (!nutritionColNames.has('telegram_file_id')) {
            this.db.exec(`ALTER TABLE nutrition_entries ADD COLUMN telegram_file_id TEXT`);
        }
        if (!nutritionColNames.has('food_name')) {
            this.db.exec(`ALTER TABLE nutrition_entries ADD COLUMN food_name TEXT`);
        }
        if (!nutritionColNames.has('ingredients_json')) {
            this.db.exec(`ALTER TABLE nutrition_entries ADD COLUMN ingredients_json TEXT`);
        }
        const userCols = this.db.prepare(`PRAGMA table_info(users)`).all();
        const userColNames = new Set(userCols.map((c) => c.name));
        if (!userColNames.has('display_name')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN display_name TEXT`);
        }
        if (!userColNames.has('age_years')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN age_years INTEGER`);
        }
        if (!userColNames.has('sex')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN sex TEXT`);
        }
        if (!userColNames.has('weight_kg')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN weight_kg REAL`);
        }
        if (!userColNames.has('height_cm')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN height_cm REAL`);
        }
        if (!userColNames.has('bmi')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN bmi REAL`);
        }
        if (!userColNames.has('bmi_status')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN bmi_status TEXT`);
        }
        if (!userColNames.has('healthy_bmi_low')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN healthy_bmi_low REAL`);
        }
        if (!userColNames.has('healthy_bmi_high')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN healthy_bmi_high REAL`);
        }
        if (!userColNames.has('target_weight_low_kg')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN target_weight_low_kg REAL`);
        }
        if (!userColNames.has('target_weight_high_kg')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN target_weight_high_kg REAL`);
        }
        if (!userColNames.has('target_weight_kg')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN target_weight_kg REAL`);
        }
        if (!userColNames.has('daily_calorie_goal')) {
            this.db.exec(`ALTER TABLE users ADD COLUMN daily_calorie_goal REAL`);
        }
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS coach_state (
        telegram_id INTEGER PRIMARY KEY,
        memory TEXT,
        pending_chunks TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
      )
    `);
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_calorie_goals (
        user_id INTEGER NOT NULL,
        goal_date DATE NOT NULL,
        goal_calories INTEGER NOT NULL,
        rationale TEXT,
        source TEXT DEFAULT 'gemini',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, goal_date)
      )
    `);
    }
    getDb() {
        return this.db;
    }
    close() {
        this.db.close();
    }
}
exports.databaseRepository = new DatabaseRepository();
exports.default = exports.databaseRepository;
//# sourceMappingURL=database.js.map