import { Context, Markup } from 'telegraf';
import { prisma } from '../../lib/prisma.js';
import { getSettingBool } from '../../lib/settings.js';
import { getBotId } from '../../lib/bot-context.js';
import { findUserByCtx } from '../../lib/user.js';
import { mainMenuKeyboard } from '../../lib/ui.js';

// ─── Game Definitions ────────────────────────
const GAME_DEFS = [
  {
    key: 'game_truth_or_dare_enabled',
    action: 'game_truth_or_dare',
    button: '🎭 جرعت و حقیقت',
    desc: '🎭 *جرعت و حقیقت* — حقیقت بگو یا جرئت انجام بده!',
  },
  {
    key: 'game_tic_tac_toe_enabled',
    action: 'game_tic_tac_toe',
    button: '❌⭕ بازی دوز',
    desc: '❌⭕ *دوز* — ۲۰×۲۰، پنج تا پشت سر هم بچین!',
  },
  {
    key: 'game_minesweeper_enabled',
    action: 'game_minesweeper',
    button: '💣 پیدا کردن بمب',
    desc: '💣 *پیدا کردن بمب* — ۲۰×۲۰ با ۵۰ مین، مراقب باش!',
  },
  {
    key: 'game_wordle_enabled',
    action: 'game_wordle',
    button: '🔤 کلمه‌یاب',
    desc: '🔤 *کلمه‌یاب* — کلمه مخفی را در ۶ تلاش حدس بزن!',
  },
  {
    key: 'game_hokm_enabled',
    action: 'game_hokm',
    button: '🃏 حکم',
    desc: '🃏 *حکم* — بازی ورق کلاسیک ایرانی، حکم را با حکم بزن!',
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

  const rows: any[] = [];
  const descriptions: string[] = [];

  for (const game of GAME_DEFS) {
    if (await getSettingBool(game.key)) {
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
    descriptions.join('\n'),
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

// ─── Game Action Router ──────────────────────
async function isGameEnabled(key: string): Promise<boolean> {
  const gamesEnabled = await getSettingBool('games_enabled');
  if (!gamesEnabled) return false;
  return getSettingBool(key);
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

  switch (action) {
    case 'games':
      await ctx.answerCbQuery();
      await handleGames(ctx);
      break;

    // Truth or Dare
    case 'game_truth_or_dare':
      if (!(await isGameEnabled('game_truth_or_dare_enabled'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleTruthOrDare(ctx);
      break;

    // Tic Tac Toe
    case 'game_tic_tac_toe':
      if (!(await isGameEnabled('game_tic_tac_toe_enabled'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleTicTacToe(ctx);
      break;

    // Minesweeper
    case 'game_minesweeper':
      if (!(await isGameEnabled('game_minesweeper_enabled'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleMinesweeper(ctx);
      break;

    // Wordle
    case 'game_wordle':
      if (!(await isGameEnabled('game_wordle_enabled'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleWordle(ctx);
      break;

    // Hokm
    case 'game_hokm':
      if (!(await isGameEnabled('game_hokm_enabled'))) {
        await rejectDisabled(ctx);
        break;
      }
      await ctx.answerCbQuery();
      await handleHokm(ctx);
      break;

    default:
      // Route to specific game handlers
      if (action.startsWith('tod_')) {
        if (!(await isGameEnabled('game_truth_or_dare_enabled'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleTruthOrDareAction(ctx);
      } else if (action.startsWith('ttt_')) {
        if (!(await isGameEnabled('game_tic_tac_toe_enabled'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleTicTacToeAction(ctx);
      } else if (action.startsWith('ms_')) {
        if (!(await isGameEnabled('game_minesweeper_enabled'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleMinesweeperAction(ctx);
      } else if (action.startsWith('wordle_')) {
        if (!(await isGameEnabled('game_wordle_enabled'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleWordleAction(ctx);
      } else if (action.startsWith('hokm_')) {
        if (!(await isGameEnabled('game_hokm_enabled'))) {
          await rejectDisabled(ctx);
          break;
        }
        await handleHokmAction(ctx);
      }
      return false;
  }
  return true;
}
