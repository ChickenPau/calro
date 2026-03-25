"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nutritionService = exports.NutritionService = void 0;
const user_repository_1 = require("@/repositories/user.repository");
const nutrition_repository_1 = require("@/repositories/nutrition.repository");
const coach_repository_1 = require("@/repositories/coach.repository");
const ai_service_1 = require("./ai.service");
const csv_writer_1 = require("csv-writer");
const bmi_1 = require("@/utils/bmi");
const time_1 = require("@/utils/time");
class NutritionService {
    async registerUser(telegram_id, username, first_name, last_name) {
        user_repository_1.userRepository.upsertUser({ telegram_id, username, first_name, last_name });
    }
    getProfile(telegram_id) {
        return user_repository_1.userRepository.getProfile(telegram_id);
    }
    async setProfile(telegram_id, display_name, age_years, sex, weight_kg, height_cm) {
        const bmiValue = (0, bmi_1.calculateBmi)(weight_kg, height_cm);
        const bmi_status = bmiValue > 27 ? 'Obese' : 'Acceptable range';
        let bmiRange;
        try {
            bmiRange = await ai_service_1.aiService.getHealthyBmiRange({ age_years, sex, height_cm });
        }
        catch {
            bmiRange = { bmi_low: 18.5, bmi_high: 24.9, rationale: 'Fallback adult range' };
        }
        let dailyCalorieGoal = 2500;
        try {
            const goalData = await ai_service_1.aiService.calculateDailyCalorieGoal({ age_years, sex, height_cm, weight_kg });
            dailyCalorieGoal = goalData.goal_calories;
        }
        catch {
            dailyCalorieGoal = 2500;
        }
        const healthyLow = bmiRange.bmi_low;
        const healthyHigh = bmiRange.bmi_high;
        const target = (0, bmi_1.weightRangeForBmi)(height_cm, healthyLow, healthyHigh);
        const profile = {
            telegram_id,
            display_name,
            age_years,
            sex,
            weight_kg,
            height_cm,
            bmi: bmiValue,
            bmi_status,
            healthy_bmi_low: healthyLow,
            healthy_bmi_high: healthyHigh,
            target_weight_low_kg: target.lowKg,
            target_weight_high_kg: target.highKg,
            daily_calorie_goal: dailyCalorieGoal,
        };
        user_repository_1.userRepository.setProfile(profile);
        return profile;
    }
    removeProfileAndReset(telegram_id) {
        coach_repository_1.coachRepository.clearState(telegram_id);
        nutrition_repository_1.nutritionRepository.deleteAllEntriesForUser(telegram_id);
        nutrition_repository_1.nutritionRepository.deleteDailySummariesForUser(telegram_id);
        nutrition_repository_1.nutritionRepository.deleteDailyCalorieGoalsForUser(telegram_id);
        user_repository_1.userRepository.deleteUser(telegram_id);
    }
    async processFoodPhoto(telegram_id, imageBase64, mimeType, userDescription, telegram_file_id) {
        const { data, rawResponse } = await ai_service_1.aiService.analyzeFoodImage(imageBase64, mimeType, userDescription);
        const entry_date = (0, time_1.formatYmdInUtcOffset)(new Date());
        nutrition_repository_1.nutritionRepository.addEntry({
            user_id: telegram_id,
            telegram_id,
            entry_date,
            telegram_file_id,
            food_name: data.food_name,
            calories: data.calories,
            protein_g: data.protein_g,
            carbs_g: data.carbs_g,
            fats_g: data.fats_g,
            ai_tip: data.ai_tip,
            ai_raw_response: rawResponse,
        });
        nutrition_repository_1.nutritionRepository.pruneToLastMeals(telegram_id, 10);
        return { data, entry_date };
    }
    async processFoodText(telegram_id, description) {
        const { data, rawResponse } = await ai_service_1.aiService.analyzeFoodText(description);
        const entry_date = (0, time_1.formatYmdInUtcOffset)(new Date());
        nutrition_repository_1.nutritionRepository.addEntry({
            user_id: telegram_id,
            telegram_id,
            entry_date,
            telegram_file_id: undefined,
            food_name: data.food_name,
            calories: data.calories,
            protein_g: data.protein_g,
            carbs_g: data.carbs_g,
            fats_g: data.fats_g,
            ai_tip: data.ai_tip,
            ai_raw_response: rawResponse,
        });
        nutrition_repository_1.nutritionRepository.pruneToLastMeals(telegram_id, 10);
        return { data, entry_date };
    }
    async getDailyStats(telegram_id, date) {
        const summaryDate = date || (0, time_1.formatYmdInUtcOffset)(new Date());
        const summary = nutrition_repository_1.nutritionRepository.getDailySummary(telegram_id, summaryDate);
        if (!summary) {
            return null;
        }
        const totalMacros = summary.total_protein_g + summary.total_carbs_g + summary.total_fats_g;
        const proteinPct = totalMacros > 0 ? (summary.total_protein_g / totalMacros) * 100 : 0;
        const carbsPct = totalMacros > 0 ? (summary.total_carbs_g / totalMacros) * 100 : 0;
        const fatsPct = totalMacros > 0 ? (summary.total_fats_g / totalMacros) * 100 : 0;
        // Progress bar visualization
        const profile = this.getProfile(telegram_id);
        const goal = profile?.daily_calorie_goal || 2500;
        const progress = Math.min(Math.round((summary.total_calories / goal) * 10), 10);
        const progressBar = '█'.repeat(progress) + '░'.repeat(10 - progress);
        return {
            ...summary,
            proteinPct,
            carbsPct,
            fatsPct,
            progressBar,
            progressPct: Math.round((summary.total_calories / goal) * 100),
            goal,
        };
    }
    async getHistory(telegram_id) {
        return nutrition_repository_1.nutritionRepository.getHistory(telegram_id);
    }
    async exportCSV(telegram_id) {
        const entries = nutrition_repository_1.nutritionRepository.getAllEntries(telegram_id);
        const csvStringifier = (0, csv_writer_1.createObjectCsvStringifier)({
            header: [
                { id: 'entry_date', title: 'Date' },
                { id: 'calories', title: 'Calories' },
                { id: 'protein_g', title: 'Protein (g)' },
                { id: 'carbs_g', title: 'Carbs (g)' },
                { id: 'fats_g', title: 'Fats (g)' },
                { id: 'ai_tip', title: 'AI Tip' },
            ],
        });
        return csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(entries);
    }
    getWeeklyCalories(telegram_id, days = 7) {
        const safeDays = Math.max(1, Math.min(31, Math.floor(days)));
        const dates = [];
        for (let i = 0; i < safeDays; i++) {
            dates.push((0, time_1.formatYmdInUtcOffset)(new Date(Date.now() - i * 86400000)));
        }
        const startDate = dates[dates.length - 1];
        const rows = nutrition_repository_1.nutritionRepository.getDailyCaloriesSince(telegram_id, startDate, safeDays);
        const map = new Map(rows.map((r) => [r.summary_date, Number(r.total_calories)]));
        const resultDays = dates
            .slice()
            .reverse()
            .map((d) => ({ date: d, calories: map.get(d) ?? 0 }));
        const total = resultDays.reduce((sum, d) => sum + d.calories, 0);
        const avg = Math.round(total / resultDays.length);
        return { days: resultDays, total, avg };
    }
}
exports.NutritionService = NutritionService;
exports.nutritionService = new NutritionService();
exports.default = exports.nutritionService;
//# sourceMappingURL=nutrition.service.js.map