import 'module-alias/register';
import { Telegraf, Context, Markup } from 'telegraf';
import { message } from 'telegraf/filters';
import { config } from './config';
import { nutritionService } from './services/nutrition.service';
import { coachService } from './services/coach.service';
import { userRepository } from './repositories/user.repository';
import winston from 'winston';
import axios from 'axios';
import { buildMainMenu, MENU } from './ui/menu';
import express from 'express';
import { formatYmdHmInUtcOffsetFromSqlite } from './utils/time';

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

console.log('Bot is starting up...');
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString();
if (!config.telegram.token) {
  logger.error('Missing required env var: TELEGRAM_BOT_TOKEN');
  process.exit(1);
}

if (!config.gemini.apiKey) {
  logger.warn('Missing env var: GEMINI_API_KEY (photo analysis will fail)');
}

const bot = new Telegraf(config.telegram.token);

const app = express();
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', buildId: BUILD_ID });
});
app.listen(config.server.port, () => {
  logger.info('Health server listening', { port: config.server.port });
});

type ProfileFlow =
  | {
      mode: 'onboarding';
      step: 'name' | 'age' | 'sex' | 'weight' | 'height';
      display_name?: string;
      age_years?: number;
      sex?: 'Male' | 'Female' | 'Other';
      weight_kg?: number;
    }
  | { mode: 'edit'; step: 'weight' | 'height'; display_name: string; weight_kg?: number }
  | { mode: 'goal'; step: 'calories' }
  | { mode: 'text_meal'; step: 'description' };

const profileFlows = new Map<number, ProfileFlow>();
const coachSessions = new Set<number>();

const sendMainMenu = async (ctx: any, text: string) => {
  await ctx.reply(text, buildMainMenu());
};

const parseNumber = (text: string): number | null => {
  const normalized = text.trim().replace(',', '.').replace(/[^0-9.]/g, '');
  if (!normalized) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const weightProgressBar = (currentKg: number, targetKg: number): string => {
  if (currentKg <= 0 || targetKg <= 0) return '░░░░░░░░░░';
  const ratio = Math.min(targetKg / currentKg, 1);
  const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
};

const getErrorMessage = (error: unknown): string => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  const anyErr = error as any;
  if (typeof anyErr?.message === 'string') return anyErr.message;
  return JSON.stringify(anyErr);
};

const getUserFacingAnalysisError = (error: unknown): string => {
  const message = getErrorMessage(error);
  const lower = message.toLowerCase();

  if (lower.includes('api key') || lower.includes('api_key_invalid') || lower.includes('unauthorized') || lower.includes('permission')) {
    return '❌ Gemini API key is invalid or missing. Please set `GEMINI_API_KEY` in Railway Variables and redeploy.';
  }

  if (lower.includes('quota') || lower.includes('429') || lower.includes('rate limit')) {
    return '⚠️ Gemini rate limit/quota reached. Please wait a bit and try again, or enable billing / increase quota for your Gemini API key.';
  }

  if (lower.includes('unable to process input image') || lower.includes('invalid image') || lower.includes('bad request')) {
    return '❌ Gemini could not process that image. Please resend a clear photo (not a screenshot), with good lighting, and try again.';
  }

  if (lower.includes('sqlite') || lower.includes('no such column') || lower.includes('constraint failed')) {
    return '❌ Database error while saving your entry. Please try again; if it persists, the database schema may need migration.';
  }

  return '❌ Failed to analyze the image. Please try again with a clearer food photo.';
};

// Simple in-memory rate limiting
const rateLimits = new Map<number, { count: number; lastReset: number }>();
const RATE_LIMIT_WINDOW = 3600000; // 1 hour
const MAX_PHOTOS_PER_WINDOW = 5;

const checkRateLimit = (userId: number): boolean => {
  const now = Date.now();
  const limit = rateLimits.get(userId) || { count: 0, lastReset: now };

  if (now - limit.lastReset > RATE_LIMIT_WINDOW) {
    limit.count = 1;
    limit.lastReset = now;
  } else {
    limit.count++;
  }

  rateLimits.set(userId, limit);
  return limit.count <= MAX_PHOTOS_PER_WINDOW;
};

