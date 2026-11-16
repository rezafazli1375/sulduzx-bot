import { Context, Markup } from 'telegraf';
import { getSettingBool } from '../../lib/settings.js';
import { getBotId } from '../../lib/bot-context.js';
import { GAMES_SECTION, isFeatureAllowed, isGameAllowed } from '../../lib/bot-access.js';
import { findUserByCtx } from '../../lib/user.js';
import { checkGameChannelJoin } from './utils.js';

// ─── Game Definitions ────────────────────────
// `game` کلید بازی در دسترسی‌های هر ربات است (bots.blocked_games) و `key`
// تنظیم سراسری خاموش/روشن کردن همان بازی.
// توضیح هر بازی عمداً یک خطی است: دستور مالک، متن‌های بلند بازی‌ها کوتاه شود.
//
// از نسخهٔ ۲٫۰٫۰ فقط همین سه بازی در ربات می‌ماند. کلمه‌یاب، حکم، منچ و اسکالا
// حذف شدند و کلیدهای تنظیمشان به REMOVED_SETTINGS در lib/settings.ts رفت تا
// از دیتابیس نصب‌های قدیمی هم پاک شوند.
const GAME_DEFS = [
  {
    game: 'truth_or_dare',
    key: 'game_truth_or_dare_enabled',
    action: 'game_truth_or_dare',
    button: '🎭 جرعت و حقیقت',
    desc: '🎭 *جرعت و حقیقت* — حقیقت بگو یا جرئت انجام بده (/joraat)',
  },
  {
    game: 'tic_tac_toe',
    key: 'game_tic_tac_toe_enabled',
    action: 'game_tic_tac_toe',
    button: '❌⭕ دوز',
    desc: '❌⭕ *دوز* — ۳×۳ یا ۶×۷، در پیوی مقابل ربات (/dooz)',
  },
  {
    game: 'minesweeper',
    key: 'game_minesweeper_enabled',
    action: 'game_minesweeper',
    button: '💣 مین‌روب',
    desc: '💣 *مین‌روب* — دوئل ۹×۸، بیشترین مین برنده است (/meen)',
  },
];

// ─── Private play vs the bot ─────────────────
// از نسخهٔ ۲٫۰٫۰ هر سه بازی در *گفتگوی خصوصی* هم بازی می‌شوند و حریف، خودِ
// ربات است: در دوز ربات با ⭕ بازی می‌کند، در مین‌روب صندلی 🔵 آبی را برمی‌دارد
// و در جرعت و حقیقت مستقیم از کاربر سؤال/چالش می‌پرسد.
// دروازهٔ مشترکشان gameChatMode در games/utils.ts است (تنظیم
// games_private_vs_bot_enabled)؛ همان‌جا اگر حالت خاموش باشد پیام «فقط در
// گروه» فرستاده می‌شود. این فایل دروازهٔ تکراری ندارد تا دو جا یک‌وقت باز نشود.

// ─── Game Menu ───────────────────────────────
export async function handleGames(ctx: Context) {
  const user = await findUserByCtx(ctx);
  if (!user) return;

  const gamesEnabled = await getSettingBool('games_enabled');
  if (!gamesEnabled) {
    await ctx.reply('🎮 بخش بازی‌ها موقتاً غیرفعال است.');
    return;
  }

  // ربات‌ها در پنل می‌توانند از بخش بازی‌ها یا از بازی‌های خاصی محروم باشند
  if (!(await isFeatureAllowed(getBotId(ctx), GAMES_SECTION))) {
    await ctx.reply('🎮 بخش بازی‌ها برای این ربات در پنل غیرفعال شده است.');
    return;
  }

  const rows: any[] = [];
  const descriptions: string[] = [];

  for (const game of GAME_DEFS) {
    if (await isGameEnabled(ctx, game.game)) {
      rows.push([Markup.button.callback(game.button, game.action)]);
      descriptions.push(game.desc);
    }
  }

  if (rows.length === 0) {
    await ctx.reply('🎮 در حال حاضر همه بازی‌ها غیرفعال هستند. لطفاً بعداً تلاش کنید.');
    return;
  }

  rows.push([Markup.button.callback('🔙 بازگشت', 'main_menu')]);

  await ctx.reply(
    '🎮 *بازی‌ها* — یکی را انتخاب کنید:\n\n' + descriptions.join('\n'),
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  );
}

export async function handleGameCheckMembership(ctx: Context) {
  await ctx.answerCbQuery('در حال بررسی...');
  const joined = await checkGameChannelJoin(ctx);
  if (joined) {
    await handleGames(ctx);
  }
}

