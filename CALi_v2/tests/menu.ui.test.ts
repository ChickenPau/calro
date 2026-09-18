import { buildMainMenuInline, buildReturnToMenu, buildGetStarted, MENU } from '../src/ui/menu';

describe('Main menu UI', () => {
  it('renders the main menu as an inline keyboard with the expected labels', () => {
    const markup: any = buildMainMenuInline();
    expect(markup).toBeDefined();
    expect(markup.reply_markup).toBeDefined();

    const keyboard = markup.reply_markup.inline_keyboard;
    expect(Array.isArray(keyboard)).toBe(true);
    expect(keyboard[0].map((b: any) => b.text)).toEqual([MENU.profile, MENU.stats]);
    expect(keyboard[1].map((b: any) => b.text)).toEqual([MENU.history, MENU.log]);
    expect(keyboard[2].map((b: any) => b.text)).toEqual([MENU.photoLog, MENU.export]);
    expect(keyboard[3].map((b: any) => b.text)).toEqual([MENU.weekly]);
  });

  it('uses an inline keyboard, not a persistent reply keyboard', () => {
    const markup: any = buildMainMenuInline();
    expect(markup.reply_markup.inline_keyboard).toBeDefined();
    expect(markup.reply_markup.keyboard).toBeUndefined();
  });

  it('return-to-menu button has a single callback button', () => {
    const markup: any = buildReturnToMenu();
    const keyboard = markup.reply_markup.inline_keyboard;
    expect(keyboard.length).toBe(1);
    expect(keyboard[0].length).toBe(1);
    expect(keyboard[0][0].callback_data).toBe('menu_main');
  });

  it('get-started button has a single callback button', () => {
    const markup: any = buildGetStarted();
    const keyboard = markup.reply_markup.inline_keyboard;
    expect(keyboard.length).toBe(1);
    expect(keyboard[0].length).toBe(1);
    expect(keyboard[0][0].callback_data).toBe('get_started');
  });
});
