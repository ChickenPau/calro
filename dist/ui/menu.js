"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMainMenu = exports.MENU = void 0;
const telegraf_1 = require("telegraf");
exports.MENU = {
    start: '🚀 Start',
    profile: '👤 Profile',
    stats: '📊 Stats',
    coach: '🧠 Coach',
    history: '📜 History',
    log: '✍️ Log meal',
    weekly: '📅 Weekly',
};
const buildMainMenu = () => {
    return telegraf_1.Markup.keyboard([
        [exports.MENU.start, exports.MENU.profile, exports.MENU.stats],
        [exports.MENU.coach, exports.MENU.history, exports.MENU.log],
        [exports.MENU.weekly],
    ])
        .resize()
        .oneTime(false);
};
exports.buildMainMenu = buildMainMenu;
//# sourceMappingURL=menu.js.map