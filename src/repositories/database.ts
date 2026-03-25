import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '@/config';

class DatabaseRepository {
  private db: Database.Database;

  constructor() {
    const dbDir = path.dirname(config.database.path);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.db = new Database(config.database.path);
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize() {
    const initScriptPath = path.resolve(process.cwd(), 'database/init.sql');
    const initScript = fs.readFileSync(initScriptPath, 'utf8');
    this.db.exec(initScript);
    this.runMigrations();
  }

  private runMigrations() {
    const nutritionCols = this.db.prepare(`PRAGMA table_info(nutrition_entries)`).all() as Array<{ name: string }>;
    const nutritionColNames = new Set(nutritionCols.map((c) => c.name));

    if (!nutritionColNames.has('telegram_file_id')) {
      this.db.exec(`ALTER TABLE nutrition_entries ADD COLUMN telegram_file_id TEXT`);
    }
    if (!nutritionColNames.has('food_name')) {
      this.db.exec(`ALTER TABLE nutrition_entries ADD COLUMN food_name TEXT`);
    }

    const userCols = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
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

  public getDb(): Database.Database {
    return this.db;
  }

  public close() {
    this.db.close();
  }
}

export const databaseRepository = new DatabaseRepository();
export default databaseRepository;
