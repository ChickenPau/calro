"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiService = exports.AIService = void 0;
const generative_ai_1 = require("@google/generative-ai");
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
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const toErrorMeta = (error) => {
    const anyErr = error;
    return {
        name: anyErr?.name,
        code: anyErr?.code,
        status: anyErr?.status ?? anyErr?.response?.status,
        message: anyErr?.message || String(error),
    };
};
const normalizeModelName = (value) => {
    let v = String(value || '').trim();
    if (!v)
        return v;
    v = v.replace(/^models\//i, '');
    const colonIndex = v.indexOf(':');
    if (colonIndex >= 0)
        v = v.slice(0, colonIndex);
    v = v.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    v = v.replace(/[_\s]+/g, '-').toLowerCase();
    v = v.replace(/[^a-z0-9.\-]/g, '-');
    v = v.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    return v;
};
const retry = async (run, options) => {
    const retries = Math.max(0, Math.floor(options.retries));
    const minTimeoutMs = Math.max(0, Math.floor(options.minTimeoutMs ?? 250));
    const factor = Math.max(1, options.factor ?? 2);
    let attemptNumber = 1;
    while (true) {
        try {
            return await run();
        }
        catch (error) {
            const retriesLeft = retries - (attemptNumber - 1);
            if (retriesLeft <= 0)
                throw error;
            options.onFailedAttempt?.({ attemptNumber, retriesLeft, error });
            const backoffMs = Math.round(minTimeoutMs * Math.pow(factor, attemptNumber - 1));
            await delay(backoffMs);
            attemptNumber++;
        }
    }
};
class AIService {
    constructor() {
        if (!config_1.config.gemini.apiKey) {
            this.genAI = null;
            this.textModel = null;
            this.imageModel = null;
            this.textModelName = null;
            this.imageModelName = null;
            return;
        }
        this.genAI = new generative_ai_1.GoogleGenerativeAI(config_1.config.gemini.apiKey);
        this.textModelName = normalizeModelName(config_1.config.gemini.textModel);
        this.imageModelName = normalizeModelName(config_1.config.gemini.imageModel);
        this.textModel = this.genAI.getGenerativeModel({ model: this.textModelName });
        this.imageModel = this.genAI.getGenerativeModel({ model: this.imageModelName });
    }
    ensureModels() {
        if (!this.genAI || !this.textModel || !this.imageModel || !this.textModelName || !this.imageModelName) {
            throw new Error('GEMINI_API_KEY is missing or invalid');
        }
        return {
            genAI: this.genAI,
            textModel: this.textModel,
            imageModel: this.imageModel,
            textModelName: this.textModelName,
            imageModelName: this.imageModelName,
        };
    }
    isModelNotSupportedError(error) {
        const anyErr = error;
        const status = anyErr?.status ?? anyErr?.response?.status;
        const message = String(anyErr?.message || '').toLowerCase();
        return (status === 404 ||
            (status === 400 && message.includes('unexpected model name format')) ||
            message.includes('not found') ||
            message.includes('not supported for generatecontent'));
    }
    async generateContent(kind, input) {
        const { genAI, textModel, imageModel, textModelName, imageModelName } = this.ensureModels();
        const activeModel = kind === 'image' ? imageModel : textModel;
        const activeModelName = kind === 'image' ? imageModelName : textModelName;
        try {
            return await activeModel.generateContent(input);
        }
        catch (error) {
            const fallbackModel = 'gemini-1.5-flash';
            if (this.isModelNotSupportedError(error) && activeModelName !== fallbackModel) {
                logger.warn('Gemini model not supported; falling back', {
                    kind,
                    requestedModel: activeModelName,
                    fallbackModel,
                    error: toErrorMeta(error),
                });
                const nextModel = genAI.getGenerativeModel({ model: fallbackModel });
                if (kind === 'image') {
                    this.imageModelName = fallbackModel;
                    this.imageModel = nextModel;
                }
                else {
                    this.textModelName = fallbackModel;
                    this.textModel = nextModel;
                }
                return await nextModel.generateContent(input);
            }
            throw error;
        }
    }
    async analyzeFoodImage(imageBase64, mimeType, userDescription) {
        const instruction = 'You are a specialized Singaporean Nutritionist AI. Your task is to analyze images of food (primarily Singaporean hawker food, but also Western, Indian, Chinese, and other cuisines) and provide an accurate calorie estimate.';
        const rules = `CRITICAL RULES:
1) Identify the Dish: First identify if the dish is a standard hawker meal (e.g., Roasted Duck Rice, Char Siew Rice) or other cuisines.
2) Reference Standards: Use Singapore Health Promotion Board (HPB) style baselines where possible (e.g., standard Duck Rice ~700 kcal) and adjust from there.
3) Visual Scaling: Use the size of the spoon, chopsticks, bowl/plate rim to estimate portion size.
4) Portion Sanity: If it looks like a standard single-person portion, DO NOT exceed 900 kcal unless it is clearly a massive sharing platter.
5) If blurry/unclear: ask a short clarification question.`;
        const prompt = `${instruction}

${rules}

${userDescription ? `User description: "${userDescription}"` : ''}

Think step-by-step privately. Do not include your internal reasoning in the output.

Return JSON ONLY in this schema:
{
  "dish_identified": "string",
  "food_name": "string",
  "breakdown_kcal": {
    "rice_carbs": number,
    "meat_protein": number,
    "sauce_extras": number
  },
  "ingredients": [
    {
      "name": "string",
      "grams": number,
      "calories": number
    }
  ],
  "calories": number,
  "protein_g": number,
  "carbs_g": number,
  "fats_g": number,
  "ai_tip": "string",
  "clarification_question": "string"
}`;
        const runAnalysis = async () => {
            const result = await this.generateContent('image', {
                contents: [
                    {
                        role: 'user',
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    data: imageBase64,
                                    mimeType,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                },
            });
            const response = await result.response;
            const text = response.text();
            try {
                // Extract JSON from text if AI includes extra commentary
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No valid JSON found in AI response');
                }
                const jsonData = JSON.parse(jsonMatch[0]);
                if (jsonData && typeof jsonData === 'object') {
                    if (jsonData.clarification_question === null)
                        delete jsonData.clarification_question;
                    if (jsonData.dish_identified === null)
                        delete jsonData.dish_identified;
                    if (jsonData.breakdown_kcal === null)
                        delete jsonData.breakdown_kcal;
                    if (jsonData.ingredients === null)
                        delete jsonData.ingredients;
                    if (jsonData.breakdown_kcal && typeof jsonData.breakdown_kcal === 'object') {
                        if (jsonData.breakdown_kcal.rice_carbs === null)
                            delete jsonData.breakdown_kcal.rice_carbs;
                        if (jsonData.breakdown_kcal.meat_protein === null)
                            delete jsonData.breakdown_kcal.meat_protein;
                        if (jsonData.breakdown_kcal.sauce_extras === null)
                            delete jsonData.breakdown_kcal.sauce_extras;
                    }
                    if (Array.isArray(jsonData.ingredients)) {
                        jsonData.ingredients = jsonData.ingredients
                            .filter((i) => i && typeof i === 'object')
                            .map((i) => {
                            if (i.grams === null)
                                delete i.grams;
                            if (i.calories === null)
                                delete i.calories;
                            return i;
                        });
                    }
                }
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
        return retry(runAnalysis, {
            retries: 3,
            onFailedAttempt: ({ attemptNumber, retriesLeft, error }) => {
                logger.warn(`AI Analysis attempt ${attemptNumber} failed. ${retriesLeft} retries left.`, { error: toErrorMeta(error) });
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
  "ingredients": [
    {
      "name": "string",
      "grams": number,
      "calories": number
    }
  ],
  "ai_tip": "string"
}`;
        const runAnalysis = async () => {
            const result = await this.generateContent('text', {
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: 'application/json',
                },
            });
            const text = result.response.text();
            try {
                const jsonMatch = text.match(/\{[\s\S]*\}/);
                if (!jsonMatch) {
                    throw new Error('No valid JSON found in AI response');
                }
                const jsonData = JSON.parse(jsonMatch[0]);
                if (jsonData && typeof jsonData === 'object') {
                    if (jsonData.ingredients === null)
                        delete jsonData.ingredients;
                    if (Array.isArray(jsonData.ingredients)) {
                        jsonData.ingredients = jsonData.ingredients
                            .filter((i) => i && typeof i === 'object')
                            .map((i) => {
                            if (i.grams === null)
                                delete i.grams;
                            if (i.calories === null)
                                delete i.calories;
                            return i;
                        });
                    }
                }
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
        return retry(runAnalysis, {
            retries: 3,
            onFailedAttempt: ({ attemptNumber, retriesLeft, error }) => {
                logger.warn(`AI Text Analysis attempt ${attemptNumber} failed. ${retriesLeft} retries left.`, { error: toErrorMeta(error) });
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
            const result = await this.generateContent('text', prompt);
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
        return retry(run, {
            retries: 2,
            onFailedAttempt: ({ attemptNumber, retriesLeft, error }) => {
                logger.warn(`BMI attempt ${attemptNumber} failed. ${retriesLeft} retries left.`, { error: toErrorMeta(error) });
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
            const result = await this.generateContent('text', prompt);
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
        return retry(run, {
            retries: 2,
            onFailedAttempt: ({ attemptNumber, retriesLeft, error }) => {
                logger.warn(`BMI range attempt ${attemptNumber} failed. ${retriesLeft} retries left.`, { error: toErrorMeta(error) });
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
            const result = await this.generateContent('text', prompt);
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
        return retry(run, {
            retries: 2,
            onFailedAttempt: ({ attemptNumber, retriesLeft, error }) => {
                logger.warn(`Calorie goal attempt ${attemptNumber} failed. ${retriesLeft} retries left.`, { error: toErrorMeta(error) });
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
        const result = await this.generateContent('text', prompt);
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
        const result = await this.generateContent('text', {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: 'application/json',
            },
        });
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            logger.warn('Coach response was not valid JSON; using plain-text fallback', {
                preview: text.slice(0, 600),
            });
            return {
                reply: text.trim().slice(0, 900) || 'Sorry — I could not generate a valid response. Please try again.',
                more: '',
                memory: (input.memory || '').slice(0, 800),
            };
        }
        try {
            const jsonData = JSON.parse(jsonMatch[0]);
            const validated = schema.parse(jsonData);
            return {
                reply: validated.reply.slice(0, 900),
                more: validated.more.slice(0, 2500),
                memory: validated.memory.slice(0, 800),
            };
        }
        catch (error) {
            logger.warn('Coach JSON parse/validation failed; using plain-text fallback', {
                error: toErrorMeta(error),
                preview: text.slice(0, 600),
            });
            return {
                reply: text.trim().slice(0, 900) || 'Sorry — I could not generate a valid response. Please try again.',
                more: '',
                memory: (input.memory || '').slice(0, 800),
            };
        }
    }
}
exports.AIService = AIService;
exports.aiService = new AIService();
exports.default = exports.aiService;
//# sourceMappingURL=ai.service.js.map