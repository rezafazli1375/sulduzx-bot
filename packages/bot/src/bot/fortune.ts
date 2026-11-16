import { Context } from 'telegraf';
import { prisma } from '../lib/prisma.js';
import { getSetting, getSettingBool } from '../lib/settings.js';
import { faNum, pickBySeed, stableHash, tehranDateKey } from '../lib/utils.js';
import { mainMenuKeyboard } from '../lib/ui.js';

// ─── فال روز ─────────────────────────────────
// نسخهٔ ۲٫۰٫۰ — یک دکمهٔ «🔮 فال روز» در منوی اصلی.
//
// سه قانون طراحی:
// ۱) هر کاربر در هر *روز تهران* فقط یک فال می‌گیرد؛ بار دوم همان فال را
//    می‌بیند (نه فال جدید). روز از tehranDateKey می‌آید، نه نیمه‌شب سرور،
//    تا «امروز» برای کاربر ایرانی معنادار باشد.
// ۲) فال تصادفیِ خالص نیست: بر اساس (شناسهٔ کاربر + روز) *قطعی* انتخاب
//    می‌شود. همین باعث می‌شود اگر رکورد از دیتابیس پاک شد یا ربات ریستارت
//    شد، بازهم همان فالِ آن روز به همان کاربر برسد و کاربر حس «دوباره‌چرخیدن
//    قرعه» نگیرد.
// ۳) فال سرگرمی است، نه پیش‌بینی. هیچ توصیهٔ مالی/پزشکی/قانونی در متن نیست
//    و شمارهٔ روز و غزل هم فقط برای حال‌وهوای سنتی فال حافظ نوشته می‌شود.

interface FortuneEntry {
  /** بیت/سطرِ کوتاهِ حافظ‌وار — بعضی مصراع‌ها شناخته‌شده‌اند، بعضی ساختهٔ خودمان */
  verse: string;
  /** تعبیف کلی فال */
  meaning: string;
  /** راهنمای عملیِ بی‌خطر (کار، گفتگو، استراحت) */
  advice: string;
  /** یکی از حالت‌های روز */
  mood: 'خوب' | 'معتدل' | 'سنگین';
}

