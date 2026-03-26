import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '@/config';
import { NutritionData, NutritionDataSchema } from '@/models/nutrition';
import { z } from 'zod';
import winston from 'winston';

const logger = winston.createLogger({
  level: config.logger.level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toErrorMeta = (error: unknown) => {
  const anyErr = error as any;
  return {
    name: anyErr?.name,
    code: anyErr?.code,
    status: anyErr?.status ?? anyErr?.response?.status,
    message: anyErr?.message || String(error),
  };
};

const retry = async <T>(
  run: () => Promise<T>,
  options: {
    retries: number;
    minTimeoutMs?: number;
    factor?: number;
    onFailedAttempt?: (info: { attemptNumber: number; retriesLeft: number; error: unknown }) => void;
  }
): Promise<T> => {
  const retries = Math.max(0, Math.floor(options.retries));
  const minTimeoutMs = Math.max(0, Math.floor(options.minTimeoutMs ?? 250));
  const factor = Math.max(1, options.factor ?? 2);

  let attemptNumber = 1;
  while (true) {
    try {
      return await run();
    } catch (error) {
      const retriesLeft = retries - (attemptNumber - 1);
      if (retriesLeft <= 0) throw error;
      options.onFailedAttempt?.({ attemptNumber, retriesLeft, error });
      const backoffMs = Math.round(minTimeoutMs * Math.pow(factor, attemptNumber - 1));
      await delay(backoffMs);
      attemptNumber++;
    }
  }
};

export class AIService {
  private genAI: GoogleGenerativeAI | null;
  private textModel: any | null;
  private imageModel: any | null;
  private textModelName: string | null;
  private imageModelName: string | null;

  constructor() {
    if (!config.gemini.apiKey) {
      this.genAI = null;
      this.textModel = null;
      this.imageModel = null;
      this.textModelName = null;
      this.imageModelName = null;
      return;
    }

    this.genAI = new GoogleGenerativeAI(config.gemini.apiKey);
    this.textModelName = config.gemini.textModel;
    this.imageModelName = config.gemini.imageModel;
    this.textModel = this.genAI.getGenerativeModel({ model: this.textModelName });
    this.imageModel = this.genAI.getGenerativeModel({ model: this.imageModelName });
  }

  private ensureModels() {
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

  private isModelNotSupportedError(error: unknown): boolean {
    const anyErr = error as any;
    const status = anyErr?.status ?? anyErr?.response?.status;
    const message = String(anyErr?.message || '').toLowerCase();
    return status === 404 || message.includes('not found') || message.includes('not supported for generatecontent');
  }

  private async generateContent(kind: 'text' | 'image', input: any): Promise<any> {
    const { genAI, textModel, imageModel, textModelName, imageModelName } = this.ensureModels();

    const activeModel = kind === 'image' ? imageModel : textModel;
    const activeModelName = kind === 'image' ? imageModelName : textModelName;

    try {
      return await activeModel.generateContent(input);
    } catch (error) {
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
        } else {
          this.textModelName = fallbackModel;
          this.textModel = nextModel;
        }

        return await nextModel.generateContent(input);
      }
      throw error;
    }
  }

  public async analyzeFoodImage(imageBase64: string, mimeType: string, userDescription?: string): Promise<{ data: NutritionData; rawResponse: string }> {
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
      const result = await this.generateContent('image', [
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
        const validatedData = NutritionDataSchema.parse(jsonData);
        return { data: validatedData, rawResponse: text };
      } catch (error) {
        logger.error('Failed to parse AI response', { error: (error as any)?.message || error, text });
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

  public async analyzeFoodText(description: string): Promise<{ data: NutritionData; rawResponse: string }> {
    const instruction =
      'You are an expert sports nutritionist. Estimate Calories, Protein (g), Carbohydrates (g), and Fats (g) from the user\'s meal description. If portion size is unclear, make a reasonable assumption.';
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
      const result = await this.generateContent('text', prompt);
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
        const validatedData = NutritionDataSchema.parse(jsonData);
        return { data: validatedData, rawResponse: text };
      } catch (error) {
        logger.error('Failed to parse AI response (text meal)', { error: (error as any)?.message || error, text });
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

  public async calculateBmi(weightKg: number, heightCm: number): Promise<{ bmi: number; bmi_status: 'Obese' | 'Acceptable range'; target_weight_kg: number }> {
    const schema = z.object({
      bmi: z.number(),
      bmi_status: z.enum(['Obese', 'Acceptable range']),
      target_weight_kg: z.number(),
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
      if (!jsonMatch) throw new Error('No valid JSON found in BMI response');
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

  public async getHealthyBmiRange(input: {
    age_years: number;
    sex: 'Male' | 'Female' | 'Other';
    height_cm: number;
  }): Promise<{ bmi_low: number; bmi_high: number; rationale: string }> {
    const schema = z.object({
      bmi_low: z.number(),
      bmi_high: z.number(),
      rationale: z.string(),
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
      if (!jsonMatch) throw new Error('No valid JSON found in BMI range response');
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

  public async calculateDailyCalorieGoal(input: {
    age_years: number;
    sex: 'Male' | 'Female' | 'Other';
    height_cm: number;
    weight_kg: number;
  }): Promise<{ goal_calories: number; rationale: string }> {
    const schema = z.object({
      goal_calories: z.number(),
      rationale: z.string(),
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
      if (!jsonMatch) throw new Error('No valid JSON found in calorie goal response');
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

  public async generateCoachAdvice(input: {
    display_name?: string;
    bmi?: number;
    bmi_status?: string;
    weight_kg?: number;
    target_weight_kg?: number;
    daily: {
      date: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fats_g: number;
      goal_calories: number;
      progressBar: string;
      progressPct: number;
    };
    recentFoods: Array<{ when: string; food_name: string; calories: number }>;
  }): Promise<string> {
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

  public async coachChat(input: {
    userMessage: string;
    memory: string;
    profile?: {
      display_name?: string;
      age_years?: number;
      sex?: string;
      bmi?: number;
      bmi_status?: string;
      weight_kg?: number;
      target_weight_low_kg?: number;
      target_weight_high_kg?: number;
    };
  }): Promise<{ reply: string; more: string; memory: string }> {
    const schema = z.object({
      reply: z.string(),
      more: z.string(),
      memory: z.string(),
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
    } catch (error) {
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

export const aiService = new AIService();
export default aiService;
