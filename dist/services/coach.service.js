"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.coachService = exports.CoachService = void 0;
const coach_repository_1 = require("@/repositories/coach.repository");
const nutrition_service_1 = require("@/services/nutrition.service");
const ai_service_1 = require("@/services/ai.service");
const chunkText = (text, chunkSize) => {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + chunkSize));
        i += chunkSize;
    }
    return chunks;
};
class CoachService {
    async ask(telegram_id, userMessage) {
        await nutrition_service_1.nutritionService.registerUser(telegram_id);
        const state = coach_repository_1.coachRepository.getState(telegram_id);
        const profile = nutrition_service_1.nutritionService.getProfile(telegram_id) || undefined;
        const result = await ai_service_1.aiService.coachChat({
            userMessage,
            memory: state.memory,
            profile: profile
                ? {
                    display_name: profile.display_name,
                    age_years: profile.age_years,
                    sex: profile.sex,
                    bmi: profile.bmi,
                    bmi_status: profile.bmi_status,
                    weight_kg: profile.weight_kg,
                    target_weight_low_kg: profile.target_weight_low_kg,
                    target_weight_high_kg: profile.target_weight_high_kg,
                }
                : undefined,
        });
        const pending = result.more ? chunkText(result.more, 900) : [];
        coach_repository_1.coachRepository.setState({ telegram_id, memory: result.memory, pending_chunks: pending });
        return { reply: result.reply, hasMore: pending.length > 0 };
    }
    next(telegram_id) {
        const state = coach_repository_1.coachRepository.getState(telegram_id);
        const next = state.pending_chunks.shift();
        coach_repository_1.coachRepository.setState({ telegram_id, memory: state.memory, pending_chunks: state.pending_chunks });
        return { chunk: next || null, hasMore: state.pending_chunks.length > 0 };
    }
    clear(telegram_id) {
        coach_repository_1.coachRepository.clearState(telegram_id);
    }
}
exports.CoachService = CoachService;
exports.coachService = new CoachService();
exports.default = exports.coachService;
//# sourceMappingURL=coach.service.js.map