const FORTUNES: FortuneEntry[] = [
  {
    verse: 'ای دل مرهم ز دردها می‌خواهد / راهی به سوی روشنایی می‌خواهد',
    meaning: 'فالی که می‌گوید درِ بسته فقط «هنوز» باز نشده است.',
    advice: 'یک کار نیمه‌تمامِ کوچک را امروز تمام کن؛ تمام‌شده‌ها انرژی فردا را می‌سازند.',
    mood: 'خوب',
  },
  {
    verse: 'چرخ فلک بادت نکند آن چه قول بود / یادِ خوشی که در دل داری بس است',
    meaning: 'روزِ مرورِ خاطره‌های خوب، نه مقایسهٔ امروز با دیروز.',
    advice: 'با کسی که مدتی است بی‌خبرید یک پیام کوتاه رد و بدل کنید.',
    mood: 'معتدل',
  },
  {
    verse: 'صبر کن که سرِ صبرِ تو آید به‌وقت / هر دیرآیند را روزی باشد نزدیک',
    meaning: 'کند رفتن امروز به معنی نرسیدن نیست.',
    advice: 'خبرِ منتظره را امروز دنبال نکن؛ یک کار دیگر برایش باز بگذار.',
    mood: 'معتدل',
  },
  {
    verse: 'هر کجا روی بسازد دوست از رقیب / آنجا بشارتِ فتح و ظفر آید',
    meaning: 'یک گفت‌وگوی سخت امروز، گره‌ای را باز می‌کند که فکرش را نمی‌کنی.',
    advice: 'حرفی که در دل مانده را امروز و به‌آرامی بگو.',
    mood: 'خوب',
  },
  {
    verse: 'دوش وقت سحر از غصه نجاتم دادند / وگر نه این دل باز در حسرت می‌ماند',
    meaning: 'بارِ سنگینِ چند روز اخیر امروز سبک‌تر می‌شود.',
    advice: 'یک مسئولیت را که فقط از عادت حمل می‌کنی، امروز زمین بگذار.',
    mood: 'خوب',
  },
  {
    verse: 'چراغی که تو افروختی باز از ره تو بسوزد / دلی که تو شکستی باز از ره تو بشکافد',
    meaning: 'هر چه امروز بکاری، دیر یا زود از همان راه به تو برمی‌گردد.',
    advice: 'یک کمک کوچک به کسی بکن که فکر نمی‌کند تو باشی.',
    mood: 'معتدل',
  },
  {
    verse: 'مگر از دستِ روزگار چاره‌ای باشد / که باز چرخِ فلک را سواره‌ای باشد',
    meaning: 'روزِ طرح‌ریختن است، نه روزِ جنگیدن با آنچه در دست تو نیست.',
    advice: 'به‌جای یک تصمیم بزرگ، سه گزینه روی کاغذ بنویس و خوابشان کن.',
    mood: 'سنگین',
  },
  {
    verse: 'رسید مژده که ایامِ غم نخواهد ماند / چنان نمانَد و چنین نیز چنان نخواهد ماند',
    meaning: 'این دوره می‌گذرد؛ فال آرام‌بخشِ روزهای سخت.',
    advice: 'خواب و غذایت را امروز سرِ وقت نگه‌دار؛ بدنیت همین را می‌خواهد.',
    mood: 'خوب',
  },
  {
    verse: 'دل من آن طور که باید نشکسته است هنوز / وگرنه هر شکسته‌ای به در می‌رود',
    meaning: 'هنوز وقت داری؛ عجلهٔ امروز، پشیمانیِ فرداست.',
    advice: 'پاسخ «بله/نه» به یک پیشنهاد را امروز نده.',
    mood: 'سنگین',
  },
  {
    verse: 'هر که اسیرِ در بندِ موی شد / آزادش ندارند از بندِ مو',
    meaning: 'گیر کردن روی یک فکرِ کوچک، امروز هزینه‌اش بیشتر از همیشه است.',
    advice: 'گوشی را یک ساعت ببند و پیاده‌روی کوتاه برو.',
    mood: 'سنگین',
  },
  {
    verse: 'باغبانان به چمن چون رسیدند / سرایگران به گشن چون رسیدند',
    meaning: 'فصلِ کارِ تو رسیده؛ شکِ بیشتر، فرصتِ کمتر می‌سازد.',
    advice: 'همین امروز اولین قدمِ آن کار را بردار، هرچقدر هم کوچک.',
    mood: 'خوب',
  },
  {
    verse: 'قدرِ آنچه داری بدان و بس / که نادان‌ها هنوز راه نمی‌دانند',
    meaning: 'روزِ قدردانی؛ چیزی که داری را بشمار.',
    advice: 'سه چیز که همین حالا داری را بنویس؛ قبل از آرزو کردن.',
    mood: 'خوب',
  },
  {
    verse: 'مکن غره بر نعمت که ایام رو گرداند / دلی شاد و دستی باز داشته باش',
    meaning: 'امروز روزِ محتاط بودن در اوج است؛ غرور، چرخ را برگردان می‌کند.',
    advice: 'در یک مذاکره، یک قدم عقب برو و ببین طرف مقابل چه می‌کند.',
    mood: 'معتدل',
  },
  {
    verse: 'چرخ فلک کُند و ما بی‌خبریم / به زیرِ همین سقفِ ناآرامیم',
    meaning: 'آنچه نمی‌دانی امروز بیشتر از آنچه می‌دانی مؤثر است.',
    advice: 'قبل از قضاوتِ آن خبر، سؤال بپرس.',
    mood: 'سنگین',
  },
  {
    verse: 'مژده ای دل که اسیرِ عشق می‌رویم / چو طيرِ شوق بال و پر می‌کَنیم',
    meaning: 'انرژی امروز بالا است؛ وقتِ شروع، نه وقتِ چانه‌زنی.',
    advice: 'کاری که هفته‌ها پشت گوش انداختی را امروز در ده دقیقه شروع کن.',
    mood: 'خوب',
  },
  {
    verse: 'دو چشمِ من و یک دیدن بس نیست / که تا نبینی به هر دو دیده‌ات',
    meaning: 'زاویهٔ دیدت را عوض کن؛ پاسخ همین سؤال با دید دیگر فرق می‌کند.',
    advice: 'موضوع امروز را با یک نفر که مخالف است مرور کن.',
    mood: 'معتدل',
  },
  {
    verse: 'بیا تا گل برافشانیم و می در ساغر اندازیم / فلک را سقف بشکافیم و طرحی نو در اندازیم',
    meaning: 'روزِ ساختنِ طرحِ تازه، نه ادامهٔ طرحِ کهنه.',
    advice: 'یک عادت کاری که جواب نمی‌دهد را امروز کنار بگذار.',
    mood: 'خوب',
  },
  {
    verse: 'هر چه هست از باده‌های رنگی است / کاشکی این راز به یاری است',
    meaning: 'ظاهر امروز می‌تواند گمراه‌کننده باشد؛ ساده‌اش کن.',
    advice: 'پیچیده‌ترین بخشِ کارت را امروز به دو جمله کاهش بده.',
    mood: 'معتدل',
  },
  {
    verse: 'غفلتینه‌ای که روزِ حوصله کند / دلت را از غمِ فردا خالی کند',
    meaning: 'امروز نفس کشیدن واجب‌تر از دویدن است.',
    advice: 'یک کار امروز را حذف کن؛ نه فردا، امروز.',
    mood: 'معتدل',
  },
  {
    verse: 'ما را غمِ دیروز و اندوهی فردا بس / که شادیِ امروزِ ما به اندازهٔ یک نفس است',
    meaning: 'فالِ امروز می‌گوید کوچک گرفتنِ خوشی، خودش یک مهارت است.',
    advice: 'یک خوشی بی‌هزینه برای خودت بخر یا بساز.',
    mood: 'خوب',
  },
  {
    verse: 'چو دور گردون جز بی‌وفایی نمی‌کند / چرا دل بنده‌اش را تنگ نمی‌کنی',
    meaning: 'انتظارِ زیاد از آدم‌ها، امروز دلخوری می‌سازد.',
    advice: 'یک توقعِ بی‌زبان را امروز واضح بگو.',
    mood: 'سنگین',
  },
  {
    verse: 'نکن وعده که از وعده‌های تو / پیرِ مغان هم سرِ زنَد ای بسا',
    meaning: 'روزِ قول ندادن است؛ فقط قولِ قطعی بده.',
    advice: 'هر «باید ببینیم» امروز را به «نه» یا «بله» تبدیل کن.',
    mood: 'معتدل',
  },
  {
    verse: 'هر که با ما از روی وفا پیش آمد / ما نیز با او به قدرِ توان پیش آمدیم',
    meaning: 'امروز با تو مهربان‌اند اگر تو شروع کنی.',
    advice: 'ابتکارِ یک آشتی یا یک تشکر را امروز به دست بگیر.',
    mood: 'خوب',
  },
  {
    verse: 'ساقیا آمدنِ عید را بشارت ده / که دلِ خسته را باز به شادی بر گردان',
    meaning: 'یک خبرِ خوب در راه است؛ امروز زمینه‌اش را فراهم کن.',
    advice: 'هر چیزی که لازم داری، از الان یادداشت کن.',
    mood: 'خوب',
  },
];