// Middleware for logging and error handling
bot.use(async (ctx, next) => {
  const start = Date.now();
  try {
    await next();
    const duration = Date.now() - start;
    logger.info('Processed update', {
      updateType: ctx.updateType,
      userId: ctx.from?.id,
      duration,
    });
  } catch (error) {
    logger.error('Error processing update', { error, userId: ctx.from?.id });
    await ctx.reply('❌ An error occurred while processing your request. Please try again later.');
  }
});

// /start command
const startHandler = async (ctx: any) => {
  const { id, username, first_name, last_name } = ctx.from;
  await nutritionService.registerUser(id, username, first_name, last_name);

  const existingProfile = nutritionService.getProfile(id);
  if (existingProfile) {
    await sendMainMenu(
      ctx,
      `Welcome back, ${existingProfile.display_name}!\n\nTap a button below to continue.`
    );
    return;
  }

  coachSessions.delete(id);
  profileFlows.set(id, { mode: 'onboarding', step: 'name' });
  
  await sendMainMenu(
    ctx,
    `Welcome to AI Nutrition Coach!\n\nTap “${MENU.start}” anytime to restart, or continue onboarding below.`
  );

  await ctx.reply('📝 What name should I call you?');
};

bot.start(startHandler);

// /help command
bot.help((ctx) => {
  ctx.reply(
    `Tap the buttons in the menu to use the bot:\n\n` +
      `- ${MENU.start}\n` +
      `- ${MENU.profile}\n` +
      `- ${MENU.stats}\n` +
      `- ${MENU.coach}\n` +
      `- ${MENU.history}\n` +
      `- ${MENU.log}\n` +
      `- ${MENU.weekly}`,
    buildMainMenu()
  );
});

bot.command('menu', async (ctx) => {
  await sendMainMenu(ctx, 'Main menu:');
});

bot.command('version', async (ctx) => {
  await ctx.reply(
    `✅ Running latest build\nBUILD_ID: ${BUILD_ID}\nMenu: ${MENU.start} | ${MENU.profile} | ${MENU.stats} | ${MENU.coach} | ${MENU.history} | ${MENU.log} | ${MENU.weekly}`,
    buildMainMenu()
  );
});

bot.hears(MENU.start, startHandler);

const logMealHandler = async (ctx: any) => {
  const userId = ctx.from.id;
  coachSessions.delete(userId);
  profileFlows.set(userId, { mode: 'text_meal', step: 'description' });
  await ctx.reply('✍️ Send a meal description (example: "2 eggs and 1 toast"), and I will estimate calories + macros.');
};

bot.hears(MENU.log, logMealHandler);

const profileHandler = async (ctx: any) => {
  const userId = ctx.from.id;
  const profile = nutritionService.getProfile(userId);

  if (!profile) {
    profileFlows.set(userId, { mode: 'onboarding', step: 'name' });
    await sendMainMenu(ctx, 'No profile found yet. Let’s set it up.');
    await ctx.reply('📝 What name should I call you?');
    return;
  }

  const bar = weightProgressBar(profile.weight_kg, profile.target_weight_high_kg);
  const deltaToUpper = profile.weight_kg - profile.target_weight_high_kg;
  const targetText =
    profile.weight_kg > profile.target_weight_high_kg
      ? `Healthy target: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg (need -${deltaToUpper.toFixed(1)} kg to reach upper bound)`
      : `Healthy target: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg`;

  await ctx.reply(
    `👤 Profile\n` +
      `Name: ${profile.display_name}\n` +
      `Age/Sex: ${profile.age_years} / ${profile.sex}\n` +
      `Weight: ${profile.weight_kg.toFixed(1)} kg\n` +
      `Height: ${profile.height_cm.toFixed(1)} cm\n` +
      `BMI: ${profile.bmi.toFixed(1)} (${profile.bmi_status})\n` +
      `Daily Goal: ${profile.daily_calorie_goal} kcal\n` +
      `${bar}\n` +
      `${targetText}`,
    Markup.inlineKeyboard([
      [Markup.button.callback('Edit weight/height', 'profile_edit')],
      [Markup.button.callback('Edit daily goal', 'profile_goal')],
      [Markup.button.callback('Reset', 'profile_reset')],
    ])
  );
};

bot.command('profile', profileHandler);
bot.hears(MENU.profile, profileHandler);

bot.action('profile_edit', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  const profile = nutritionService.getProfile(userId);
  await ctx.answerCbQuery();
  if (!profile) {
    profileFlows.set(userId, { mode: 'onboarding', step: 'name' });
    await ctx.reply('No profile found yet. What name should I call you?');
    return;
  }
  profileFlows.set(userId, { mode: 'edit', step: 'weight', display_name: profile.display_name });
  await ctx.reply('⚖️ Enter your updated weight in kg (20–300):');
});

