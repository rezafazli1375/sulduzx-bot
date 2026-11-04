import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getSettingBool } from '../../lib/settings.js';
import { getBotId } from '../../lib/bot-context.js';
import { GAMES_SECTION, isFeatureAllowed, isGameAllowed } from '../../lib/bot-access.js';
import { findUserByCtx } from '../../lib/user.js';
import { mainMenuKeyboard } from '../../lib/ui.js';

// ─── Game Definitions ────────────────────────
// `game` کلید بازی در دسترسی‌های هر ربات است (bots.blocked_games) و `key`
// تنظیم سراسری خاموش/روشن کردن همان بازی.
const GAME_DEFS = [
  {
    game: 'truth_or_dare',
    key: 'game_truth_or_dare_enabled',
    action: 'game_truth_or_dare',
    button: '🎭 جرعت و حقیقت',
    desc: '🎭 *جرعت و حقیقت* — حقیقت بگو یا جرئت انجام بده!',
  },
  {
    game: 'tic_tac_toe',
    key: 'game_tic_tac_toe_enabled',
    action: 'game_tic_tac_toe',
    button: '❌⭕ دوز',
    desc: '❌⭕ *دوز* — کلاسیک ۳×۳ یا حرفه‌ای ۶×۷! (/dooz)',
  },
  {
    game: 'minesweeper',
    key: 'game_minesweeper_enabled',
    action: 'game_minesweeper',
    button: '💣 مین‌روب',
    desc: '💣 *مین‌روب* — مین‌ها را پیدا نکن! کندن، پرچم‌گذاری و سه سطح سختی (/meen)',
  },
  {
    game: 'wordle',
    key: 'game_wordle_enabled',
    action: 'game_wordle',
    button: '🔤 کلمه‌یاب',
    desc: '🔤 *کلمه‌یاب* — کلمه را در گروه بنویس و زودتر از بقیه حدس بزن! (/kalame)',
  },
  {
    game: 'hokm',
    key: 'game_hokm_enabled',
    action: 'game_hokm',
    button: '🃏 حکم',
    desc: '🃏 *حکم* — چهارنفره، حاکم حکم را می‌زند و ۷ تریک برنده است (/hokm)',
  },
  {
    game: 'mench',
    key: 'game_mench_enabled',
    action: 'game_mench',
    button: '🎲 منچ',
    desc: '🎲 *منچ* — ۲ تا ۴ نفره؛ تاس بینداز، مهره حریف را بزن و زودتر به مرکز برس (/mench)',
  },
  {
    game: 'scala',
    key: 'game_scala_enabled',
    action: 'game_scala',
    button: '🇮🇹 اسکالا',
    desc: '🇮🇹 *اسکالا* — ۲ تا ۴ نفره با ۱۰۸ کارت؛ سری و ست بچین، با ۴۰ امتیاز باز شو و بازی را ببند (/scala)',
  },
];

// ─── Group Check ─────────────────────────────
export async function requireGroup(ctx: Context, gameName: string): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType === 'private') {
    const botInfo = await ctx.telegram.getMe();
    await ctx.reply(
      `🎮 *بازی ${gameName}*\n\n` +
      `این بازی فقط در *گروه* قابل انجام است!\n\n` +
      `📌 لطفاً ربات @${botInfo.username} را به گروه خود اضافه کنید و سپس بازی را شروع کنید.\n\n` +
      `💡 برای اضافه کردن ربات به گروه:\n` +
      `1️⃣ وارد گروه شوید\n` +
      `2️⃣ به تنظیمات گروه بروید\n` +
      `3️⃣ Add Members را بزنید\n` +
      `4️⃣ @${botInfo.username} را جستجو و اضافه کنید`,
      { parse_mode: 'Markdown', ...await mainMenuKeyboard() }
    );
    return false;
  }
  return true;
}

