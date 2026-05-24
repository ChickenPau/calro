"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nutritionRepository = exports.NutritionRepository = void 0;
const database_1 = require("./database");
class NutritionRepository {
    constructor() {
        this.db = database_1.databaseRepository.getDb();
    }
    addEntry(entry) {
        const stmt = this.db.prepare(`
      INSERT INTO nutrition_entries (
        user_id, telegram_id, entry_date, image_url, telegram_file_id, food_name, calories, protein_g, carbs_g, fats_g, ai_tip, ingredients_json, ai_raw_response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        const result = stmt.run(entry.user_id, entry.telegram_id, entry.entry_date, entry.image_url, entry.telegram_file_id, entry.food_name, entry.calories, entry.protein_g, entry.carbs_g, entry.fats_g, entry.ai_tip, entry.ingredients_json, entry.ai_raw_response);
        return Number(result.lastInsertRowid);
    }
    updateEntryForUser(telegram_id, id, patch) {
        const entry = this.getActiveEntryForUserById(telegram_id, id);
        if (!entry)
            return null;
        const stmt = this.db.prepare(`
      UPDATE nutrition_entries
      SET
        food_name = ?,
        calories = ?,
        protein_g = ?,
        carbs_g = ?,
        fats_g = ?,
        ai_tip = ?,
        ingredients_json = ?,
        ai_raw_response = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `);
        const result = stmt.run(patch.food_name, patch.calories, patch.protein_g, patch.carbs_g, patch.fats_g, patch.ai_tip, patch.ingredients_json, patch.ai_raw_response, id, telegram_id);
        if (result.changes === 0)
            return null;
        this.recomputeDailySummary(telegram_id, entry.entry_date);
        return this.getActiveEntryForUserById(telegram_id, id) ?? null;
    }
    pruneToLastMeals(telegram_id, keep = 10) {
        if (keep <= 0)
            return;
        const rows = this.db
            .prepare(`
          SELECT id, entry_date
          FROM nutrition_entries
          WHERE user_id = ? AND is_deleted = 0
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT -1 OFFSET ?
        `)
            .all(telegram_id, keep);
        if (rows.length === 0)
            return;
        const ids = rows.map((r) => r.id);
        const dates = Array.from(new Set(rows.map((r) => r.entry_date)));
        const placeholders = ids.map(() => '?').join(',');
        this.db
            .prepare(`UPDATE nutrition_entries SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id IN (${placeholders})`)
            .run(telegram_id, ...ids);
        for (const date of dates) {
            this.recomputeDailySummary(telegram_id, date);
        }
    }
    trimPhotoReferencesToLast(telegram_id, keep = 10) {
        if (keep <= 0)
            return;
        const keepIds = this.db
            .prepare(`
          SELECT id
          FROM nutrition_entries
          WHERE user_id = ? AND is_deleted = 0 AND telegram_file_id IS NOT NULL AND telegram_file_id != ''
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT ?
        `)
            .all(telegram_id, keep);
        const ids = keepIds.map((r) => r.id);
        if (ids.length === 0) {
            this.db
                .prepare(`
            UPDATE nutrition_entries
            SET telegram_file_id = NULL, image_url = NULL, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND is_deleted = 0 AND telegram_file_id IS NOT NULL AND telegram_file_id != ''
          `)
                .run(telegram_id);
            return;
        }
        const placeholders = ids.map(() => '?').join(',');
        this.db
            .prepare(`
          UPDATE nutrition_entries
          SET telegram_file_id = NULL, image_url = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ?
            AND is_deleted = 0
            AND telegram_file_id IS NOT NULL AND telegram_file_id != ''
            AND id NOT IN (${placeholders})
        `)
            .run(telegram_id, ...ids);
    }
    recomputeDailySummary(telegram_id, date) {
        const totals = this.db
            .prepare(`
          SELECT
            COALESCE(SUM(calories), 0) AS total_calories,
            COALESCE(SUM(protein_g), 0) AS total_protein_g,
            COALESCE(SUM(carbs_g), 0) AS total_carbs_g,
            COALESCE(SUM(fats_g), 0) AS total_fats_g,
            COALESCE(COUNT(*), 0) AS entry_count
          FROM nutrition_entries
          WHERE user_id = ? AND entry_date = ? AND is_deleted = 0
        `)
            .get(telegram_id, date);
        if (!totals || totals.entry_count === 0) {
            this.db.prepare(`DELETE FROM daily_summaries WHERE user_id = ? AND summary_date = ?`).run(telegram_id, date);
            return;
        }
        const createdAtRow = this.db
            .prepare(`SELECT created_at FROM daily_summaries WHERE user_id = ? AND summary_date = ?`)
            .get(telegram_id, date);
        const created_at = createdAtRow?.created_at ?? new Date().toISOString();
        this.db
            .prepare(`
          INSERT OR REPLACE INTO daily_summaries (
            user_id, summary_date, total_calories, total_protein_g, total_carbs_g, total_fats_g, entry_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `)
            .run(telegram_id, date, totals.total_calories, totals.total_protein_g, totals.total_carbs_g, totals.total_fats_g, totals.entry_count, created_at);
    }
    getPhotoCountToday(telegramId, date) {
        const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM nutrition_entries
      WHERE telegram_id = ?
        AND entry_date = ?
        AND telegram_file_id IS NOT NULL
        AND is_deleted = 0
    `).get(telegramId, date);
        return row?.count ?? 0;
    }
    getPromptCountToday(telegramId, date) {
        const row = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM nutrition_entries
      WHERE telegram_id = ?
        AND entry_date = ?
        AND is_deleted = 0
    `).get(telegramId, date);
        return row?.count ?? 0;
    }
    getDailySummary(telegram_id, date) {
        const stmt = this.db.prepare(`
      SELECT * FROM daily_summaries 
      WHERE user_id = ? AND summary_date = ?
    `);
        return stmt.get(telegram_id, date);
    }
    getDailyCaloriesSince(telegram_id, startDate, limitDays) {
        const stmt = this.db.prepare(`
      SELECT summary_date, total_calories
      FROM daily_summaries
      WHERE user_id = ? AND summary_date >= ?
      ORDER BY summary_date DESC
      LIMIT ?
    `);
        return stmt.all(telegram_id, startDate, limitDays);
    }
    getHistory(telegram_id, limit = 10) {
        const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries 
      WHERE user_id = ? AND is_deleted = 0 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
        return stmt.all(telegram_id, limit);
    }
    getEntriesForDate(telegram_id, date) {
        const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries
      WHERE user_id = ? AND entry_date = ? AND is_deleted = 0
      ORDER BY created_at DESC
    `);
        return stmt.all(telegram_id, date);
    }
    getEntryById(id) {
        const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries
      WHERE id = ?
    `);
        return stmt.get(id);
    }
    getActiveEntryForUserById(telegram_id, id) {
        const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `);
        return stmt.get(id, telegram_id);
    }
    getAllEntries(telegram_id) {
        const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries 
      WHERE user_id = ? AND is_deleted = 0 
      ORDER BY created_at DESC
    `);
        return stmt.all(telegram_id);
    }
    softDeleteEntry(id) {
        const stmt = this.db.prepare(`
      UPDATE nutrition_entries SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
        stmt.run(id);
    }
    softDeleteEntryForUser(telegram_id, id) {
        const entry = this.getActiveEntryForUserById(telegram_id, id);
        if (!entry)
            return null;
        const stmt = this.db.prepare(`
      UPDATE nutrition_entries
      SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `);
        const result = stmt.run(id, telegram_id);
        if (result.changes === 0)
            return null;
        this.recomputeDailySummary(telegram_id, entry.entry_date);
        return entry;
    }
    deleteAllEntriesForUser(telegram_id) {
        const stmt = this.db.prepare(`DELETE FROM nutrition_entries WHERE user_id = ?`);
        stmt.run(telegram_id);
    }
    deleteDailySummariesForUser(telegram_id) {
        const stmt = this.db.prepare(`DELETE FROM daily_summaries WHERE user_id = ?`);
        stmt.run(telegram_id);
    }
    deleteDailyCalorieGoalsForUser(telegram_id) {
        const stmt = this.db.prepare(`DELETE FROM daily_calorie_goals WHERE user_id = ?`);
        stmt.run(telegram_id);
    }
}
exports.NutritionRepository = NutritionRepository;
exports.nutritionRepository = new NutritionRepository();
exports.default = exports.nutritionRepository;
//# sourceMappingURL=nutrition.repository.js.map