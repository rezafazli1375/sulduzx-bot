import { Markup } from 'telegraf';
import { getText } from './texts.js';

export async function mainMenuButton() {
  return Markup.button.callback(await getText('button.main_menu'), 'main_menu');
}

export async function mainMenuKeyboard(extraRows: any[][] = []) {
  return Markup.inlineKeyboard([...extraRows, [await mainMenuButton()]]);
}

export function chunkColumns<T>(items: T[], columns = 2): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return rows;
}
