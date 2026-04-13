import { buildMainMenu, MENU } from '../src/ui/menu';

describe('Main menu UI', () => {
  it('renders the main menu keyboard with the expected labels', () => {
    const markup: any = buildMainMenu();
    expect(markup).toBeDefined();
    expect(markup.reply_markup).toBeDefined();

    const keyboard = markup.reply_markup.keyboard;
    expect(Array.isArray(keyboard)).toBe(true);
    expect(keyboard.length).toBe(3);
    expect(keyboard[0]).toEqual([MENU.start, MENU.profile, MENU.stats]);
    expect(keyboard[1]).toEqual([MENU.coach, MENU.history, MENU.log]);
    expect(keyboard[2]).toEqual([MENU.export, MENU.weekly]);
  });

  it('uses reply keyboard for both mobile and desktop clients', () => {
    const markup: any = buildMainMenu();
    expect(markup.reply_markup.keyboard).toBeDefined();
    expect(markup.reply_markup.inline_keyboard).toBeUndefined();
  });
});

