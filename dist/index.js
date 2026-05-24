"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("module-alias/register");
const telegraf_1 = require("telegraf");
const filters_1 = require("telegraf/filters");
const config_1 = require("./config");
const nutrition_service_1 = require("./services/nutrition.service");
const coach_service_1 = require("./services/coach.service");
const user_repository_1 = require("./repositories/user.repository");
const nutrition_repository_1 = require("./repositories/nutrition.repository");
const coach_repository_1 = require("./repositories/coach.repository");
const winston_1 = __importDefault(require("winston"));
const axios_1 = __importDefault(require("axios"));
const menu_1 = require("./ui/menu");
const express_1 = __importDefault(require("express"));
const time_1 = require("./utils/time");
const logger = winston_1.default.createLogger({
    level: config_1.config.logger.level,
    format: winston_1.default.format.combine(winston_1.default.format.timestamp(), winston_1.default.format.json()),
    transports: [
        new winston_1.default.transports.Console(),
    ],
});
console.log('Bot is starting up...');
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString();
if (!config_1.config.telegram.token) {
    logger.error('Missing required env var: TELEGRAM_BOT_TOKEN');
    process.exit(1);
}
if (!config_1.config.gemini.apiKey) {
    logger.warn('Missing env var: GEMINI_API_KEY (photo analysis will fail)');
}
const bot = new telegraf_1.Telegraf(config_1.config.telegram.token);
const app = (0, express_1.default)();
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', buildId: BUILD_ID });
});
app.listen(config_1.config.server.port, () => {
    logger.info('Health server listening', { port: config_1.config.server.port });
});
const profileFlows = new Map();
const coachSessions = new Set();
const COACH_MENU = {
    hydration: '💧 Hydration',
    fats: '🥑 Healthy fats',
    meal: '🍽 Next meal idea',
    weight: '⚖️ Weight loss',
    back: '⬅️ Back to menu',
};
const sendMainMenu = async (ctx, text) => {
    await ctx.reply(text, (0, menu_1.buildMainMenu)());
};
const getQuickHowTo = () => {
    return (`How to use Calro:\n` +
        `- 📸 Send a food photo anytime to log calories + macros\n` +
        `- ${menu_1.MENU.log}: type what you ate (no photo needed)\n` +
        `- ${menu_1.MENU.stats}: see today’s totals\n` +
        `- ${menu_1.MENU.history}: review meals and tap 🗑 Delete if needed\n` +
        `- ${menu_1.MENU.coach}: ask questions (buttons or type freely)\n` +
        `- ${menu_1.MENU.weekly}: see weekly calories\n` +
        `- ${menu_1.MENU.export}: download your CSV (also works with /export)`);
};
const buildCoachMenu = () => {
    return telegraf_1.Markup.keyboard([
        [COACH_MENU.hydration, COACH_MENU.fats],
        [COACH_MENU.meal, COACH_MENU.weight],
        [COACH_MENU.back],
    ])
        .resize()
        .oneTime(false);
};
const parseNumber = (text) => {
    const normalized = text.trim().replace(',', '.').replace(/[^0-9.]/g, '');
    if (!normalized)
        return null;
    const n = Number(normalized);
    return Number.isFinite(n) ? n : null;
};
const weightProgressBar = (currentKg, targetKg) => {
    if (currentKg <= 0 || targetKg <= 0)
        return '░░░░░░░░░░';
    const ratio = Math.min(targetKg / currentKg, 1);
    const filled = Math.max(0, Math.min(10, Math.round(ratio * 10)));
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
};
const getErrorMessage = (error) => {
    if (!error)
        return '';
    if (typeof error === 'string')
        return error;
    if (error instanceof Error)
        return error.message;
    const anyErr = error;
    if (typeof anyErr?.message === 'string')
        return anyErr.message;
    return JSON.stringify(anyErr);
};
const escapeMarkdown = (s) => {
    return s.replace(/([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g, '\\$1');
};
const formatKcal = (n) => {
    const x = typeof n === 'number' ? n : Number(n);
    return Number.isFinite(x) ? `${Math.round(x)}` : '—';
};
const buildFoodAnalysisMessage = (data) => {
    const dish = escapeMarkdown(String(data?.dish_identified || data?.food_name || 'Unknown'));
    const riceVal = data?.breakdown_kcal?.rice_carbs;
    const meatVal = data?.breakdown_kcal?.meat_protein;
    const sauceVal = data?.breakdown_kcal?.sauce_extras;
    const rice = formatKcal(riceVal);
    const meat = formatKcal(meatVal);
    const sauce = formatKcal(sauceVal);
    const hasBreakdown = [riceVal, meatVal, sauceVal].some((v) => typeof v === 'number' && Number.isFinite(v));
    const total = formatKcal(data?.calories);
    const protein = typeof data?.protein_g === 'number' ? data.protein_g : Number(data?.protein_g);
    const carbs = typeof data?.carbs_g === 'number' ? data.carbs_g : Number(data?.carbs_g);
    const fats = typeof data?.fats_g === 'number' ? data.fats_g : Number(data?.fats_g);
    const macros = Number.isFinite(protein) && Number.isFinite(carbs) && Number.isFinite(fats)
        ? `\n\n🥩 Protein: ${escapeMarkdown(protein.toFixed(0))}g\n🍞 Carbs: ${escapeMarkdown(carbs.toFixed(0))}g\n🥑 Fats: ${escapeMarkdown(fats.toFixed(0))}g`
        : '';
    const ingredients = Array.isArray(data?.ingredients) ? data.ingredients : [];
    const ingredientsLines = ingredients
        .slice(0, 8)
        .map((i) => {
        const name = escapeMarkdown(String(i?.name || 'Unknown'));
        const grams = typeof i?.grams === 'number' ? `${Math.round(i.grams)}g` : '—g';
        const kcal = typeof i?.calories === 'number' ? `${Math.round(i.calories)} kcal` : '— kcal';
        return `• ${name}: ${escapeMarkdown(grams)} · ${escapeMarkdown(kcal)}`;
    })
        .join('\n');
    const ingredientsBlock = ingredientsLines ? `\n\n🧾 Ingredients:\n${ingredientsLines}` : '';
    const tipRaw = typeof data?.ai_tip === 'string' ? data.ai_tip.trim() : '';
    const tip = tipRaw ? `\n\n💡 Tip: ${escapeMarkdown(tipRaw)}` : '';
    const questionRaw = typeof data?.clarification_question === 'string' ? data.clarification_question.trim() : '';
    const question = questionRaw ? `\n\n❓ ${escapeMarkdown(questionRaw)}` : '';
    const breakdownBlock = hasBreakdown
        ? `\n\n📊 Breakdown:\n` +
            `• Rice/Carbs: ${escapeMarkdown(rice)} kcal\n` +
            `• Meat/Protein: ${escapeMarkdown(meat)} kcal\n` +
            `• Sauce/Extras: ${escapeMarkdown(sauce)} kcal`
        : '';
    const text = `🍽️ Dish Identified: *${dish}*\n\n` +
        `🔥 Total Calories: *${escapeMarkdown(total)}* kcal` +
        macros +
        breakdownBlock +
        ingredientsBlock +
        tip +
        question;
    return { text, parse_mode: 'MarkdownV2' };
};
const getUserFacingAnalysisError = (error) => {
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
        if (lower.includes('foreign key')) {
            return '❌ Database error while saving your entry. Please tap 🚀 Start once, then try again.';
        }
        return '❌ Database error while saving your entry. Please try again; if it persists, the database schema may need migration.';
    }
    return '❌ Failed to analyze the image. Please try again with a clearer food photo.';
};
// Daily prompt limit covers photo logs, text meal logs, and Coach messages
// (DB-backed, resets each calendar day in Singapore time / UTC+8)
const MAX_PROMPTS_PER_DAY = 5;
const getPromptCountToday = (telegramId) => {
    const today = (0, time_1.formatYmdInUtcOffset)(new Date());
    const meals = nutrition_repository_1.nutritionRepository.getPromptCountToday(telegramId, today);
    const coach = coach_repository_1.coachRepository.getCoachInputCountToday(telegramId, today);
    return meals + coach;
};
const checkDailyPromptLimit = (telegramId) => {
    return getPromptCountToday(telegramId) < MAX_PROMPTS_PER_DAY;
};
const getPromptsRemaining = (telegramId) => {
    return Math.max(0, MAX_PROMPTS_PER_DAY - getPromptCountToday(telegramId));
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
    }
    catch (error) {
        logger.error('Error processing update', { error, userId: ctx.from?.id });
        await ctx.reply('❌ An error occurred while processing your request. Please try again later.');
    }
});
// /start command
const startHandler = async (ctx) => {
    const { id, username, first_name, last_name } = ctx.from;
    await nutrition_service_1.nutritionService.registerUser(id, username, first_name, last_name);
    const remaining = getPromptsRemaining(id);
    const remainingLine = `📊 ${remaining} prompt${remaining === 1 ? '' : 's'} remaining today (shared across photos, text meals, and Coach).`;
    await ctx.reply(`${getQuickHowTo()}\n\n${remainingLine}`, (0, menu_1.buildMainMenu)());
    const existingProfile = nutrition_service_1.nutritionService.getProfile(id);
    if (existingProfile) {
        await sendMainMenu(ctx, `Welcome back, ${existingProfile.display_name}!\n\nTap a button below to continue.`);
        return;
    }
    coachSessions.delete(id);
    profileFlows.set(id, { mode: 'onboarding', step: 'name' });
    await sendMainMenu(ctx, `Welcome to AI Nutrition Coach!\n\nTap “${menu_1.MENU.start}” anytime to restart, or continue onboarding below.`);
    await ctx.reply('📝 What name should I call you?');
};
bot.start(startHandler);
// /help command
bot.help((ctx) => {
    ctx.reply(`Tap the buttons in the menu to use the bot:\n\n` +
        `- ${menu_1.MENU.start}\n` +
        `- ${menu_1.MENU.profile}\n` +
        `- ${menu_1.MENU.stats}\n` +
        `- ${menu_1.MENU.coach}\n` +
        `- ${menu_1.MENU.history}\n` +
        `- ${menu_1.MENU.log}\n` +
        `- ${menu_1.MENU.export}\n` +
        `- ${menu_1.MENU.weekly}\n\n` +
        `Extra:\n` +
        `- /export (download CSV)\n` +
        `- Delete meals from History using 🗑 Delete`, (0, menu_1.buildMainMenu)());
});
bot.command('menu', async (ctx) => {
    await sendMainMenu(ctx, 'Main menu:');
});
bot.hears(menu_1.MENU.export, async (ctx) => {
    try {
        const csvContent = await nutrition_service_1.nutritionService.exportCSV(ctx.from.id);
        const buffer = Buffer.from(csvContent, 'utf-8');
        await ctx.replyWithDocument({ source: buffer, filename: `nutrition_history_${ctx.from.id}.csv` });
    }
    catch (error) {
        logger.error('Export failed', { error, userId: ctx.from.id });
        await ctx.reply('❌ Failed to generate CSV export.', (0, menu_1.buildMainMenu)());
    }
});
bot.command('version', async (ctx) => {
    await ctx.reply(`✅ Running latest build\nBUILD_ID: ${BUILD_ID}\nMenu: ${menu_1.MENU.start} | ${menu_1.MENU.profile} | ${menu_1.MENU.stats} | ${menu_1.MENU.coach} | ${menu_1.MENU.history} | ${menu_1.MENU.log} | ${menu_1.MENU.weekly}`, (0, menu_1.buildMainMenu)());
});
bot.hears(menu_1.MENU.start, startHandler);
const logMealHandler = async (ctx) => {
    const userId = ctx.from.id;
    coachSessions.delete(userId);
    profileFlows.set(userId, { mode: 'text_meal', step: 'description' });
    await ctx.reply('✍️ Send a meal description (example: "2 eggs and 1 toast"), and I will estimate calories + macros.');
};
bot.hears(menu_1.MENU.log, logMealHandler);
const profileHandler = async (ctx) => {
    const userId = ctx.from.id;
    const profile = nutrition_service_1.nutritionService.getProfile(userId);
    if (!profile) {
        profileFlows.set(userId, { mode: 'onboarding', step: 'name' });
        await sendMainMenu(ctx, 'No profile found yet. Let’s set it up.');
        await ctx.reply('📝 What name should I call you?');
        return;
    }
    const bar = weightProgressBar(profile.weight_kg, profile.target_weight_high_kg);
    const deltaToUpper = profile.weight_kg - profile.target_weight_high_kg;
    const targetText = profile.weight_kg > profile.target_weight_high_kg
        ? `Healthy target: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg (need -${deltaToUpper.toFixed(1)} kg to reach upper bound)`
        : `Healthy target: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg`;
    await ctx.reply(`👤 Profile\n` +
        `Name: ${profile.display_name}\n` +
        `Age/Sex: ${profile.age_years} / ${profile.sex}\n` +
        `Weight: ${profile.weight_kg.toFixed(1)} kg\n` +
        `Height: ${profile.height_cm.toFixed(1)} cm\n` +
        `BMI: ${profile.bmi.toFixed(1)} (${profile.bmi_status})\n` +
        `Daily Goal: ${profile.daily_calorie_goal} kcal\n` +
        `${bar}\n` +
        `${targetText}`, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Edit weight/height', 'profile_edit')],
        [telegraf_1.Markup.button.callback('Edit daily goal', 'profile_goal')],
        [telegraf_1.Markup.button.callback('Reset', 'profile_reset')],
    ]));
};
bot.command('profile', profileHandler);
bot.hears(menu_1.MENU.profile, profileHandler);
bot.action('profile_edit', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    const profile = nutrition_service_1.nutritionService.getProfile(userId);
    await ctx.answerCbQuery();
    if (!profile) {
        profileFlows.set(userId, { mode: 'onboarding', step: 'name' });
        await ctx.reply('No profile found yet. What name should I call you?');
        return;
    }
    profileFlows.set(userId, { mode: 'edit', step: 'weight', display_name: profile.display_name });
    await ctx.reply('Enter your weight in kg');
});
bot.action('profile_goal', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    const profile = nutrition_service_1.nutritionService.getProfile(userId);
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
    if (!userId)
        return;
    await ctx.answerCbQuery();
    await ctx.reply('⚠️ This will delete ALL your data (profile, meal photos history, daily/weekly tracking).\n\nAre you sure?', telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Yes, reset everything', 'profile_reset_confirm')],
        [telegraf_1.Markup.button.callback('Cancel', 'profile_reset_cancel')],
    ]));
});
bot.action('profile_reset_cancel', async (ctx) => {
    await ctx.answerCbQuery();
    await sendMainMenu(ctx, 'Cancelled.');
});
bot.action('profile_reset_confirm', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    profileFlows.delete(userId);
    coachSessions.delete(userId);
    nutrition_service_1.nutritionService.removeProfileAndReset(userId);
    await sendMainMenu(ctx, '✅ Reset complete. Tap Start to set up again.');
});
const coachEnterHandler = async (ctx) => {
    coachSessions.add(ctx.from.id);
    await ctx.reply('🧠 Coach mode: pick a quick question below, or type your own message.', buildCoachMenu());
};
bot.command('coach', coachEnterHandler);
bot.hears(menu_1.MENU.coach, coachEnterHandler);
const runCoachAsk = async (ctx, userMessage) => {
    const userId = ctx.from.id;
    if (!checkDailyPromptLimit(userId)) {
        return ctx.reply("⚠️ You've reached your daily limit of 5 prompts (shared across photos, text meals, and Coach). Try again tomorrow!", (0, menu_1.buildMainMenu)());
    }
    coach_repository_1.coachRepository.recordCoachInput(userId, (0, time_1.formatYmdInUtcOffset)(new Date()));
    const thinkingMsg = await ctx.reply('🔎 analysing...');
    try {
        const { reply, hasMore } = await coach_service_1.coachService.ask(userId, userMessage);
        const buttons = [];
        if (hasMore)
            buttons.push([telegraf_1.Markup.button.callback('Tell me more', 'coach_more')]);
        buttons.push([telegraf_1.Markup.button.callback('Back to menu', 'coach_exit')]);
        await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
        await ctx.reply(reply, telegraf_1.Markup.inlineKeyboard(buttons));
        const remaining = getPromptsRemaining(userId);
        await ctx.reply(`📊 ${remaining} prompt${remaining === 1 ? '' : 's'} remaining today.`);
    }
    catch (error) {
        await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
        logger.error('Coach chat failed', { userId, message: getErrorMessage(error) });
        await ctx.reply('❌ Coach is unavailable right now. Please try again in a moment.');
    }
};
const statsHandler = async (ctx) => {
    const stats = await nutrition_service_1.nutritionService.getDailyStats(ctx.from.id);
    if (!stats) {
        await ctx.reply('📈 No nutrition entries for today yet. Send a food photo to get started! 📸', (0, menu_1.buildMainMenu)());
        return;
    }
    const messageText = `📈 Today's Totals:
🔥 Total Calories: ${stats.total_calories}
🥩 Total Protein: ${stats.total_protein_g.toFixed(1)}g (${stats.proteinPct.toFixed(0)}%)
🍞 Total Carbs: ${stats.total_carbs_g.toFixed(1)}g (${stats.carbsPct.toFixed(0)}%)
🥑 Total Fats: ${stats.total_fats_g.toFixed(1)}g (${stats.fatsPct.toFixed(0)}%)

${stats.progressBar} ${stats.progressPct}% of daily goal (${stats.goal} kcal)`;
    await ctx.reply(messageText, (0, menu_1.buildMainMenu)());
};
const weeklyHandler = async (ctx) => {
    const weekly = nutrition_service_1.nutritionService.getWeeklyCalories(ctx.from.id, 7);
    const lines = weekly.days.map((d) => `${d.date}: ${d.calories} kcal`).join('\n');
    await ctx.reply(`📅 Weekly calories (last ${weekly.days.length} days, UTC+8)\n\n${lines}\n\nTotal: ${weekly.total} kcal\nAvg/day: ${weekly.avg} kcal`, (0, menu_1.buildMainMenu)());
};
bot.action('coach_more', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    const next = coach_service_1.coachService.next(userId);
    if (!next.chunk) {
        await ctx.reply('No more details available. Ask a follow-up question anytime.', (0, menu_1.buildMainMenu)());
        return;
    }
    const buttons = [];
    if (next.hasMore)
        buttons.push([telegraf_1.Markup.button.callback('Tell me more', 'coach_more')]);
    buttons.push([telegraf_1.Markup.button.callback('Back to menu', 'coach_exit')]);
    await ctx.reply(next.chunk, telegraf_1.Markup.inlineKeyboard(buttons));
});
bot.action('coach_exit', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
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
bot.on((0, filters_1.message)('text'), async (ctx) => {
    const userId = ctx.from.id;
    const flow = profileFlows.get(userId);
    const text = ctx.message.text.trim();
    if (text.startsWith('/'))
        return;
    if (text === menu_1.MENU.start) {
        profileFlows.delete(userId);
        coachSessions.delete(userId);
        await startHandler(ctx);
        return;
    }
    if (text === menu_1.MENU.profile) {
        coachSessions.delete(userId);
        await profileHandler(ctx);
        return;
    }
    if (text === menu_1.MENU.stats) {
        coachSessions.delete(userId);
        await statsHandler(ctx);
        return;
    }
    if (text === menu_1.MENU.coach) {
        await coachEnterHandler(ctx);
        return;
    }
    if (text === menu_1.MENU.history) {
        coachSessions.delete(userId);
        await historyHandler(ctx);
        return;
    }
    if (text === menu_1.MENU.log) {
        await logMealHandler(ctx);
        return;
    }
    if (text === menu_1.MENU.weekly) {
        coachSessions.delete(userId);
        await weeklyHandler(ctx);
        return;
    }
    if (!flow) {
        if (coachSessions.has(userId)) {
            if (text === COACH_MENU.back) {
                coachSessions.delete(userId);
                await sendMainMenu(ctx, 'Main menu:');
                return;
            }
            const preset = text === COACH_MENU.hydration
                ? 'How much water should I drink today and how can I remember?'
                : text === COACH_MENU.fats
                    ? 'What are healthy fats and what foods should I choose?'
                    : text === COACH_MENU.meal
                        ? 'Suggest a healthy next meal idea based on my goals.'
                        : text === COACH_MENU.weight
                            ? 'Give me a simple plan for fat loss while keeping energy for training.'
                            : null;
            await runCoachAsk(ctx, preset ?? text);
        }
        return;
    }
    if (flow.mode === 'text_meal') {
        if (!checkDailyPromptLimit(userId)) {
            profileFlows.delete(userId);
            return ctx.reply("⚠️ You've reached your daily limit of 5 prompts (shared across photos, text meals, and Coach). Try again tomorrow!", (0, menu_1.buildMainMenu)());
        }
        const description = text.slice(0, 500);
        profileFlows.delete(userId);
        const thinkingMsg = await ctx.reply('🔎 analysing...');
        try {
            const { data } = await nutrition_service_1.nutritionService.processFoodText(userId, description);
            const { text: messageText } = buildFoodAnalysisMessage(data);
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
            await ctx.replyWithMarkdownV2(messageText, (0, menu_1.buildMainMenu)());
            const remaining = getPromptsRemaining(userId);
            await ctx.reply(`📊 ${remaining} prompt${remaining === 1 ? '' : 's'} remaining today.`);
        }
        catch (error) {
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
            await ctx.reply(getUserFacingAnalysisError(error), (0, menu_1.buildMainMenu)());
        }
        return;
    }
    if (flow.mode === 'fix_photo') {
        const correction = text.slice(0, 400);
        profileFlows.delete(userId);
        const entry = nutrition_service_1.nutritionService.getEntryForUser(userId, flow.entry_id);
        if (!entry || !entry.telegram_file_id) {
            await ctx.reply('❌ I cannot find that photo entry to fix. Please try again from History.', (0, menu_1.buildMainMenu)());
            return;
        }
        const thinkingMsg = await ctx.reply('🔎 analysing...');
        try {
            const fileLink = await bot.telegram.getFileLink(entry.telegram_file_id);
            const response = await axios_1.default.get(fileLink.toString(), { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data, 'binary');
            const base64 = buffer.toString('base64');
            const mimeType = 'image/jpeg';
            const updated = await nutrition_service_1.nutritionService.reanalyzePhotoEntry(userId, flow.entry_id, base64, mimeType, correction);
            if (!updated) {
                await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
                await ctx.reply('❌ Failed to update that entry. Please try again.', (0, menu_1.buildMainMenu)());
                return;
            }
            const { text: messageText } = buildFoodAnalysisMessage(updated.data);
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
            await ctx.replyWithMarkdownV2(messageText, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Fix Results', `fix_entry_${flow.entry_id}`)]]));
            await ctx.reply('Updated ✅', (0, menu_1.buildMainMenu)());
        }
        catch (error) {
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
            await ctx.reply(getUserFacingAnalysisError(error), (0, menu_1.buildMainMenu)());
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
            await ctx.reply('Select your sex:', telegraf_1.Markup.inlineKeyboard([
                [telegraf_1.Markup.button.callback('Male', 'sex_Male')],
                [telegraf_1.Markup.button.callback('Female', 'sex_Female')],
            ]));
            return;
        }
        if (flow.step === 'weight') {
            const weight = parseNumber(text);
            if (weight === null || weight < 20 || weight > 300) {
                await ctx.reply('❌ Invalid weight. Enter a number between 20 and 300 (kg).');
                return;
            }
            profileFlows.set(userId, { ...flow, step: 'height', weight_kg: weight });
            await ctx.reply('Enter your height in cm');
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
            const thinkingMsg = await ctx.reply('🔎 analysing...');
            const profile = await nutrition_service_1.nutritionService.setProfile(userId, display_name, age_years, sex, weight_kg, height);
            const bar = weightProgressBar(profile.weight_kg, profile.target_weight_high_kg);
            const delta = profile.weight_kg - profile.target_weight_high_kg;
            const targetText = profile.weight_kg > profile.target_weight_high_kg
                ? `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg (-${delta.toFixed(1)} kg to reach upper bound)`
                : `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg`;
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
            await ctx.reply(`✅ Profile saved\nBMI: ${profile.bmi.toFixed(1)} (${profile.bmi_status})\nDaily Goal: ${profile.daily_calorie_goal} kcal\n${bar}\n${targetText}`, (0, menu_1.buildMainMenu)());
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
            await ctx.reply('Enter your height in cm');
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
            const existing = nutrition_service_1.nutritionService.getProfile(userId);
            const age_years = existing?.age_years ?? 30;
            const sex = existing?.sex ?? 'Other';
            const thinkingMsg = await ctx.reply('🔎 analysing...');
            const profile = await nutrition_service_1.nutritionService.setProfile(userId, flow.display_name, age_years, sex, weight_kg, height);
            const bar = weightProgressBar(profile.weight_kg, profile.target_weight_high_kg);
            const delta = profile.weight_kg - profile.target_weight_high_kg;
            const targetText = profile.weight_kg > profile.target_weight_high_kg
                ? `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg (-${delta.toFixed(1)} kg to reach upper bound)`
                : `Healthy weight range: ${profile.target_weight_low_kg.toFixed(1)}–${profile.target_weight_high_kg.toFixed(1)} kg`;
            await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
            await ctx.reply(`✅ Profile updated\nBMI: ${profile.bmi.toFixed(1)} (${profile.bmi_status})\nDaily Goal: ${profile.daily_calorie_goal} kcal\n${bar}\n${targetText}`, (0, menu_1.buildMainMenu)());
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
            const existing = nutrition_service_1.nutritionService.getProfile(userId);
            if (!existing) {
                await sendMainMenu(ctx, 'No profile found. Tap Start to set up.');
                return;
            }
            user_repository_1.userRepository.updateDailyCalorieGoal(userId, Math.round(goal));
            await ctx.reply(`✅ Daily goal updated to ${Math.round(goal)} kcal.`, (0, menu_1.buildMainMenu)());
            return;
        }
    }
});
bot.action(/sex_(Male|Female)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    const match = ctx.callbackQuery?.data?.match(/sex_(Male|Female)/);
    const sex = match?.[1] || 'Male';
    const flow = profileFlows.get(userId);
    if (!flow || flow.mode !== 'onboarding' || flow.step !== 'sex')
        return;
    profileFlows.set(userId, { ...flow, sex, step: 'weight' });
    await ctx.reply('Enter your weight in kg');
});
// Photo handler
bot.on((0, filters_1.message)('photo'), async (ctx) => {
    const userId = ctx.from.id;
    if (!checkDailyPromptLimit(userId)) {
        return ctx.reply("⚠️ You've reached your daily limit of 5 prompts (shared across photos, text meals, and Coach). Try again tomorrow!");
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1]; // Get largest photo
    const userDescription = ctx.message.caption; // Use photo caption as description
    // Validate file size (< 10MB)
    if (photo.file_size && photo.file_size > 10 * 1024 * 1024) {
        return ctx.reply('❌ The image is too large. Please send a photo smaller than 10MB.');
    }
    const fileLink = await bot.telegram.getFileLink(photo.file_id);
    const thinkingMsg = await ctx.reply('🔎 analysing...');
    try {
        const response = await axios_1.default.get(fileLink.toString(), { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data, 'binary');
        const base64 = buffer.toString('base64');
        const mimeType = 'image/jpeg'; // Telegram photos are usually jpeg
        const { data, entry_id } = await nutrition_service_1.nutritionService.processFoodPhoto(userId, base64, mimeType, userDescription, photo.file_id);
        const { text: messageText } = buildFoodAnalysisMessage(data);
        await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
        await ctx.replyWithMarkdownV2(messageText, telegraf_1.Markup.inlineKeyboard([[telegraf_1.Markup.button.callback('Fix Results', `fix_entry_${entry_id}`)]]));
        await ctx.reply('Saved ✅', (0, menu_1.buildMainMenu)());
        const remaining = getPromptsRemaining(userId);
        await ctx.reply(`📊 ${remaining} prompt${remaining === 1 ? '' : 's'} remaining today.`);
    }
    catch (error) {
        await ctx.telegram.deleteMessage(ctx.chat.id, thinkingMsg.message_id).catch(() => { });
        const message = getErrorMessage(error);
        logger.error('Photo processing failed', {
            userId,
            message,
            name: error?.name,
            status: error?.status,
        });
        await ctx.reply(getUserFacingAnalysisError(error), (0, menu_1.buildMainMenu)());
    }
});
bot.action(/fix_entry_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    const entryId = Number(ctx.callbackQuery?.data?.match(/fix_entry_(\d+)/)?.[1]);
    if (!Number.isFinite(entryId)) {
        await ctx.reply('❌ Invalid entry ID.', (0, menu_1.buildMainMenu)());
        return;
    }
    profileFlows.set(userId, { mode: 'fix_photo', entry_id: entryId });
    await ctx.reply('✍️ Tell me what looks wrong (ingredients or portion size).\nExample: "rice is half bowl, pork is 2 slices"', (0, menu_1.buildMainMenu)());
});
// /stats command
bot.command('stats', statsHandler);
bot.hears(menu_1.MENU.stats, statsHandler);
bot.command('weekly', weeklyHandler);
bot.hears(menu_1.MENU.weekly, weeklyHandler);
const deleteHandler = async (ctx) => {
    const userId = ctx.from.id;
    const entries = await nutrition_service_1.nutritionService.getHistory(userId);
    if (!entries || entries.length === 0) {
        await ctx.reply('🗑 No recent entries to delete yet.', (0, menu_1.buildMainMenu)());
        return;
    }
    const buttons = entries.slice(0, 10).map((e) => {
        const name = (e.food_name || 'Unknown').slice(0, 24);
        return [telegraf_1.Markup.button.callback(`Delete #${e.id} · ${name} · ${e.calories}kcal`, `del_pick_${e.id}`)];
    });
    await ctx.reply('🗑 Select an entry to delete:', telegraf_1.Markup.inlineKeyboard(buttons));
};
bot.command('delete', deleteHandler);
bot.action(/del_pick_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    const id = Number(ctx.callbackQuery?.data?.match(/del_pick_(\d+)/)?.[1]);
    if (!Number.isFinite(id)) {
        await ctx.reply('❌ Invalid entry ID.', (0, menu_1.buildMainMenu)());
        return;
    }
    const entry = nutrition_service_1.nutritionService.getEntryForUser(userId, id);
    if (!entry) {
        await ctx.reply('❌ Entry not found (it may already be deleted).', (0, menu_1.buildMainMenu)());
        return;
    }
    const name = entry.food_name || 'Unknown';
    const text = `🗑 Delete this entry?\n\n#${entry.id} · ${name}\n${entry.calories} kcal · ${entry.entry_date}`;
    await ctx.reply(text, telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.callback('Yes, delete', `del_confirm_${entry.id}`)],
        [telegraf_1.Markup.button.callback('Cancel', `del_cancel_${entry.id}`)],
    ]));
});
bot.action(/del_cancel_(\d+)/, async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Cancelled.', (0, menu_1.buildMainMenu)());
});
bot.action(/del_confirm_(\d+)/, async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId)
        return;
    await ctx.answerCbQuery();
    const id = Number(ctx.callbackQuery?.data?.match(/del_confirm_(\d+)/)?.[1]);
    if (!Number.isFinite(id)) {
        await ctx.reply('❌ Invalid entry ID.', (0, menu_1.buildMainMenu)());
        return;
    }
    const result = nutrition_service_1.nutritionService.deleteEntry(userId, id);
    if (!result.deleted) {
        await ctx.reply('❌ Entry not found (it may already be deleted).', (0, menu_1.buildMainMenu)());
        return;
    }
    const name = result.food_name || 'Unknown';
    await ctx.reply(`✅ Deleted #${id} (${name}). Your daily totals are updated.`, (0, menu_1.buildMainMenu)());
    await statsHandler(ctx);
});
// /history command
const historyHandler = async (ctx) => {
    const history = await nutrition_service_1.nutritionService.getHistory(ctx.from.id);
    if (history.length === 0) {
        return ctx.reply('📅 No history found. Send some food photos first! 📸', (0, menu_1.buildMainMenu)());
    }
    await ctx.reply('📅 Your Recent Meal History:', (0, menu_1.buildMainMenu)());
    for (const entry of history) {
        const timestamp = (0, time_1.formatYmdHmInUtcOffsetFromSqlite)(entry.created_at);
        const caption = `🍽 ${entry.food_name || 'Unknown'}
⏰ ${timestamp}
🔥 ${entry.calories} kcal
🥩 ${entry.protein_g}P / 🍞 ${entry.carbs_g}C / 🥑 ${entry.fats_g}F`;
        const actions = telegraf_1.Markup.inlineKeyboard([
            [telegraf_1.Markup.button.callback('🗑 Delete', `del_pick_${entry.id}`)],
        ]);
        if (entry.telegram_file_id) {
            await ctx.replyWithPhoto(entry.telegram_file_id, { caption, ...actions });
        }
        else {
            await ctx.reply(caption, actions);
        }
    }
};
bot.command('history', historyHandler);
bot.hears(menu_1.MENU.history, historyHandler);
// /export command
bot.command('export', async (ctx) => {
    try {
        const csvContent = await nutrition_service_1.nutritionService.exportCSV(ctx.from.id);
        const buffer = Buffer.from(csvContent, 'utf-8');
        await ctx.replyWithDocument({ source: buffer, filename: `nutrition_history_${ctx.from.id}.csv` });
    }
    catch (error) {
        logger.error('Export failed', { error, userId: ctx.from.id });
        await ctx.reply('❌ Failed to generate CSV export.', (0, menu_1.buildMainMenu)());
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
//# sourceMappingURL=index.js.map