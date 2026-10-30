import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret';
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

function signToken(admin: { id: number; username: string; role: string }) {
  return jwt.sign({ id: admin.id, username: admin.username, role: admin.role }, JWT_SECRET, {
    expiresIn: '24h',
  });
}

router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const admin = await prisma.adminUser.findUnique({ where: { id: req.adminId } });
    if (!admin) return res.status(404).json({ error: 'حساب کاربری پیدا نشد' });

    res.json({
      id: admin.id,
      username: admin.username,
      email: admin.email,
      role: admin.role,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
    });
  } catch (error) {
    console.error('Get account error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/username', async (req: AuthRequest, res: Response) => {
  try {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');

    if (!USERNAME_PATTERN.test(username)) {
      return res.status(400).json({
        error: 'نام کاربری باید ۳ تا ۳۲ نویسه و فقط شامل حروف انگلیسی، عدد، نقطه، خط تیره و زیرخط باشد',
      });
    }
    if (!password) {
      return res.status(400).json({ error: 'برای تغییر نام کاربری، رمز عبور فعلی الزامی است' });
    }

    const admin = await prisma.adminUser.findUnique({ where: { id: req.adminId } });
    if (!admin) return res.status(404).json({ error: 'حساب کاربری پیدا نشد' });

    if (!(await bcrypt.compare(password, admin.password))) {
      return res.status(401).json({ error: 'رمز عبور فعلی درست نیست' });
    }

    if (username !== admin.username) {
      const duplicate = await prisma.adminUser.findUnique({ where: { username } });
      if (duplicate) return res.status(409).json({ error: 'این نام کاربری قبلاً استفاده شده است' });

      await prisma.adminUser.update({ where: { id: admin.id }, data: { username } });
    }

    const updated = { id: admin.id, username, role: admin.role };
    res.json({
      success: true,
      token: signToken(updated),
      admin: { ...updated, email: admin.email },
    });
  } catch (error) {
    console.error('Change username error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/password', async (req: AuthRequest, res: Response) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'رمز عبور فعلی و جدید الزامی است' });
    }
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({
        error: `رمز عبور جدید باید حداقل ۸ نویسه باشد`,
      });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ error: 'رمز عبور جدید باید با رمز فعلی متفاوت باشد' });
    }

    const admin = await prisma.adminUser.findUnique({ where: { id: req.adminId } });
    if (!admin) return res.status(404).json({ error: 'حساب کاربری پیدا نشد' });

    if (!(await bcrypt.compare(currentPassword, admin.password))) {
      return res.status(401).json({ error: 'رمز عبور فعلی درست نیست' });
    }

    await prisma.adminUser.update({
      where: { id: admin.id },
      data: { password: await bcrypt.hash(newPassword, 10) },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const accountRouter = router;
