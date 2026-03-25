"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calorieGoalRepository = exports.CalorieGoalRepository = void 0;
const database_1 = require("./database");
class CalorieGoalRepository {
    constructor() {
        this.db = database_1.databaseRepository.getDb();
    }
    getGoal(user_id, goal_date) {
        const stmt = this.db.prepare(`
      SELECT * FROM daily_calorie_goals WHERE user_id = ? AND goal_date = ?
    `);
        return stmt.get(user_id, goal_date);
    }
    upsertGoal(input) {
        const stmt = this.db.prepare(`
      INSERT INTO daily_calorie_goals (user_id, goal_date, goal_calories, rationale, source, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, goal_date) DO UPDATE SET
        goal_calories = excluded.goal_calories,
        rationale = excluded.rationale,
        source = excluded.source,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(input.user_id, input.goal_date, input.goal_calories, input.rationale || null, input.source || 'gemini');
    }
}
exports.CalorieGoalRepository = CalorieGoalRepository;
exports.calorieGoalRepository = new CalorieGoalRepository();
exports.default = exports.calorieGoalRepository;
//# sourceMappingURL=calorie-goal.repository.js.map