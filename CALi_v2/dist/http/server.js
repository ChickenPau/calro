"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const config_1 = require("@/config");
const nutrition_service_1 = require("@/services/nutrition.service");
const coach_service_1 = require("@/services/coach.service");
const nutrition_repository_1 = require("@/repositories/nutrition.repository");
const calorie_goal_repository_1 = require("@/repositories/calorie-goal.repository");
const ai_service_1 = require("@/services/ai.service");
const parseUserId = (req) => {
    const raw = req.query.userId || req.headers['x-user-id'] || req.body?.userId;
    if (!raw)
        return null;
    const n = Number(raw);
    if (!Number.isFinite(n))
        return null;
    return Math.trunc(n);
};
const createHttpServer = () => {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: '1mb' }));
    app.get('/api/health', (_req, res) => {
        res.json({ ok: true });
    });
    app.get('/api/profile', (req, res) => {
        const userId = parseUserId(req);
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        const profile = nutrition_service_1.nutritionService.getProfile(userId);
        if (!profile)
            return res.status(404).json({ error: 'Profile not found' });
        res.json({ profile });
    });
    app.post('/api/chat', async (req, res) => {
        const userId = parseUserId(req);
        const message = req.body?.message || '';
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        if (!message.trim())
            return res.status(400).json({ error: 'Missing message' });
        try {
            const result = await coach_service_1.coachService.ask(userId, message);
            res.json({ reply: result.reply, hasMore: result.hasMore });
        }
        catch (e) {
            res.status(500).json({ error: 'Chat failed' });
        }
    });
    app.post('/api/chat/more', (req, res) => {
        const userId = parseUserId(req);
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        const next = coach_service_1.coachService.next(userId);
        res.json({ chunk: next.chunk, hasMore: next.hasMore });
    });
    app.get('/api/stats/daily', async (req, res) => {
        const userId = parseUserId(req);
        const date = req.query.date || '';
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        if (!date)
            return res.status(400).json({ error: 'Missing date' });
        const summary = await nutrition_service_1.nutritionService.getDailyStats(userId, date);
        const profile = nutrition_service_1.nutritionService.getProfile(userId);
        if (!profile)
            return res.status(400).json({ error: 'Profile required to compute calorie goal' });
        const cached = calorie_goal_repository_1.calorieGoalRepository.getGoal(userId, date);
        if (cached) {
            return res.json({
                date,
                calorieGoal: cached.goal_calories,
                caloriesConsumed: summary?.total_calories ?? null,
                fetchedFrom: 'cache',
            });
        }
        try {
            const goal = await ai_service_1.aiService.calculateDailyCalorieGoal({
                age_years: profile.age_years,
                sex: profile.sex,
                height_cm: profile.height_cm,
                weight_kg: profile.weight_kg,
            });
            calorie_goal_repository_1.calorieGoalRepository.upsertGoal({
                user_id: userId,
                goal_date: date,
                goal_calories: goal.goal_calories,
                rationale: goal.rationale,
                source: 'gemini',
            });
            return res.json({
                date,
                calorieGoal: goal.goal_calories,
                caloriesConsumed: summary?.total_calories ?? null,
                fetchedFrom: 'gemini',
            });
        }
        catch {
            return res.status(502).json({ error: 'Failed to compute calorie goal' });
        }
    });
    app.get('/api/history', (req, res) => {
        const userId = parseUserId(req);
        const date = req.query.date || '';
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        if (!date)
            return res.status(400).json({ error: 'Missing date' });
        const entries = nutrition_repository_1.nutritionRepository.getEntriesForDate(userId, date);
        const items = entries.map((e) => ({
            id: String(e.id),
            timestamp: e.created_at,
            title: e.food_name || 'Food entry',
            calories: e.calories,
            macros: { proteinG: e.protein_g, carbsG: e.carbs_g, fatsG: e.fats_g },
            thumbnailUrl: e.telegram_file_id ? `/api/entries/${e.id}/thumbnail?userId=${userId}` : null,
        }));
        res.json({ items });
    });
    app.get('/api/entries/:id/thumbnail', async (req, res) => {
        const userId = parseUserId(req);
        const id = Number(req.params.id);
        if (!userId)
            return res.status(400).json({ error: 'Missing userId' });
        if (!Number.isFinite(id))
            return res.status(400).json({ error: 'Invalid id' });
        const entry = nutrition_repository_1.nutritionRepository.getEntryById(id);
        if (!entry || entry.user_id !== userId)
            return res.status(404).end();
        if (!entry.telegram_file_id)
            return res.status(404).end();
        try {
            const getFileResp = await axios_1.default.get(`https://api.telegram.org/bot${config_1.config.telegram.token}/getFile`, { params: { file_id: entry.telegram_file_id }, timeout: 15000 });
            const filePath = getFileResp.data?.result?.file_path;
            if (!filePath)
                return res.status(404).end();
            const fileUrl = `https://api.telegram.org/file/bot${config_1.config.telegram.token}/${filePath}`;
            const imgResp = await axios_1.default.get(fileUrl, { responseType: 'arraybuffer', timeout: 20000 });
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.status(200).send(Buffer.from(imgResp.data));
        }
        catch {
            res.status(502).end();
        }
    });
    const webDist = path_1.default.resolve(process.cwd(), 'web', 'dist');
    app.use(express_1.default.static(webDist));
    app.get(/^(?!\/api).*/, (_req, res) => {
        res.sendFile(path_1.default.join(webDist, 'index.html'));
    });
    return app;
};
exports.createHttpServer = createHttpServer;
//# sourceMappingURL=server.js.map