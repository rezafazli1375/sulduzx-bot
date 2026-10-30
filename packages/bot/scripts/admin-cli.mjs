#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

const prisma = new PrismaClient();

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--user' || arg === '-u') args.user = argv[++i];
    else args._.push(arg);
  }
  return args;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

async function resolveAdmin(username) {
  if (username) {
    const admin = await prisma.adminUser.findUnique({ where: { username } });
    if (!admin) fail(`ادمین «${username}» پیدا نشد`);
    return admin;
  }

  const admins = await prisma.adminUser.findMany({ orderBy: { id: 'asc' } });
  if (admins.length === 0) fail('هیچ حساب ادمینی وجود ندارد؛ ابتدا seed را اجرا کنید');
  return admins.find((admin) => admin.role === 'SUPER_ADMIN') || admins[0];
}

function printHelp() {
  console.log(`استفاده:
  node admin-cli.mjs list
  node admin-cli.mjs username <نام-جدید> [--user <نام-فعلی>]
  node admin-cli.mjs password <رمز-جدید | -> [--user <نام-فعلی>]

اگر به‌جای رمز، - بدهید، رمز از stdin خوانده می‌شود (امن‌تر).
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'list') {
    const admins = await prisma.adminUser.findMany({ orderBy: { id: 'asc' } });
    if (admins.length === 0) {
      console.log('هیچ حساب ادمینی وجود ندارد.');
      return;
    }
    for (const admin of admins) {
      console.log(
        `#${admin.id}  ${admin.username}  نقش=${admin.role}  فعال=${admin.isActive ? 'بله' : 'خیر'}`
      );
    }
    return;
  }

  if (command === 'username') {
    const next = String(args._[1] || '').trim();
    if (!USERNAME_PATTERN.test(next)) {
      fail('نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد');
    }

    const admin = await resolveAdmin(args.user);
    if (next !== admin.username) {
      const duplicate = await prisma.adminUser.findUnique({ where: { username: next } });
      if (duplicate) fail('این نام کاربری قبلاً استفاده شده است');
      await prisma.adminUser.update({ where: { id: admin.id }, data: { username: next } });
    }

    console.log(`OK: نام کاربری مدیر از «${admin.username}» به «${next}» تغییر کرد.`);
    return;
  }

  if (command === 'password') {
    const raw = String(args._[1] || '');
    const next = raw === '-' ? await readStdin() : raw;
    if (next.length < MIN_PASSWORD_LENGTH) {
      fail(`رمز عبور باید حداقل ${MIN_PASSWORD_LENGTH} نویسه باشد`);
    }

    const admin = await resolveAdmin(args.user);
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { password: await bcrypt.hash(next, 10) },
    });

    console.log(`OK: رمز عبور مدیر «${admin.username}» تغییر کرد.`);
    return;
  }

  printHelp();
  process.exit(1);
}

main()
  .catch((error) => fail(error?.message || String(error)))
  .finally(async () => {
    await prisma.$disconnect();
  });
