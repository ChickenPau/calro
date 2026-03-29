import { z } from 'zod';

export const NutritionDataSchema = z.object({
  food_name: z.string(),
  calories: z.number(),
  protein_g: z.number(),
  carbs_g: z.number(),
  fats_g: z.number(),
  ai_tip: z.string(),
  dish_identified: z.string().nullish(),
  breakdown_kcal: z
    .object({
      rice_carbs: z.number().nullish(),
      meat_protein: z.number().nullish(),
      sauce_extras: z.number().nullish(),
    })
    .nullish(),
  clarification_question: z.string().nullish(),
});

export type NutritionData = z.infer<typeof NutritionDataSchema>;

export interface NutritionEntry {
  id: number;
  user_id: number;
  telegram_id: number;
  entry_date: string;
  image_url?: string;
  telegram_file_id?: string;
  food_name: string;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  ai_tip: string;
  ai_raw_response: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
}

export interface DailySummary {
  id: number;
  user_id: number;
  summary_date: string;
  total_calories: number;
  total_protein_g: number;
  total_carbs_g: number;
  total_fats_g: number;
  entry_count: number;
  created_at: string;
  updated_at: string;
}
