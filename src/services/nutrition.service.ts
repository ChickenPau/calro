import { userRepository, UserProfile } from '@/repositories/user.repository';
import { nutritionRepository } from '@/repositories/nutrition.repository';
import { coachRepository } from '@/repositories/coach.repository';
import { aiService } from './ai.service';
import { NutritionData } from '@/models/nutrition';
import { format } from 'date-fns';
import { createObjectCsvStringifier } from 'csv-writer';
import { calculateBmi, weightRangeForBmi } from '@/utils/bmi';
import { formatYmdInUtcOffset } from '@/utils/time';
import { config } from '@/config';

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

    const fallbackBmiRange = { bmi_low: 18.5, bmi_high: 24.9, rationale: 'Standard adult range' };
    let bmiRange = fallbackBmiRange;
    if (config.gemini.apiKey) {
      try {
        bmiRange = await aiService.getHealthyBmiRange({ age_years, sex, height_cm });
      } catch {
        bmiRange = fallbackBmiRange;
      }
    }

    const sexConst = sex === 'Male' ? 5 : sex === 'Female' ? -161 : -78;
    const bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age_years + sexConst;
    const tdee = bmr * 1.55;
    const fallbackDailyCalorieGoal = Math.max(1200, Math.min(4500, Math.round(tdee * 0.9)));
    let dailyCalorieGoal = fallbackDailyCalorieGoal;
    if (config.gemini.apiKey) {
      try {
        const goalData = await aiService.calculateDailyCalorieGoal({ age_years, sex, height_cm, weight_kg });
        dailyCalorieGoal = goalData.goal_calories;
      } catch {
        dailyCalorieGoal = fallbackDailyCalorieGoal;
      }
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

  public async processFoodPhoto(
    telegram_id: number,
    imageBase64: string,
    mimeType: string,
    userDescription?: string,
    telegram_file_id?: string
  ): Promise<{ data: NutritionData; entry_date: string; entry_id: number }> {
    await this.registerUser(telegram_id);
    const { data, rawResponse } = await aiService.analyzeFoodImage(imageBase64, mimeType, userDescription);
    const entry_date = formatYmdInUtcOffset(new Date());

    const ingredients_json = data.ingredients ? JSON.stringify(data.ingredients) : undefined;

    const entry_id = nutritionRepository.addEntry({
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
      ingredients_json,
      ai_raw_response: rawResponse,
    });

    nutritionRepository.pruneToLastMeals(telegram_id, 10);

    return { data, entry_date, entry_id };
  }

  public async processFoodText(telegram_id: number, description: string): Promise<{ data: NutritionData; entry_date: string; entry_id: number }> {
    await this.registerUser(telegram_id);
    const { data, rawResponse } = await aiService.analyzeFoodText(description);
    const entry_date = formatYmdInUtcOffset(new Date());

    const ingredients_json = data.ingredients ? JSON.stringify(data.ingredients) : undefined;

    const entry_id = nutritionRepository.addEntry({
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
      ingredients_json,
      ai_raw_response: rawResponse,
    });

    nutritionRepository.pruneToLastMeals(telegram_id, 10);

    return { data, entry_date, entry_id };
  }

  public async reanalyzePhotoEntry(
    telegram_id: number,
    entry_id: number,
    imageBase64: string,
    mimeType: string,
    userCorrection: string
  ): Promise<{ data: NutritionData; entry_date: string } | null> {
    const existing = this.getEntryForUser(telegram_id, entry_id);
    if (!existing || !existing.telegram_file_id) return null;

    const combined = `${existing.food_name || ''}\nUser correction: ${userCorrection}`.trim();
    const { data, rawResponse } = await aiService.analyzeFoodImage(imageBase64, mimeType, combined);
    const ingredients_json = data.ingredients ? JSON.stringify(data.ingredients) : undefined;

    const updated = nutritionRepository.updateEntryForUser(telegram_id, entry_id, {
      food_name: data.food_name,
      calories: data.calories,
      protein_g: data.protein_g,
      carbs_g: data.carbs_g,
      fats_g: data.fats_g,
      ai_tip: data.ai_tip,
      ingredients_json,
      ai_raw_response: rawResponse,
    });

    if (!updated) return null;
    return { data, entry_date: updated.entry_date };
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

  public getEntryForUser(telegram_id: number, entryId: number) {
    return nutritionRepository.getActiveEntryForUserById(telegram_id, entryId) ?? null;
  }

  public deleteEntry(telegram_id: number, entryId: number): { deleted: boolean; entry_date?: string; calories?: number; food_name?: string } {
    const deletedEntry = nutritionRepository.softDeleteEntryForUser(telegram_id, entryId);
    if (!deletedEntry) return { deleted: false };
    return {
      deleted: true,
      entry_date: deletedEntry.entry_date,
      calories: deletedEntry.calories,
      food_name: deletedEntry.food_name ?? undefined,
    };
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
