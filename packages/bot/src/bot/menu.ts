import { Context } from 'telegraf';
import { sendMainMenu } from './start.js';

export async function handleMenu(ctx: Context, user: any) {
  await sendMainMenu(ctx, user);
}