bot.action('profile_goal', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCbQuery();
  const profile = nutritionService.getProfile(userId);
  if (!profile) {
    profileFlows.set(userId, { mode: 'onboarding', step: 'name' });
    await ctx.reply('No profile found yet. What name should I call you?');
    return;
  }
  profileFlows.set(userId, { mode: 'goal', step: 'calories' });
  await ctx.reply(`🎯 Enter your daily calorie goal in kcal (example: 1900). Current: ${profile.daily_calorie_goal}`);
});

bot.action('profile_reset', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCbQuery();
  await ctx.reply(
    '⚠️ This will delete ALL your data (profile, meal photos history, daily/weekly tracking).\n\nAre you sure?',
    Markup.inlineKeyboard([
      [Markup.button.callback('Yes, reset everything', 'profile_reset_confirm')],
      [Markup.button.callback('Cancel', 'profile_reset_cancel')],
    ])
  );
});

bot.action('profile_reset_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  await sendMainMenu(ctx, 'Cancelled.');
});

bot.action('profile_reset_confirm', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCbQuery();
  profileFlows.delete(userId);
  coachSessions.delete(userId);
  nutritionService.removeProfileAndReset(userId);
  await sendMainMenu(ctx, '✅ Reset complete. Tap Start to set up again.');
});

const coachEnterHandler = async (ctx: any) => {
  coachSessions.add(ctx.from.id);
  await sendMainMenu(ctx, '🧠 Coach mode: ask me anything about nutrition, weight loss, training, or healthy habits.');
  await ctx.reply(
    'Quick questions:',
    Markup.inlineKeyboard([
      [Markup.button.callback('Hydration', 'coach_q_hydration')],
      [Markup.button.callback('Healthy fats', 'coach_q_fats')],
      [Markup.button.callback('Next meal idea', 'coach_q_meal')],
      [Markup.button.callback('Weight loss', 'coach_q_weight')],
    ])
  );
};

bot.command('coach', coachEnterHandler);
bot.hears(MENU.coach, coachEnterHandler);

const runCoachAsk = async (ctx: any, userMessage: string) => {
  const userId = ctx.from.id;
  const thinkingMsg = await ctx.reply('🤔 thinking...');
  try {
    const { reply, hasMore } = await coachService.ask(userId, userMessage);
    const buttons: any[] = [];
    if (hasMore) buttons.push([Markup.button.callback('Tell me more', 'coach_more')]);
    buttons.push([Markup.button.callback('Back to menu', 'coach_exit')]);
    
    await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await ctx.reply(reply, Markup.inlineKeyboard(buttons));
  } catch (error) {
    await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    logger.error('Coach chat failed', { userId, message: getErrorMessage(error) });
    await ctx.reply('❌ Coach is unavailable right now. Please try again in a moment.');
  }
};

const statsHandler = async (ctx: any) => {
  const stats = await nutritionService.getDailyStats(ctx.from.id);

  if (!stats) {
    await ctx.reply('📈 No nutrition entries for today yet. Send a food photo to get started! 📸', buildMainMenu());
    return;
  }

  const messageText = `📈 Today's Totals:
🔥 Total Calories: ${stats.total_calories}
🥩 Total Protein: ${stats.total_protein_g.toFixed(1)}g (${stats.proteinPct.toFixed(0)}%)
🍞 Total Carbs: ${stats.total_carbs_g.toFixed(1)}g (${stats.carbsPct.toFixed(0)}%)
🥑 Total Fats: ${stats.total_fats_g.toFixed(1)}g (${stats.fatsPct.toFixed(0)}%)

${stats.progressBar} ${stats.progressPct}% of daily goal (${stats.goal} kcal)`;

  await ctx.reply(messageText, buildMainMenu());
};

const weeklyHandler = async (ctx: any) => {
  const weekly = nutritionService.getWeeklyCalories(ctx.from.id, 7);
  const lines = weekly.days.map((d) => `${d.date}: ${d.calories} kcal`).join('\n');
  await ctx.reply(
    `📅 Weekly calories (last ${weekly.days.length} days, UTC+8)\n\n${lines}\n\nTotal: ${weekly.total} kcal\nAvg/day: ${weekly.avg} kcal`,
    buildMainMenu()
  );
};

