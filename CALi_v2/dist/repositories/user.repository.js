"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRepository = exports.UserRepository = void 0;
const database_1 = require("./database");
class UserRepository {
    constructor() {
        this.db = database_1.databaseRepository.getDb();
    }
    upsertUser(user) {
        const stmt = this.db.prepare(`
      INSERT INTO users (telegram_id, username, first_name, last_name, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(telegram_id) DO UPDATE SET
        username = excluded.username,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(user.telegram_id, user.username, user.first_name, user.last_name);
    }
    setProfile(profile) {
        const stmt = this.db.prepare(`
      INSERT INTO users (
        telegram_id,
        display_name,
        age_years,
        sex,
        weight_kg,
        height_cm,
        bmi,
        bmi_status,
        healthy_bmi_low,
        healthy_bmi_high,
        target_weight_low_kg,
        target_weight_high_kg,
        target_weight_kg,
        daily_calorie_goal
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(telegram_id) DO UPDATE SET
        display_name = excluded.display_name,
        age_years = excluded.age_years,
        sex = excluded.sex,
        weight_kg = excluded.weight_kg,
        height_cm = excluded.height_cm,
        bmi = excluded.bmi,
        bmi_status = excluded.bmi_status,
        healthy_bmi_low = excluded.healthy_bmi_low,
        healthy_bmi_high = excluded.healthy_bmi_high,
        target_weight_low_kg = excluded.target_weight_low_kg,
        target_weight_high_kg = excluded.target_weight_high_kg,
        target_weight_kg = excluded.target_weight_kg,
        daily_calorie_goal = excluded.daily_calorie_goal,
        updated_at = CURRENT_TIMESTAMP
    `);
        stmt.run(profile.telegram_id, profile.display_name, profile.age_years, profile.sex, profile.weight_kg, profile.height_cm, profile.bmi, profile.bmi_status, profile.healthy_bmi_low, profile.healthy_bmi_high, profile.target_weight_low_kg, profile.target_weight_high_kg, (profile.target_weight_low_kg + profile.target_weight_high_kg) / 2, profile.daily_calorie_goal);
    }
    clearProfile(telegram_id) {
        const stmt = this.db.prepare(`
      UPDATE users
      SET
        display_name = NULL,
        age_years = NULL,
        sex = NULL,
        weight_kg = NULL,
        height_cm = NULL,
        bmi = NULL,
        bmi_status = NULL,
        healthy_bmi_low = NULL,
        healthy_bmi_high = NULL,
        target_weight_low_kg = NULL,
        target_weight_high_kg = NULL,
        target_weight_kg = NULL,
        daily_calorie_goal = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `);
        stmt.run(telegram_id);
    }
    deleteUser(telegram_id) {
        const stmt = this.db.prepare('DELETE FROM users WHERE telegram_id = ?');
        stmt.run(telegram_id);
    }
    getUser(telegram_id) {
        const stmt = this.db.prepare('SELECT * FROM users WHERE telegram_id = ?');
        return stmt.get(telegram_id);
    }
    getProfile(telegram_id) {
        const user = this.getUser(telegram_id);
        if (!user)
            return null;
        if (!user.display_name ||
            user.age_years === null ||
            user.age_years === undefined ||
            !user.sex ||
            user.weight_kg === null ||
            user.weight_kg === undefined ||
            user.height_cm === null ||
            user.height_cm === undefined ||
            user.bmi === null ||
            user.bmi === undefined ||
            !user.bmi_status ||
            user.healthy_bmi_low === null ||
            user.healthy_bmi_low === undefined ||
            user.healthy_bmi_high === null ||
            user.healthy_bmi_high === undefined ||
            user.target_weight_low_kg === null ||
            user.target_weight_low_kg === undefined ||
            user.target_weight_high_kg === null ||
            user.target_weight_high_kg === undefined ||
            user.daily_calorie_goal === null ||
            user.daily_calorie_goal === undefined) {
            return null;
        }
        return {
            telegram_id: user.telegram_id,
            display_name: user.display_name,
            age_years: Number(user.age_years),
            sex: user.sex === 'Male' ? 'Male' : user.sex === 'Female' ? 'Female' : 'Other',
            weight_kg: Number(user.weight_kg),
            height_cm: Number(user.height_cm),
            bmi: Number(user.bmi),
            bmi_status: user.bmi_status === 'Obese' ? 'Obese' : 'Acceptable range',
            healthy_bmi_low: Number(user.healthy_bmi_low),
            healthy_bmi_high: Number(user.healthy_bmi_high),
            target_weight_low_kg: Number(user.target_weight_low_kg),
            target_weight_high_kg: Number(user.target_weight_high_kg),
            daily_calorie_goal: Number(user.daily_calorie_goal),
        };
    }
    updateTimezone(telegram_id, timezone) {
        const stmt = this.db.prepare('UPDATE users SET timezone = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?');
        stmt.run(timezone, telegram_id);
    }
    updateDailyCalorieGoal(telegram_id, daily_calorie_goal) {
        const stmt = this.db.prepare('UPDATE users SET daily_calorie_goal = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?');
        stmt.run(daily_calorie_goal, telegram_id);
    }
}
exports.UserRepository = UserRepository;
exports.userRepository = new UserRepository();
exports.default = exports.userRepository;
//# sourceMappingURL=user.repository.js.map