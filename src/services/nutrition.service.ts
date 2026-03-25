import { userRepository, UserProfile } from '@/repositories/user.repository';
import { nutritionRepository } from '@/repositories/nutrition.repository';
import { coachRepository } from '@/repositories/coach.repository';
import { aiService } from './ai.service';
import { NutritionData } from '@/models/nutrition';
import { format } from 'date-fns';
import { createObjectCsvStringifier } from 'csv-writer';
import { calculateBmi, weightRangeForBmi } from '@/utils/bmi';
import { formatYmdInUtcOffset } from '@/utils/time';

export class NutritionService {
  public async registerUser(telegram_id: number, username?: string, first_name?: string, last_name?: string): Promise<void> {
    userRepository.upsertUser({ telegram_id, username, first_name, last_name });
  }

  public getProfile(telegram_id: number) {
    return userRepository.getProfile(telegram_id);
  }

  public async setProfile(
    telegram_id: number,
    display_name: string,
    age_years: number,
    sex: 'Male' | 'Female' | 'Other',
    weight_kg: number,
    height_cm: number
  ): Promise<UserProfile> {
    const bmiValue = calculateBmi(weight_kg, height_cm);
    const bmi_status: 'Obese' | 'Acceptable range' = bmiValue > 27 ? 'Obese' : 'Acceptable range';

    let bmiRange: { bmi_low: number; bmi_high: number; rationale: string };
    try {
      bmiRange = await aiService.getHealthyBmiRange({ age_years, sex, height_cm });
    } catch {
      bmiRange = { bmi_low: 18.5, bmi_high: 24.9, rationale: 'Fallback adult range' };
    }

    let dailyCalorieGoal = 2500;
    try {
      const goalData = await aiService.calculateDailyCalorieGoal({ age_years, sex, height_cm, weight_kg });
      dailyCalorieGoal = goalData.goal_calories;
    } catch {
      dailyCalorieGoal = 2500;
    }

    const healthyLow = bmiRange.bmi_low;
    const healthyHigh = bmiRange.bmi_high;
    const target = weightRangeForBmi(height_cm, healthyLow, healthyHigh);

    const profile: UserProfile = {
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
    userRepository.setProfile(profile);
    return profile;
  }

  public removeProfileAndReset(telegram_id: number): void {
    coachRepository.clearState(telegram_id);
    nutritionRepository.deleteAllEntriesForUser(telegram_id);
    nutritionRepository.deleteDailySummariesForUser(telegram_id);
    nutritionRepository.deleteDailyCalorieGoalsForUser(telegram_id);
    userRepository.deleteUser(telegram_id);
  }

  public async processFoodPhoto(telegram_id: number, imageBase64: string, mimeType: string, userDescription?: string, telegram_file_id?: string): Promise<{ data: NutritionData; entry_date: string }> {
    const { data, rawResponse } = await aiService.analyzeFoodImage(imageBase64, mimeType, userDescription);
    const entry_date = formatYmdInUtcOffset(new Date());

    nutritionRepository.addEntry({
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

    nutritionRepository.pruneToLastMeals(telegram_id, 10);

    return { data, entry_date };
  }

  public async processFoodText(telegram_id: number, description: string): Promise<{ data: NutritionData; entry_date: string }> {
    const { data, rawResponse } = await aiService.analyzeFoodText(description);
    const entry_date = formatYmdInUtcOffset(new Date());

    nutritionRepository.addEntry({
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

    nutritionRepository.pruneToLastMeals(telegram_id, 10);

    return { data, entry_date };
  }

  public async getDailyStats(telegram_id: number, date?: string) {
    const summaryDate = date || formatYmdInUtcOffset(new Date());
    const summary = nutritionRepository.getDailySummary(telegram_id, summaryDate);

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

  public async getHistory(telegram_id: number) {
    return nutritionRepository.getHistory(telegram_id);
  }

  public async exportCSV(telegram_id: number): Promise<string> {
    const entries = nutritionRepository.getAllEntries(telegram_id);
    const csvStringifier = createObjectCsvStringifier({
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

  public getWeeklyCalories(telegram_id: number, days: number = 7): { days: Array<{ date: string; calories: number }>; total: number; avg: number } {
    const safeDays = Math.max(1, Math.min(31, Math.floor(days)));
    const dates: string[] = [];
    for (let i = 0; i < safeDays; i++) {
      dates.push(formatYmdInUtcOffset(new Date(Date.now() - i * 86400000)));
    }
    const startDate = dates[dates.length - 1];
    const rows = nutritionRepository.getDailyCaloriesSince(telegram_id, startDate, safeDays);
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

export const nutritionService = new NutritionService();
export default nutritionService;