bot.action('coach_more', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCbQuery();
  const next = coachService.next(userId);
  if (!next.chunk) {
    await ctx.reply('No more details available. Ask a follow-up question anytime.', buildMainMenu());
    return;
  }
  const buttons: any[] = [];
  if (next.hasMore) buttons.push([Markup.button.callback('Tell me more', 'coach_more')]);
  buttons.push([Markup.button.callback('Back to menu', 'coach_exit')]);
  await ctx.reply(next.chunk, Markup.inlineKeyboard(buttons));
});

bot.action('coach_exit', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCbQuery();
  coachSessions.delete(userId);
  await sendMainMenu(ctx, 'Main menu:');
});

bot.action('coach_q_hydration', async (ctx) => {
  await ctx.answerCbQuery();
  await runCoachAsk(ctx, 'How much water should I drink today and how can I remember?');
});
bot.action('coach_q_fats', async (ctx) => {
  await ctx.answerCbQuery();
  await runCoachAsk(ctx, 'What are healthy fats and what foods should I choose?');
});
bot.action('coach_q_meal', async (ctx) => {
  await ctx.answerCbQuery();
  await runCoachAsk(ctx, 'Suggest a healthy next meal idea based on my goals.');
});
bot.action('coach_q_weight', async (ctx) => {
  await ctx.answerCbQuery();
  await runCoachAsk(ctx, 'Give me a simple plan for fat loss while keeping energy for training.');
});

