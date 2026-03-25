import { Markup } from 'telegraf';

export const MENU = {
  start: '🚀 Start',
  profile: '👤 Profile',
  stats: '📊 Stats',
  coach: '🧠 Coach',
  history: '📜 History',
  log: '✍️ Log meal',
  weekly: '📅 Weekly',
} as const;

export const buildMainMenu = () => {
  return Markup.keyboard([
    [MENU.start, MENU.profile, MENU.stats],
    [MENU.coach, MENU.history, MENU.log],
    [MENU.weekly],
  ])
    .resize()
    .oneTime(false);
};

