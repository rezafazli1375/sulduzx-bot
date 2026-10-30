import { Context, Markup } from 'telegraf';
import { getPanelClient } from '../lib/xui-panel.js';
import { getSettingBool } from '../lib/settings.js';
import { getText } from '../lib/texts.js';
import { mainMenuButton } from '../lib/ui.js';

export async function handleServerStatus(ctx: Context) {
  const enabled = await getSettingBool('server_status_check');
  if (!enabled) {
    await ctx.reply(await getText('status.disabled'), Markup.inlineKeyboard([[await mainMenuButton()]]));
    return;
  }

  await ctx.reply(await getText('status.checking'));

  try {
    const panelClient = await getPanelClient();
    const status = await panelClient.getServerStatus();

    if (status.online) {
      await ctx.reply(
        await getText('status.online', { cpu: status.cpu, mem: status.mem }),
        Markup.inlineKeyboard([[await mainMenuButton()]])
      );
    } else {
      await ctx.reply(await getText('status.offline'), Markup.inlineKeyboard([[await mainMenuButton()]]));
    }
  } catch (error: any) {
    console.error('Server status error:', error);
    await ctx.reply(
      await getText('status.error', { error: error.message }),
      Markup.inlineKeyboard([[await mainMenuButton()]])
    );
  }
}