bot.on(message('text'), async (ctx) => {
  const userId = ctx.from.id;
  const flow = profileFlows.get(userId);
  const text = ctx.message.text.trim();
  if (text.startsWith('/')) return;

  if (text === MENU.start) {
    profileFlows.delete(userId);
    coachSessions.delete(userId);
    await startHandler(ctx);
    return;
  }
  if (text === MENU.profile) {
    coachSessions.delete(userId);
    await profileHandler(ctx);
    return;
  }
  if (text === MENU.stats) {
    coachSessions.delete(userId);
    await statsHandler(ctx);
    return;
  }
  if (text === MENU.coach) {
    await coachEnterHandler(ctx);
    return;
  }
  if (text === MENU.history) {
    coachSessions.delete(userId);
    await historyHandler(ctx);
    return;
  }
  if (text === MENU.log) {
    await logMealHandler(ctx);
    return;
  }
  if (text === MENU.weekly) {
    coachSessions.delete(userId);
    await weeklyHandler(ctx);
    return;
  }

  if (!flow) {
    if (coachSessions.has(userId)) {
      await runCoachAsk(ctx, text);
    }
    return;
  }

  if (flow.mode === 'text_meal') {
    const description = text.slice(0, 500);
    profileFlows.delete(userId);
    const thinkingMsg = await ctx.reply('🤔 thinking...');
    try {
      const { data } = await nutritionService.processFoodText(userId, description);
      const messageText = `📊 Nutrition (from text):
🍽 Food: ${data.food_name}
🔥 Calories: ${data.calories}
🥩 Protein: ${data.protein_g}g
🍞 Carbs: ${data.carbs_g}g
🥑 Fats: ${data.fats_g}g`;
      await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
      await ctx.reply(messageText, buildMainMenu());
    } catch (error) {
      await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
      await ctx.reply(getUserFacingAnalysisError(error), buildMainMenu());
    }
    return;
  }

  if (flow.mode === 'onboarding') {
    if (flow.step === 'name') {
      const display_name = text.slice(0, 50);
      profileFlows.set(userId, { mode: 'onboarding', step: 'age', display_name });
      await ctx.reply('🎂 Enter your age in years (5–120):');
      return;
    }
    if (flow.step === 'age') {
      const age = parseNumber(text);
      if (age === null || age < 5 || age > 120) {
        await ctx.reply('❌ Invalid age. Enter a number between 5 and 120.');
        return;
      }
      profileFlows.set(userId, { ...flow, step: 'sex', age_years: Math.round(age) });
      await ctx.reply(
        'Select your sex:',
        Markup.inlineKeyboard([
          [Markup.button.callback('Male', 'sex_Male')],
          [Markup.button.callback('Female', 'sex_Female')],
          [Markup.button.callback('Other', 'sex_Other')],
        ])
      );
      return;
    }
    if (flow.step === 'weight') {
      const weight = parseNumber(text);
      if (weight === null || weight < 20 || weight > 300) {
        await ctx.reply('❌ Invalid weight. Enter a number between 20 and 300 (kg).');
        return;
      }
      profileFlows.set(userId, { ...flow, step: 'height', weight_kg: weight });
      await ctx.reply('📏 Enter your height in cm (100–250):');
      return;
    }
    if (flow.step === 'height') {
      const height = parseNumber(text);
      if (height === null || height < 100 || height > 250) {
        await ctx.reply('❌ Invalid height. Enter a number between 100 and 250 (cm).');
        return;
      }
      const display_name = flow.display_name || (ctx.from.first_name ?? 'User');
      const age_years = flow.age_years ?? 0;
      const sex = flow.sex ?? 'Other';
      const weight_kg = flow.weight_kg ?? 0;
      profileFlows.delete(userId);
      
      const thinkingMsg = await ctx.reply('🤔 thinking...');
      
      const profile = await nutritionService.setProfile(userId, display_name, age_years, sex, weight_kg, height);
      const bar = weightProgressBar(profile.weight_kg, profile.target_weight_high_kg);
      const delta = profile.weight_kg - profile.target_weight_high_kg;
      const targetText =
        profile.weight_kg > profile.target_weight_high_kg
          ? `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg (-${delta.toFixed(1)} kg to reach upper bound)`
          : `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg`;
          
      await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
      await ctx.reply(
        `✅ Profile saved\nBMI: ${profile.bmi.toFixed(1)} (${profile.bmi_status})\nDaily Goal: ${profile.daily_calorie_goal} kcal\n${bar}\n${targetText}`,
        buildMainMenu()
      );
      await ctx.reply('Tap Profile anytime to view or edit.');
      return;
    }
  }

  if (flow.mode === 'edit') {
    if (flow.step === 'weight') {
      const weight = parseNumber(text);
      if (weight === null || weight < 20 || weight > 300) {
        await ctx.reply('❌ Invalid weight. Enter a number between 20 and 300 (kg).');
        return;
      }
      profileFlows.set(userId, { ...flow, step: 'height', weight_kg: weight });
      await ctx.reply('📏 Enter your updated height in cm (100–250):');
      return;
    }
    if (flow.step === 'height') {
      const height = parseNumber(text);
      if (height === null || height < 100 || height > 250) {
        await ctx.reply('❌ Invalid height. Enter a number between 100 and 250 (cm).');
        return;
      }
      const weight_kg = flow.weight_kg ?? 0;
      profileFlows.delete(userId);
      const existing = nutritionService.getProfile(userId);
      const age_years = existing?.age_years ?? 30;
      const sex = existing?.sex ?? 'Other';
      
      const thinkingMsg = await ctx.reply('🤔 thinking...');
      
      const profile = await nutritionService.setProfile(userId, flow.display_name, age_years, sex, weight_kg, height);
      const bar = weightProgressBar(profile.weight_kg, profile.target_weight_high_kg);
      const delta = profile.weight_kg - profile.target_weight_high_kg;
      const targetText =
        profile.weight_kg > profile.target_weight_high_kg
          ? `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg (-${delta.toFixed(1)} kg to reach upper bound)`
          : `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg`;
          
      await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
      await ctx.reply(
        `✅ Profile updated\nBMI: ${profile.bmi.toFixed(1)} (${profile.bmi_status})\nDaily Goal: ${profile.daily_calorie_goal} kcal\n${bar}\n${targetText}`,
        buildMainMenu()
      );
      return;
    }
  }

  if (flow.mode === 'goal') {
    if (flow.step === 'calories') {
      const goal = parseNumber(text);
      if (goal === null || goal < 800 || goal > 6000) {
        await ctx.reply('❌ Invalid goal. Enter a number between 800 and 6000 (kcal).');
        return;
      }
      profileFlows.delete(userId);
      const existing = nutritionService.getProfile(userId);
      if (!existing) {
        await sendMainMenu(ctx, 'No profile found. Tap Start to set up.');
        return;
      }
      userRepository.updateDailyCalorieGoal(userId, Math.round(goal));
      await ctx.reply(`✅ Daily goal updated to ${Math.round(goal)} kcal.`, buildMainMenu());
      return;
    }
  }
});

