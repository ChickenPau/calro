"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = void 0;
const generative_ai_1 = require("@google/generative-ai");
const p_retry_1 = __importDefault(require("p-retry"));
const config_1 = require("@/config");
const nutrition_1 = require("@/models/nutrition");
const zod_1 = require("zod");
const winston_1 = __importDefault(require("winston"));
const logger = winston_1.default.createLogger({
    level: config_1.config.logger.level,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.Console(),
    ],
});
class AIService {
    constructor() {
        this.genAI = new generative_ai_1.GoogleGenerativeAI(config_1.config.gemini.apiKey);
        this.model = this.genAI.getGenerativeModel({ model: config_1.config.gemini.model });
    }
    async analyzeFoodImage(imageBase64, mimeType, userDescription) {
        const instruction = 'You are an expert sports nutritionist. Analyze the food image provided. Estimate the portion size and provide a macro breakdown: Total Calories, Protein (g), Carbohydrates (g), and Fats (g). Output the data in a clean format and include a short, encouraging coaching tip tailored to optimizing power-to-weight ratio and athletic performance.';
        const prompt = `${instruction}
    ${userDescription ? `The user provided the following description: "${userDescription}". Use this information to improve your recognition of the food in the image.` : ''}

    Please respond in the following JSON format ONLY:
    {
      "food_name": "string",
      "calories": number,
      "protein_g": number,
      "carbs_g": number,
      "fats_g": number,
      "ai_tip": "string"
    }`;
        const runAnalysis = async () => {
            const result = await this.model.generateContent([
                prompt,
                {
                    inlineData: {
                        data: imageBase64,
                        mimeType,
                    },
                },
            ]);
            const response = await result.response;
            const text = response.text();
            try {
                // Extract JSON from text if AI includes extra commentary
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No valid JSON found in AI response');
                }
                const jsonData = JSON.parse(jsonMatch[0]);
                if (typeof jsonData.food_name !== 'string' || jsonData.food_name.trim().length === 0) {
                    jsonData.food_name = userDescription && userDescription.trim().length > 0 ? userDescription.trim().slice(0, 80) : 'Unknown';
                }
                const validatedData = nutrition_1.NutritionDataSchema.parse(jsonData);
                return { data: validatedData, rawResponse: text };
            }
            catch (error) {
                logger.error('Failed to parse AI response', { error: error?.message || error, text });
                throw new Error('Invalid AI response format');
            }
        };
        return (0, p_retry_1.default)(runAnalysis, {
            retries: 3,
            onFailedAttempt: (error) => {
                logger.warn(`AI Analysis attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { error: error.message });
            },
        });
    }
    async analyzeFoodText(description) {
        const instruction = 'You are an expert sports nutritionist. Estimate Calories, Protein (g), Carbohydrates (g), and Fats (g) from the user\'s meal description. If portion size is unclear, make a reasonable assumption.';
        const prompt = `${instruction}

Meal description:
"${description}"

Please respond in the following JSON format ONLY:
{
  "food_name": "string",
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fats_g": number,
  "ai_tip": "string"
}`;
        const runAnalysis = async () => {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No valid JSON found in AI response');
                }
                const jsonData = JSON.parse(jsonMatch[0]);
                if (typeof jsonData.food_name !== 'string' || jsonData.food_name.trim().length === 0) {
                    jsonData.food_name = description.trim().slice(0, 80);
                }
                const validatedData = nutrition_1.NutritionDataSchema.parse(jsonData);
                return { data: validatedData, rawResponse: text };
            }
            catch (error) {
                logger.error('Failed to parse AI response (text meal)', { error: error?.message || error, text });
                throw new Error('Invalid AI response format');
            }
        };
        return (0, p_retry_1.default)(runAnalysis, {
            retries: 3,
            onFailedAttempt: (error) => {
                logger.warn(`AI Text Analysis attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { error: error.message });
            },
        });
    }
    async calculateBmi(weightKg, heightCm) {
        const schema = zod_1.z.object({
            bmi: zod_1.z.number(),
            bmi_status: zod_1.z.enum(['Obese', 'Acceptable range']),
            target_weight_kg: zod_1.z.number(),
        });
        const prompt = `Calculate BMI using BMI = weight(kg) / [height(m)]^2.
Weight (kg): ${weightKg}
Height (cm): ${heightCm}

Classification: BMI > 27 = "Obese", BMI <= 27 = "Acceptable range".
Also calculate target_weight_kg that would be BMI = 27.

Return JSON ONLY:
{
  "bmi": number,
  "bmi_status": "Obese" | "Acceptable range",
  "target_weight_kg": number
}`;
        const run = async () => {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('No valid JSON found in BMI response');
            const jsonData = JSON.parse(jsonMatch[0]);
            const validated = schema.parse(jsonData);
            return {
                bmi: Number(validated.bmi),
                bmi_status: validated.bmi_status,
                target_weight_kg: Number(validated.target_weight_kg),
            };
        };
        return (0, p_retry_1.default)(run, {
            retries: 2,
            onFailedAttempt: (error) => {
                logger.warn(`BMI attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { error: error.message });
            },
        });
    }
    async getHealthyBmiRange(input) {
        const schema = zod_1.z.object({
            bmi_low: zod_1.z.number(),
            bmi_high: zod_1.z.number(),
            rationale: zod_1.z.string(),
        });
        const prompt = `You are a careful health assistant.
Return the standard healthy BMI range for a person based on age and sex.

User:
- age_years: ${input.age_years}
- sex: ${input.sex}
- height_cm: ${input.height_cm}

Notes:
- For adults (>=18), use WHO adult healthy BMI range.
- For minors (<18), provide a reasonable BMI range summary appropriate for age/sex (if you cannot provide, fall back to adult range).

Return JSON ONLY:
{
  "bmi_low": number,
  "bmi_high": number,
  "rationale": "short rationale"
}`;
        const run = async () => {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('No valid JSON found in BMI range response');
            const jsonData = JSON.parse(jsonMatch[0]);
            const validated = schema.parse(jsonData);
            return {
                bmi_low: Number(validated.bmi_low),
                bmi_high: Number(validated.bmi_high),
                rationale: validated.rationale,
            };
        };
        return (0, p_retry_1.default)(run, {
            retries: 2,
            onFailedAttempt: (error) => {
                logger.warn(`BMI range attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { error: error.message });
            },
        });
    }
    async calculateDailyCalorieGoal(input) {
        const schema = zod_1.z.object({
            goal_calories: zod_1.z.number(),
            rationale: zod_1.z.string(),
        });
        const prompt = `You are a sports nutrition expert.
Recommend a single daily calorie goal (kcal/day) for a healthy adult based on basic biometrics.

User biometrics:
- age_years: ${input.age_years}
- sex: ${input.sex}
- height_cm: ${input.height_cm}
- weight_kg: ${input.weight_kg}

Assumptions:
- Moderate activity unless indicated.
- Provide a conservative, sustainable recommendation.

Return JSON ONLY:
{
  "goal_calories": number,
  "rationale": "short explanation"
}`;
        const run = async () => {
            const result = await this.model.generateContent(prompt);
            const text = result.response.text();
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('No valid JSON found in calorie goal response');
            const jsonData = JSON.parse(jsonMatch[0]);
            const validated = schema.parse(jsonData);
            return {
                goal_calories: Math.round(Number(validated.goal_calories)),
                rationale: validated.rationale,
            };
        };
        return (0, p_retry_1.default)(run, {
            retries: 2,
            onFailedAttempt: (error) => {
                logger.warn(`Calorie goal attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`, { error: error.message });
            },
        });
    }
    async generateCoachAdvice(input) {
        const prompt = `You are a nutrition coach.
User: ${input.display_name || 'Unknown'}
BMI: ${input.bmi ?? 'unknown'} (${input.bmi_status || 'unknown'})
Current weight (kg): ${input.weight_kg ?? 'unknown'}
Target weight (kg) for acceptable range: ${input.target_weight_kg ?? 'unknown'}

Today (${input.daily.date}):
- Calories: ${input.daily.calories}/${input.daily.goal_calories} (${input.daily.progressPct}%) ${input.daily.progressBar}
- Protein (g): ${input.daily.protein_g}
- Carbs (g): ${input.daily.carbs_g}
- Fats (g): ${input.daily.fats_g}

Recent meals:
${input.recentFoods.map((m) => `- ${m.when}: ${m.food_name} (${m.calories} kcal)`).join('\n')}

Give practical advice for the rest of today. Include hydration reminder, healthy fats examples, and a simple next-meal suggestion. Keep it under 8 lines.`;
        const result = await this.model.generateContent(prompt);
        return result.response.text().trim();
    }
    async coachChat(input) {
        const schema = zod_1.z.object({
            reply: zod_1.z.string(),
            more: zod_1.z.string(),
            memory: zod_1.z.string(),
        });
        const system = 'You are an expert in sports nutrition.';
        const prompt = `${system}

Constraints:
- Evidence-based, practical, supportive.
- Max 900 characters in reply.
- Provide optional extra detail in "more". "more" can be empty.
- "more" must be <= 2500 characters.

User profile:
${JSON.stringify(input.profile || {}, null, 2)}

Conversation memory (compact):
${input.memory || ''}

User message:
${input.userMessage}

Return JSON ONLY:
{
  "reply": "string (<=900 chars)",
  "more": "string (<=2500 chars)",
  "memory": "updated compact memory (<=800 chars)"
}`;
        const result = await this.model.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch)
            throw new Error('No valid JSON found in coach response');
        const jsonData = JSON.parse(jsonMatch[0]);
        const validated = schema.parse(jsonData);
        return {
            reply: validated.reply.slice(0, 900),
            more: validated.more.slice(0, 2500),
            memory: validated.memory.slice(0, 800),
        };
    }
}
exports.AIService = AIService;
exports.aiService = new AIService();
exports.default = exports.aiService;
//# sourceMappingURL=ai.service.js.map