const LUCKY_COLORS = ['سبز', 'آبی', 'کرم', 'زرشکی', 'نیلی', 'خاکستری', 'زرد', 'نارنجی'];
const LUCKY_DAYS = ['شما', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];
const SYMBOLS = ['🕯️', '🌱', '🪁', '🌊', '⭐️', '🔑', '🍃', '⛰️', '🌙', '☀️'];

const MOOD_BADGE: Record<FortuneEntry['mood'], string> = {
  خوب: '🟢 روزِ خوب',
  معتدل: '🟡 روزِ معمولی',
  سنگین: '🟠 روزِ احتیاط',
};

/**
 * ساختنِ متن فال. همه‌چیز از (userId + روزِ تهران) قابل محاسبه است، پس اگر
 * کاربر فالش را دوباره خواست، دقیقاً همان متن را می‌بیند.
 */
function buildFortune(userId: number, dateKey: string): { text: string; index: number } | null {
  const entry = pickBySeed(FORTUNES, `${userId}:${dateKey}`);
  if (!entry) return null;
  const index = FORTUNES.indexOf(entry);

  const seed = stableHash(`${dateKey}:${userId}`);
  const colour = LUCKY_COLORS[seed % LUCKY_COLORS.length];
  const symbol = SYMBOLS[Math.floor(seed / 7) % SYMBOLS.length];
  const day = LUCKY_DAYS[Math.floor(seed / 11) % LUCKY_DAYS.length];
  const luckyNumber = (seed % 26) + 3;
  // شمارهٔ «غزل» و «روز» فقط حال‌وهوای سنتی فال را می‌دهد؛ پشتشان هیچ چیزی نیست.
  const ghazal = (seed % 480) + 1;
  const falDay = ((seed >> 3) % 30) + 1;

  const text = [
    `🔮 *فال روز — ${dateKey}*`,
    '',
    `حافظ، غزل ${faNum(ghazal)}، فال ${faNum(falDay)}:`,
    '',
    `_${entry.verse}_`,
    '',
    `📖 *تعبیر:* ${entry.meaning}`,
    `🧭 *پیشنهاد امروز:* ${entry.advice}`,
    '',
    `${MOOD_BADGE[entry.mood]} | ${symbol} نماد: ${colour} | عدد شانس: ${faNum(luckyNumber)} | ${day}`,
    '',
    'این فال برای سرگرمی است و تصمیمی به جایی نمی‌دهد.',
  ].join('\n');

  return { text, index };
}