bot.action(/sex_(Male|Female|Other)/, async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  await ctx.answerCbQuery();
  const match = (ctx.callbackQuery as any)?.data?.match(/sex_(Male|Female|Other)/);
  const sex = (match?.[1] as 'Male' | 'Female' | 'Other') || 'Other';
  const flow = profileFlows.get(userId);
  if (!flow || flow.mode !== 'onboarding' || flow.step !== 'sex') return;
  profileFlows.set(userId, { ...flow, sex, step: 'weight' });
  await ctx.reply('⚖️ Enter your current weight in kg (20–300):');
});

// Photo handler
bot.on(message('photo'), async (ctx) => {
  const userId = ctx.from.id;

  if (!checkRateLimit(userId)) {
    return ctx.reply('⚠️ Rate limit exceeded. Please wait an hour before sending more photos (max 5 per hour).');
  }

  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get largest photo
  const userDescription = ctx.message.caption; // Use photo caption as description
  
  // Validate file size (< 10MB)
  if (photo.file_size && photo.file_size > 10 * 1024 * 1024) {
    return ctx.reply('❌ The image is too large. Please send a photo smaller than 10MB.');
  }

  const fileLink = await bot.telegram.getFileLink(photo.file_id);
  
  const thinkingMsg = await ctx.reply('🤔 thinking...');

  try {
    const response = await axios.get(fileLink.toString(), { responseType: 'arraybuffer' });
    const buffer = Buffer.from(response.data, 'binary');
    const base64 = buffer.toString('base64');
    const mimeType = 'image/jpeg'; // Telegram photos are usually jpeg

    const { data } = await nutritionService.processFoodPhoto(userId, base64, mimeType, userDescription, photo.file_id);

    const messageText = `📊 Nutrition Analysis:
🍽 Food: ${data.food_name}
🔥 Calories: ${data.calories}
🥩 Protein: ${data.protein_g}g
🍞 Carbs: ${data.carbs_g}g
🥑 Fats: ${data.fats_g}g`;

    await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    await ctx.reply(messageText, buildMainMenu());
  } catch (error) {
    await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => {});
    const message = getErrorMessage(error);
    logger.error('Photo processing failed', {
      userId,
      message,
      name: (error as any)?.name,
      status: (error as any)?.status,
    });
    await ctx.reply(getUserFacingAnalysisError(error), buildMainMenu());
  }
});

// /stats command
bot.command('stats', statsHandler);
bot.hears(MENU.stats, statsHandler);

bot.command('weekly', weeklyHandler);
bot.hears(MENU.weekly, weeklyHandler);

// /history command
const historyHandler = async (ctx: any) => {
  const history = await nutritionService.getHistory(ctx.from.id);

  if (history.length === 0) {
    return ctx.reply('📅 No history found. Send some food photos first! 📸', buildMainMenu());
  }

  await ctx.reply('📅 Your Recent Meal History:', buildMainMenu());

  for (const entry of history) {
    const timestamp = formatYmdHmInUtcOffsetFromSqlite(entry.created_at);
    const caption = `🍽 ${entry.food_name || 'Unknown'}
⏰ ${timestamp}
🔥 ${entry.calories} kcal
🥩 ${entry.protein_g}P / 🍞 ${entry.carbs_g}C / 🥑 ${entry.fats_g}F`;

    if (entry.telegram_file_id) {
      await ctx.replyWithPhoto(entry.telegram_file_id, { caption });
    } else {
      await ctx.reply(caption);
    }
  }
};
bot.command('history', historyHandler);
bot.hears(MENU.history, historyHandler);

// /export command
bot.command('export', async (ctx) => {
  try {
    const csvContent = await nutritionService.exportCSV(ctx.from.id);
    const buffer = Buffer.from(csvContent, 'utf-8');
    
    await ctx.replyWithDocument({ source: buffer, filename: `nutrition_history_${ctx.from.id}.csv` });
  } catch (error) {
    logger.error('Export failed', { error, userId: ctx.from.id });
    await ctx.reply('❌ Failed to generate CSV export.', buildMainMenu());
  }
});

// Launch bot
bot
  .launch()
  .then(() => {
    console.log('AI Nutrition Coach Bot is running...');
    logger.info('AI Nutrition Coach Bot is running...');
  })
  .catch((error) => {
    const message = getErrorMessage(error);
    console.error('Bot launch failed:', message);
    logger.error('Bot launch failed', { message });
    process.exit(1);
  });

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
