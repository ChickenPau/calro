"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NutritionDataSchema = void 0;
const zod_1 = require("zod");
exports.NutritionDataSchema = zod_1.z.object({
    food_name: zod_1.z.string(),
    calories: zod_1.z.number(),
    protein_g: zod_1.z.number(),
    carbs_g: zod_1.z.number(),
    fats_g: zod_1.z.number(),
    ai_tip: zod_1.z.string(),
    dish_identified: zod_1.z.string().nullish(),
    breakdown_kcal: zod_1.z
        .object({
        rice_carbs: zod_1.z.number().nullish(),
        meat_protein: zod_1.z.number().nullish(),
        sauce_extras: zod_1.z.number().nullish(),
    })
        .nullish(),
    clarification_question: zod_1.z.string().nullish(),
    ingredients: zod_1.z
        .array(zod_1.z.object({
        name: zod_1.z.string(),
        grams: zod_1.z.number().nullish(),
        calories: zod_1.z.number().nullish(),
    }))
        .nullish(),
});
//# sourceMappingURL=nutrition.js.map