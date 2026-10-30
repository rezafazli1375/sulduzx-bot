import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  if (!process.env.ADMIN_PASSWORD) {
    console.warn('⚠️  ADMIN_PASSWORD تنظیم نشده است؛ رمز موقت admin123 استفاده می‌شود. بعد از اولین ورود آن را عوض کنید.');
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 10);

  await prisma.adminUser.upsert({
    where: { username: adminUsername },
    update: {},
    create: {
      username: adminUsername,
      password: hashedPassword,
      email: null,
      role: 'SUPER_ADMIN',
      isActive: true,
    },
  });

  const defaultSettings = [
    { key: 'bot_enabled', value: 'true', type: 'BOOLEAN', description: 'ربات فعال/غیرفعال' },
    { key: 'force_join_channels', value: 'true', type: 'BOOLEAN', description: 'عضویت اجباری در کانال‌ها' },
    { key: 'free_account_enabled', value: 'true', type: 'BOOLEAN', description: 'کانفیگ رایگان فعال' },
    { key: 'free_data_limit_gb', value: '1', type: 'NUMBER', description: 'محدودیت حجم رایگان (گیگابایت)' },
    { key: 'free_days_limit', value: '7', type: 'NUMBER', description: 'محدودیت زمان رایگان (روز)' },
    { key: 'free_config_limit_type', value: 'monthly', type: 'STRING', description: 'نوع محدودیت: daily, weekly, monthly, none' },
    { key: 'free_config_max_count', value: '1', type: 'NUMBER', description: 'حداکثر تعداد کانفیگ رایگان در دوره' },
    { key: 'referral_enabled', value: 'true', type: 'BOOLEAN', description: 'سیستم رفرال فعال' },
    { key: 'referral_reward_points', value: '100', type: 'NUMBER', description: 'امتیاز هر رفرال' },
    { key: 'points_enabled', value: 'true', type: 'BOOLEAN', description: 'سیستم امتیاز فعال' },
    { key: 'daily_checkin_points', value: '10', type: 'NUMBER', description: 'امتیاز ورود روزانه' },
    { key: 'support_enabled', value: 'true', type: 'BOOLEAN', description: 'پشتیبانی تیکت فعال' },
    { key: 'downloader_enabled', value: 'true', type: 'BOOLEAN', description: 'دانلودر فعال' },
    { key: 'max_download_size_mb', value: '50', type: 'NUMBER', description: 'حداکثر حجم دانلود (مگابایت)' },
    { key: 'max_downloads_per_day', value: '5', type: 'NUMBER', description: 'حداکثر تعداد دانلود در روز' },
    { key: 'welcome_message', value: 'به ربات سولدوز خوش آمدید! 🎉', type: 'STRING', description: 'پیام خوش‌آمدگویی' },
    { key: 'server_status_check', value: 'true', type: 'BOOLEAN', description: 'بررسی وضعیت سرور فعال' },
    { key: 'shop_enabled', value: 'true', type: 'BOOLEAN', description: 'فروشگاه فعال' },
    { key: 'voice_converter_enabled', value: 'true', type: 'BOOLEAN', description: 'تبدیل ویس و MP3 فعال' },
    { key: 'voice_convert_max_mb', value: '20', type: 'NUMBER', description: 'حداکثر حجم فایل صوتی (مگابایت)' },
    { key: 'voice_convert_max_seconds', value: '600', type: 'NUMBER', description: 'حداکثر مدت فایل صوتی (ثانیه)' },
    { key: 'panel_base_url', value: process.env.PANEL_BASE_URL || '', type: 'STRING', description: 'آدرس پنل x-ui' },
    { key: 'panel_username', value: process.env.PANEL_USERNAME || '', type: 'STRING', description: 'نام کاربری پنل x-ui' },
    { key: 'panel_password', value: process.env.PANEL_PASSWORD || '', type: 'STRING', description: 'رمز عبور پنل x-ui' },
    { key: 'panel_inbound_id', value: process.env.PANEL_INBOUND_ID || '11', type: 'NUMBER', description: 'شناسه اینباند کانفیگ' },
    { key: 'ytdlp_proxy_enabled', value: 'false', type: 'BOOLEAN', description: 'استفاده از پروکسی دستی دانلودر' },
    { key: 'ytdlp_proxy_url', value: '', type: 'STRING', description: 'آدرس پروکسی دستی (مثلاً socks5h://1.2.3.4:1080)' },
  ];

  for (const setting of defaultSettings) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      update: {},
      create: setting,
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
