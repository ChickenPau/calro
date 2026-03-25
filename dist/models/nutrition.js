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
});
//# sourceMappingURL=nutrition.js.map