// ─── Channel Join Check for Games ────────────
export async function checkGameChannelJoin(ctx: Context): Promise<boolean> {
  const forceJoin = await getSettingBool('force_join_channels');
  if (!forceJoin) return true;

  const botId = getBotId(ctx);
  const user = await findUserByCtx(ctx);
  if (!user) return false;

  const channels = await prisma.channel.findMany({
    where: { botId, isRequired: true, isActive: true },
    orderBy: { joinOrder: 'asc' },
  });

  if (channels.length === 0) return true;

  const notJoined: { username: string; title: string }[] = [];

  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(
        channel.channelId.toString(),
        ctx.from!.id
      );
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        notJoined.push({
          username: channel.channelUsername,
          title: channel.title || channel.channelUsername,
        });
      }
    } catch {
      notJoined.push({
        username: channel.channelUsername,
        title: channel.title || channel.channelUsername,
      });
    }
  }

  if (notJoined.length > 0) {
    const channelLinks = notJoined.map((ch) => `📢 ${ch.title}`).join('\n');
    const buttons: any[] = notJoined.map((ch) => [
      Markup.button.url(
        `📢 عضویت در ${ch.title}`,
        `https://t.me/${ch.username.replace(/^@/, '')}`
      ),
    ]);
    buttons.push([Markup.button.callback('✅ بررسی مجدد', 'game_check_membership')]);

    await ctx.reply(
      `⚠️ برای شرکت در بازی‌ها، ابتدا عضو کانال‌های زیر شوید:\n\n${channelLinks}`,
      Markup.inlineKeyboard(buttons)
    );
    return false;
  }

  return true;
}

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
    '🎮 *به بخش بازی‌ها خوش آمدید!*\n\n' +
    'یکی از بازی‌های زیر را انتخاب کنید:\n\n' +
    descriptions.join('\n') +
    '\n\n💡 دستورهای سریع: /meen ، /dooz ، /kalame ، /hokm ، /mench ، /scala',
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
// /meen, /dooz, /kalame, /hokm, /joraat start a game immediately.
export type DirectGameKey =
  | 'truth_or_dare'
  | 'tic_tac_toe'
  | 'minesweeper'
  | 'wordle'
  | 'hokm'
  | 'mench'
  | 'scala';

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
  wordle: {
    settingKey: 'game_wordle_enabled',
    label: 'کلمه‌یاب',
    run: async (ctx) => (await import('./wordle.js')).handleWordle(ctx),
  },
  hokm: {
    settingKey: 'game_hokm_enabled',
    label: 'حکم',
    run: async (ctx) => (await import('./hokm.js')).handleHokm(ctx),
  },
  mench: {
    settingKey: 'game_mench_enabled',
    label: 'منچ',
    run: async (ctx) => (await import('./mench.js')).handleMench(ctx),
  },
  scala: {
    settingKey: 'game_scala_enabled',
    label: 'اسکالا',
    run: async (ctx) => (await import('./scala.js')).handleScala(ctx),
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
  const { handleWordle, handleWordleAction } = await import('./wordle.js');
  const { handleHokm, handleHokmAction } = await import('./hokm.js');
  const { handleMench, handleMenchAction } = await import('./mench.js');
  const { handleScala, handleScalaAction } = await import('./scala.js');

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

    // Wordle
    case 'game_wordle':
      if (!(await isGameEnabled(ctx, 'wordle'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleWordle(ctx);
      break;

    // Hokm
    case 'game_hokm':
      if (!(await isGameEnabled(ctx, 'hokm'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleHokm(ctx);
      break;

    // Mench
    case 'game_mench':
      if (!(await isGameEnabled(ctx, 'mench'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleMench(ctx);
      break;

    // Scala
    case 'game_scala':
      if (!(await isGameEnabled(ctx, 'scala'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleScala(ctx);
      break;

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
      } else if (action.startsWith('wordle_')) {
        if (!(await isGameEnabled(ctx, 'wordle'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleWordleAction(ctx);
      } else if (action.startsWith('hokm_')) {
        if (!(await isGameEnabled(ctx, 'hokm'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleHokmAction(ctx);
      } else if (action.startsWith('mench_')) {
        if (!(await isGameEnabled(ctx, 'mench'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleMenchAction(ctx);
      } else if (action.startsWith('scala_')) {
        if (!(await isGameEnabled(ctx, 'scala'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleScalaAction(ctx);
      }
      return false;
  }
  return true;
}
