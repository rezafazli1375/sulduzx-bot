import { prisma } from './prisma.js';
import { DEFAULT_TEXTS } from './bot-texts.js';

const cache = new Map<string, string>();
let loadedAt = 0;
const CACHE_TTL = 60_000;

async function loadCache() {
  if (cache.size > 0 && Date.now() - loadedAt < CACHE_TTL) return;

  const rows = await prisma.botText.findMany();
  cache.clear();
  for (const row of rows) cache.set(row.key, row.value);
  loadedAt = Date.now();
}

export function clearTextsCache(): void {
  cache.clear();
  loadedAt = 0;
}

export async function getText(
  key: string,
  vars?: Record<string, string | number>
): Promise<string> {
  await loadCache();

  let value = cache.get(key) ?? DEFAULT_TEXTS[key]?.value ?? key;

  if (vars) {
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.split(`{{${name}}}`).join(String(replacement));
    }
  }

  return value;
}

export async function ensureDefaultTexts(): Promise<void> {
  const existing = await prisma.botText.findMany({ select: { key: true } });
  const have = new Set(existing.map((row) => row.key));

  const missing = Object.entries(DEFAULT_TEXTS)
    .filter(([key]) => !have.has(key))
    .map(([key, text]) => ({ key, title: text.title, value: text.value }));

  if (missing.length > 0) {
    await prisma.botText.createMany({ data: missing, skipDuplicates: true });
    clearTextsCache();
  }
}
