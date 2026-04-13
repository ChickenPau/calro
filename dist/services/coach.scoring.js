"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreCoachRelevance = void 0;
const tokenize = (text) => {
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    return new Set(tokens);
};
const scoreCoachRelevance = (query, reply) => {
    const q = tokenize(query);
    const r = tokenize(reply);
    const nutritionTerms = [
        'calorie',
        'calories',
        'protein',
        'carb',
        'carbs',
        'fat',
        'fats',
        'fiber',
        'hydration',
        'water',
        'sleep',
        'steps',
        'portion',
        'vegetable',
        'fruit',
        'whole',
        'meal',
        'snack',
    ];
    const qImportant = new Set([...q].filter((t) => nutritionTerms.includes(t)));
    if (qImportant.size === 0)
        return 0.85;
    let hit = 0;
    for (const t of qImportant) {
        if (r.has(t))
            hit++;
    }
    const overlap = hit / qImportant.size;
    const lengthPenalty = reply.length > 900 ? 0.2 : 0;
    return Math.max(0, Math.min(1, overlap - lengthPenalty + 0.1));
};
exports.scoreCoachRelevance = scoreCoachRelevance;
//# sourceMappingURL=coach.scoring.js.map