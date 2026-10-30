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
    if (!admin) fail(`admin "${username}" not found`);
    return admin;
  }

  const admins = await prisma.adminUser.findMany({ orderBy: { id: 'asc' } });
  if (admins.length === 0) fail('no admin accounts exist; run the seed first');
  return admins.find((admin) => admin.role === 'SUPER_ADMIN') || admins[0];
}

function printHelp() {
  console.log(`Usage:
  node admin-cli.mjs list
  node admin-cli.mjs username <new-name> [--user <current-name>]
  node admin-cli.mjs password <new-password | -> [--user <current-name>]

Pass - instead of a password to read it from stdin (safer).
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
      console.log('No admin accounts exist.');
      return;
    }
    for (const admin of admins) {
      console.log(
        `#${admin.id}  ${admin.username}  role=${admin.role}  active=${admin.isActive ? 'yes' : 'no'}`
      );
    }
    return;
  }

  if (command === 'username') {
    const next = String(args._[1] || '').trim();
    if (!USERNAME_PATTERN.test(next)) {
      fail('username must be 3-32 chars using only letters, digits, dot, dash or underscore');
    }

    const admin = await resolveAdmin(args.user);
    if (next !== admin.username) {
      const duplicate = await prisma.adminUser.findUnique({ where: { username: next } });
      if (duplicate) fail('that username is already taken');
      await prisma.adminUser.update({ where: { id: admin.id }, data: { username: next } });
    }

    console.log(`OK: admin username changed from "${admin.username}" to "${next}".`);
    return;
  }

  if (command === 'password') {
    const raw = String(args._[1] || '');
    const next = raw === '-' ? await readStdin() : raw;
    if (next.length < MIN_PASSWORD_LENGTH) {
      fail(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
    }

    const admin = await resolveAdmin(args.user);
    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { password: await bcrypt.hash(next, 10) },
    });

    console.log(`OK: password changed for admin "${admin.username}".`);
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
