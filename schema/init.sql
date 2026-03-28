-- Users Table
CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    last_name TEXT,
    display_name TEXT,
    age_years INTEGER,
    sex TEXT,
    weight_kg REAL,
    height_cm REAL,
    bmi REAL,
    bmi_status TEXT,
    healthy_bmi_low REAL,
    healthy_bmi_high REAL,
    target_weight_low_kg REAL,
    target_weight_high_kg REAL,
    target_weight_kg REAL,
    daily_calorie_goal REAL,
    timezone TEXT DEFAULT 'UTC',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS coach_state (
    telegram_id INTEGER PRIMARY KEY,
    memory TEXT,
    pending_chunks TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (telegram_id) REFERENCES users(telegram_id)
);

CREATE TABLE IF NOT EXISTS daily_calorie_goals (
    user_id INTEGER NOT NULL,
    goal_date DATE NOT NULL,
    goal_calories INTEGER NOT NULL,
    rationale TEXT,
    source TEXT DEFAULT 'gemini',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, goal_date)
);

CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

-- Nutrition Entries Table
CREATE TABLE IF NOT EXISTS nutrition_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    telegram_id INTEGER NOT NULL,
    entry_date DATE NOT NULL,
    image_url TEXT,
    telegram_file_id TEXT,
    food_name TEXT,
    calories INTEGER NOT NULL,
    protein_g REAL NOT NULL,
    carbs_g REAL NOT NULL,
    fats_g REAL NOT NULL,
    ai_tip TEXT,
    ai_raw_response TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
);

CREATE INDEX IF NOT EXISTS idx_nutrition_entries_user_id ON nutrition_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_entry_date ON nutrition_entries(entry_date);
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_telegram_id ON nutrition_entries(telegram_id);
CREATE INDEX IF NOT EXISTS idx_nutrition_entries_created_at ON nutrition_entries(created_at);

-- Daily Summaries Table
CREATE TABLE IF NOT EXISTS daily_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    summary_date DATE NOT NULL,
    total_calories INTEGER DEFAULT 0,
    total_protein_g REAL DEFAULT 0,
    total_carbs_g REAL DEFAULT 0,
    total_fats_g REAL DEFAULT 0,
    entry_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id),
    UNIQUE(user_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_summaries_user_id ON daily_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_daily_summaries_summary_date ON daily_summaries(summary_date);

-- Trigger for automatic daily summary update
CREATE TRIGGER IF NOT EXISTS update_daily_summary_after_insert
AFTER INSERT ON nutrition_entries
FOR EACH ROW
WHEN NEW.is_deleted = 0
BEGIN
    INSERT OR REPLACE INTO daily_summaries (
        user_id, summary_date, total_calories, total_protein_g, 
        total_carbs_g, total_fats_g, entry_count, created_at, updated_at
    )
    SELECT 
        user_id,
        entry_date,
        SUM(calories),
        SUM(protein_g),
        SUM(carbs_g),
        SUM(fats_g),
        COUNT(*),
        COALESCE((SELECT created_at FROM daily_summaries WHERE user_id = NEW.user_id AND summary_date = NEW.entry_date), CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP
    FROM nutrition_entries
    WHERE user_id = NEW.user_id 
    AND entry_date = NEW.entry_date 
    AND is_deleted = 0
    GROUP BY user_id, entry_date;
END;

CREATE TRIGGER IF NOT EXISTS update_daily_summary_after_soft_delete
AFTER UPDATE OF is_deleted ON nutrition_entries
FOR EACH ROW
BEGIN
    DELETE FROM daily_summaries
    WHERE user_id = NEW.user_id
      AND summary_date = NEW.entry_date
      AND NOT EXISTS (
        SELECT 1
        FROM nutrition_entries
        WHERE user_id = NEW.user_id
          AND entry_date = NEW.entry_date
          AND is_deleted = 0
      );

    INSERT OR REPLACE INTO daily_summaries (
        user_id, summary_date, total_calories, total_protein_g,
        total_carbs_g, total_fats_g, entry_count, created_at, updated_at
    )
    SELECT
        user_id,
        entry_date,
        SUM(calories),
        SUM(protein_g),
        SUM(carbs_g),
        SUM(fats_g),
        COUNT(*),
        COALESCE((SELECT created_at FROM daily_summaries WHERE user_id = NEW.user_id AND summary_date = NEW.entry_date), CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP
    FROM nutrition_entries
    WHERE user_id = NEW.user_id
      AND entry_date = NEW.entry_date
      AND is_deleted = 0
    GROUP BY user_id, entry_date;
END;

