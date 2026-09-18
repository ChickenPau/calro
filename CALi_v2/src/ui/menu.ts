import { Markup } from 'telegraf';

export const MENU = {
  profile: '👤 Profile',
  stats: '📊 Stats',
  history: '📜 History',
  log: '✍️ Log meal',
  photoLog: '📸 Photo logging',
  export: '📄 Export',
  weekly: '📅 Weekly',
} as const;

// Main navigation, always shown as an inline keyboard attached to a message
// (never a persistent reply keyboard).
export const buildMainMenuInline = () => {
  return Markup.inlineKeyboard([
    [Markup.button.callback(MENU.profile, 'menu_profile'), Markup.button.callback(MENU.stats, 'menu_stats')],
    [Markup.button.callback(MENU.history, 'menu_history'), Markup.button.callback(MENU.log, 'menu_log')],
    [Markup.button.callback(MENU.photoLog, 'menu_photo'), Markup.button.callback(MENU.export, 'menu_export')],
    [Markup.button.callback(MENU.weekly, 'menu_weekly')],
  ]);
};

// Single button attached to in-progress prompts, so the user can always bail
// out of whatever they're doing back to the main menu.
export const buildReturnToMenu = () => {
  return Markup.inlineKeyboard([[Markup.button.callback('🏠 Return to Menu', 'menu_main')]]);
};

// First-touch welcome button, shown to both new and returning users on /start.
export const buildGetStarted = () => {
  return Markup.inlineKeyboard([[Markup.button.callback('🚀 Get Started', 'get_started')]]);
};
