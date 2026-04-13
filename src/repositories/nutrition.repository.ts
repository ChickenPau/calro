import { databaseRepository } from './database';
import { Database } from 'better-sqlite3';
import { NutritionEntry, DailySummary } from '@/models/nutrition';

export class NutritionRepository {
  private db: Database;

  constructor() {
    this.db = databaseRepository.getDb();
  }

  public addEntry(entry: Omit<NutritionEntry, 'id' | 'created_at' | 'updated_at' | 'is_deleted'>): number {
    const stmt = this.db.prepare(`
      INSERT INTO nutrition_entries (
        user_id, telegram_id, entry_date, image_url, telegram_file_id, food_name, calories, protein_g, carbs_g, fats_g, ai_tip, ingredients_json, ai_raw_response
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      entry.user_id,
      entry.telegram_id,
      entry.entry_date,
      entry.image_url,
      entry.telegram_file_id,
      entry.food_name,
      entry.calories,
      entry.protein_g,
      entry.carbs_g,
      entry.fats_g,
      entry.ai_tip,
      entry.ingredients_json,
      entry.ai_raw_response
    );

    return Number(result.lastInsertRowid);
  }

  public updateEntryForUser(
    telegram_id: number,
    id: number,
    patch: Pick<NutritionEntry, 'food_name' | 'calories' | 'protein_g' | 'carbs_g' | 'fats_g' | 'ai_tip' | 'ingredients_json' | 'ai_raw_response'>
  ): NutritionEntry | null {
    const entry = this.getActiveEntryForUserById(telegram_id, id);
    if (!entry) return null;

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
    const result = stmt.run(
      patch.food_name,
      patch.calories,
      patch.protein_g,
      patch.carbs_g,
      patch.fats_g,
      patch.ai_tip,
      patch.ingredients_json,
      patch.ai_raw_response,
      id,
      telegram_id
    );
    if (result.changes === 0) return null;

    this.recomputeDailySummary(telegram_id, entry.entry_date);
    return this.getActiveEntryForUserById(telegram_id, id) ?? null;
  }

  public pruneToLastMeals(telegram_id: number, keep: number = 10): void {
    if (keep <= 0) return;

    const rows = this.db
      .prepare(
        `
          SELECT id, entry_date
          FROM nutrition_entries
          WHERE user_id = ? AND is_deleted = 0
          ORDER BY datetime(created_at) DESC, id DESC
          LIMIT -1 OFFSET ?
        `
      )
      .all(telegram_id, keep) as Array<{ id: number; entry_date: string }>;

    if (rows.length === 0) return;

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

  public recomputeDailySummary(telegram_id: number, date: string): void {
    const totals = this.db
      .prepare(
        `
          SELECT
            COALESCE(SUM(calories), 0) AS total_calories,
            COALESCE(SUM(protein_g), 0) AS total_protein_g,
            COALESCE(SUM(carbs_g), 0) AS total_carbs_g,
            COALESCE(SUM(fats_g), 0) AS total_fats_g,
            COALESCE(COUNT(*), 0) AS entry_count
          FROM nutrition_entries
          WHERE user_id = ? AND entry_date = ? AND is_deleted = 0
        `
      )
      .get(telegram_id, date) as {
      total_calories: number;
      total_protein_g: number;
      total_carbs_g: number;
      total_fats_g: number;
      entry_count: number;
    };

    if (!totals || totals.entry_count === 0) {
      this.db.prepare(`DELETE FROM daily_summaries WHERE user_id = ? AND summary_date = ?`).run(telegram_id, date);
      return;
    }

    const createdAtRow = this.db
      .prepare(`SELECT created_at FROM daily_summaries WHERE user_id = ? AND summary_date = ?`)
      .get(telegram_id, date) as { created_at?: string } | undefined;

    const created_at = createdAtRow?.created_at ?? new Date().toISOString();

    this.db
      .prepare(
        `
          INSERT OR REPLACE INTO daily_summaries (
            user_id, summary_date, total_calories, total_protein_g, total_carbs_g, total_fats_g, entry_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `
      )
      .run(
        telegram_id,
        date,
        totals.total_calories,
        totals.total_protein_g,
        totals.total_carbs_g,
        totals.total_fats_g,
        totals.entry_count,
        created_at
      );
  }

  public getDailySummary(telegram_id: number, date: string): DailySummary | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM daily_summaries 
      WHERE user_id = ? AND summary_date = ?
    `);
    return stmt.get(telegram_id, date) as DailySummary | undefined;
  }

  public getDailyCaloriesSince(telegram_id: number, startDate: string, limitDays: number): Array<{ summary_date: string; total_calories: number }> {
    const stmt = this.db.prepare(`
      SELECT summary_date, total_calories
      FROM daily_summaries
      WHERE user_id = ? AND summary_date >= ?
      ORDER BY summary_date DESC
      LIMIT ?
    `);
    return stmt.all(telegram_id, startDate, limitDays) as Array<{ summary_date: string; total_calories: number }>;
  }

  public getHistory(telegram_id: number, limit: number = 10): NutritionEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries 
      WHERE user_id = ? AND is_deleted = 0 
      ORDER BY created_at DESC 
      LIMIT ?
    `);
    return stmt.all(telegram_id, limit) as NutritionEntry[];
  }

  public getEntriesForDate(telegram_id: number, date: string): NutritionEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries
      WHERE user_id = ? AND entry_date = ? AND is_deleted = 0
      ORDER BY created_at DESC
    `);
    return stmt.all(telegram_id, date) as NutritionEntry[];
  }

  public getEntryById(id: number): NutritionEntry | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries
      WHERE id = ?
    `);
    return stmt.get(id) as NutritionEntry | undefined;
  }

  public getActiveEntryForUserById(telegram_id: number, id: number): NutritionEntry | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `);
    return stmt.get(id, telegram_id) as NutritionEntry | undefined;
  }

  public getAllEntries(telegram_id: number): NutritionEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM nutrition_entries 
      WHERE user_id = ? AND is_deleted = 0 
      ORDER BY created_at DESC
    `);
    return stmt.all(telegram_id) as NutritionEntry[];
  }

  public softDeleteEntry(id: number): void {
    const stmt = this.db.prepare(`
      UPDATE nutrition_entries SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    stmt.run(id);
  }

  public softDeleteEntryForUser(telegram_id: number, id: number): NutritionEntry | null {
    const entry = this.getActiveEntryForUserById(telegram_id, id);
    if (!entry) return null;

    const stmt = this.db.prepare(`
      UPDATE nutrition_entries
      SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ? AND is_deleted = 0
    `);
    const result = stmt.run(id, telegram_id);
    if (result.changes === 0) return null;

    this.recomputeDailySummary(telegram_id, entry.entry_date);
    return entry;
  }

  public deleteAllEntriesForUser(telegram_id: number): void {
    const stmt = this.db.prepare(`DELETE FROM nutrition_entries WHERE user_id = ?`);
    stmt.run(telegram_id);
  }

  public deleteDailySummariesForUser(telegram_id: number): void {
    const stmt = this.db.prepare(`DELETE FROM daily_summaries WHERE user_id = ?`);
    stmt.run(telegram_id);
  }

  public deleteDailyCalorieGoalsForUser(telegram_id: number): void {
    const stmt = this.db.prepare(`DELETE FROM daily_calorie_goals WHERE user_id = ?`);
    stmt.run(telegram_id);
  }
}

export const nutritionRepository = new NutritionRepository();
export default nutritionRepository;