// ─── Direct Game Commands ────────────────────
// /meen, /dooz, /joraat start a game immediately.
// کلمه‌یاب، حکم، منچ و اسکالا در ۲٫۰٫۰ حذف شدند؛ در نتیجه /kalame، /hokm،
// /mench و /scala هم دیگر ثبت نمی‌شوند (lib/bot-commands.ts) و اگر کسی
// پیام قدیمیِ آن بازی‌ها را در گروه بزند، catch-all در actions.ts می‌گوید
// «این بازی حذف شده است».
export type DirectGameKey = 'truth_or_dare' | 'tic_tac_toe' | 'minesweeper';

const DIRECT_GAME_DEFS: Record<DirectGameKey, { settingKey: string; label: string; run: (ctx: Context) => Promise<void> }> = {
  truth_or_dare: {
    settingKey: 'game_truth_or_dare_enabled',
    label: 'جرعت و حقیقت',
    run: async (ctx) => (await import('./truth-or-dare.js')).handleTruthOrDare(ctx),
  },
  tic_tac_toe: {
    settingKey: 'game_tic_tac_toe_enabled',
    label: 'دوز',
    run: async (ctx) => (await import('./tic-tac-toe.js')).handleTicTacToe(ctx),
  },
  minesweeper: {
    settingKey: 'game_minesweeper_enabled',
    label: 'مین‌روب',
    run: async (ctx) => (await import('./minesweeper.js')).handleMinesweeper(ctx),
  },
};

export async function handleGameCommand(ctx: Context, game: DirectGameKey) {
  const def = DIRECT_GAME_DEFS[game];
  if (!def) return;

  if (!(await isGameEnabled(ctx, game))) {
    await ctx.reply(`⛔️ بازی «${def.label}» در حال حاضر غیرفعال است.`);
    return;
  }

  await def.run(ctx);
}

// ─── Game Action Router ──────────────────────
/**
 * آیا این بازی برای این ربات و در این لحظه باز است؟
 * سه لایه: تنظیم سراسری «بازی‌ها»، تنظیم همان بازی و دسترسی همان ربات.
 */
async function isGameEnabled(ctx: Context, game: string): Promise<boolean> {
  const gamesEnabled = await getSettingBool('games_enabled');
  if (!gamesEnabled) return false;
  if (!(await getSettingBool(`game_${game}_enabled`))) return false;
  return isGameAllowed(getBotId(ctx), game);
}

async function rejectDisabled(ctx: Context) {
  await ctx.answerCbQuery('⛔️ این بازی در حال حاضر غیرفعال است.');
}

export async function handleGameAction(ctx: Context) {
  const action = (ctx.callbackQuery as any).data;

  // Lazy imports to avoid circular dependencies
  const { handleTruthOrDare, handleTruthOrDareAction } = await import('./truth-or-dare.js');
  const { handleTicTacToe, handleTicTacToeAction } = await import('./tic-tac-toe.js');
  const { handleMinesweeper, handleMinesweeperAction } = await import('./minesweeper.js');

  switch (action) {
    case 'games':
      await ctx.answerCbQuery();
      await handleGames(ctx);
      break;

    // Truth or Dare
    case 'game_truth_or_dare':
      if (!(await isGameEnabled(ctx, 'truth_or_dare'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleTruthOrDare(ctx);
      break;

    // Tic Tac Toe
    case 'game_tic_tac_toe':
      if (!(await isGameEnabled(ctx, 'tic_tac_toe'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleTicTacToe(ctx);
      break;

    // Minesweeper
    case 'game_minesweeper':
      if (!(await isGameEnabled(ctx, 'minesweeper'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleMinesweeper(ctx);
      break;

    // Wordle / Hokm / Mench / Scala از نسخهٔ ۲٫۰٫۰ حذف شده‌اند؛ دکمه‌های
    // 'game_wordle'، 'game_hokm'، 'game_mench' و 'game_scala' دیگر ثبت نمی‌شوند
    // و هر action با پیشوند wordle_/hokm_/mench_/scala_ (و همان چهار دکمهٔ منو)
    // در bot/actions.ts به پیام «این بازی حذف شده است» می‌رسد.

    default:
      // Route to specific game handlers
      if (action.startsWith('tod_')) {
        if (!(await isGameEnabled(ctx, 'truth_or_dare'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleTruthOrDareAction(ctx);
      } else if (action.startsWith('ttt_')) {
        if (!(await isGameEnabled(ctx, 'tic_tac_toe'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleTicTacToeAction(ctx);
      } else if (action.startsWith('ms_')) {
        if (!(await isGameEnabled(ctx, 'minesweeper'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleMinesweeperAction(ctx);
      }
      return false;
  }
  return true;
}