export async function handleFortune(ctx: Context, user: any) {
  const enabled = await getSettingBool('fortune_enabled');
  if (!enabled) {
    await ctx.reply('🔮 بخش فال روز در حال حاضر خاموش است.', await mainMenuKeyboard());
    return;
  }

  if (!user || typeof user.id !== 'number') {
    await ctx.reply('⚠️ برای گرفتن فال، اول ربات را /start کنید.', await mainMenuKeyboard());
    return;
  }

  const dateKey = tehranDateKey();
  const existing = await prisma.fortuneView
    .findFirst({ where: { userId: user.id, dateKey } })
    .catch(() => null);

  if (existing) {
    await ctx.reply(`${existing.text}\n\n⏳ امروز فال گرفته‌اید — فردا فال تازه می‌آید.`, {
      parse_mode: 'Markdown',
      ...(await mainMenuKeyboard()),
    });
    return;
  }

  const built = buildFortune(user.id, dateKey);
  if (!built) {
    await ctx.reply('🔮 فعلاً فال نمی‌شود؛ بعداً دوباره امتحان کنید.', await mainMenuKeyboard());
    return;
  }

  // رکوردِ «امروز فال گرفت» — کلید یکتا (userId, dateKey) اگر کسی هم‌زمان دو
  // بار دکمه را بزند، جلوی فالِ دوم را می‌گیرد.
  let created = true;
  try {
    await prisma.fortuneView.create({
      data: { userId: user.id, dateKey, text: built.text, index: built.index },
    });
  } catch {
    created = false;
    const again = await prisma.fortuneView
      .findFirst({ where: { userId: user.id, dateKey } })
      .catch(() => null);
    if (again) {
      await ctx.reply(`${again.text}\n\n⏳ امروز فال گرفته‌اید — فردا فال تازه می‌آید.`, {
        parse_mode: 'Markdown',
        ...(await mainMenuKeyboard()),
      });
      return;
    }
  }

  let bonusText = '';
  if (created) {
    const bonus = await fortuneRewardPoints();
    if (bonus > 0) {
      try {
        await prisma.$transaction([
          prisma.user.update({ where: { id: user.id }, data: { points: { increment: bonus } } }),
          prisma.pointTransaction.create({
            data: {
              userId: user.id,
              amount: bonus,
              type: 'BONUS',
              description: `فال روز ${dateKey}`,
            },
          }),
        ]);
        bonusText = `\n\n🎁 ${faNum(bonus)} امتیاز هم برای فال امروز گرفتی.`;
      } catch {}
    }
  }

  await ctx.reply(built.text + bonusText, {
    parse_mode: 'Markdown',
    ...(await mainMenuKeyboard()),
  });
}

/**
 * امتیاز فال روز. صفر یعنی امتیازی داده نشود؛ اگر سیستم امتیاز در پنل
 * خاموش باشد هم چیزی داده نمی‌شود (ورودیِ تنظیمِ سراسری).
 */
async function fortuneRewardPoints(): Promise<number> {
  const pointsEnabled = await getSettingBool('points_enabled');
  if (!pointsEnabled) return 0;
  const raw = await getSetting('fortune_points');
  const value = Number.parseInt(raw ?? '0', 10);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

/**
 * آیا کاربر امروز فال گرفته است؟ (برای نشان‌دادنِ «تازه» روی دکمه‌ی منو در
 * تست‌ها و گزارش‌ها استفاده می‌شود؛ خودِ منو به آن وابسته نیست.)
 */
export async function hasTodaysFortune(userId: number): Promise<boolean> {
  const found = await prisma.fortuneView
    .findFirst({ where: { userId, dateKey: tehranDateKey() } })
    .catch(() => null);
  return Boolean(found);
}

/** استخر فال‌ها — فقط برای تست: باید نه خالی باشد و نه تکراری */
export const FORTUNE_POOL_SIZE = FORTUNES.length;
