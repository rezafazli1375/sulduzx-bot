import { Router, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { AuthRequest } from '../middleware/auth.js';

const router = Router();

// ─── List all game questions ─────────────────
router.get('/questions', async (req: AuthRequest, res: Response) => {
  try {
    const { gameType } = req.query;

    const where: any = {};
    if (gameType && typeof gameType === 'string') {
      where.gameType = gameType;
    }

    const questions = await prisma.gameQuestion.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });

    res.json(questions);
  } catch (error) {
    console.error('Get game questions error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Create a game question ──────────────────
router.post('/questions', async (req: AuthRequest, res: Response) => {
  try {
    const { gameType, text, optionA, optionB, optionC, optionD, answer, sortOrder } = req.body;

    if (!gameType || !text || !answer) {
      return res.status(400).json({ error: 'فیلدهای الزامی: gameType, text, answer' });
    }

    const question = await prisma.gameQuestion.create({
      data: {
        gameType,
        text,
        optionA: optionA || null,
        optionB: optionB || null,
        optionC: optionC || null,
        optionD: optionD || null,
        answer,
        sortOrder: sortOrder || 0,
      },
    });

    res.json(question);
  } catch (error) {
    console.error('Create game question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Update a game question ──────────────────
router.put('/questions/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { gameType, text, optionA, optionB, optionC, optionD, answer, isActive, sortOrder } = req.body;

    const question = await prisma.gameQuestion.update({
      where: { id: parseInt(id) },
      data: {
        gameType: gameType || undefined,
        text: text || undefined,
        optionA: optionA !== undefined ? optionA : undefined,
        optionB: optionB !== undefined ? optionB : undefined,
        optionC: optionC !== undefined ? optionC : undefined,
        optionD: optionD !== undefined ? optionD : undefined,
        answer: answer || undefined,
        isActive: isActive !== undefined ? isActive : undefined,
        sortOrder: sortOrder !== undefined ? sortOrder : undefined,
      },
    });

    res.json(question);
  } catch (error) {
    console.error('Update game question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Delete a game question ──────────────────
router.delete('/questions/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.gameQuestion.delete({
      where: { id: parseInt(id) },
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete game question error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get game statistics ─────────────────────
router.get('/stats', async (req: AuthRequest, res: Response) => {
  try {
    const [totalQuestions, activeSessions] = await Promise.all([
      prisma.gameQuestion.count(),
      prisma.gameSession.count({
        where: {
          status: { in: ['WAITING', 'ACTIVE'] },
          createdAt: {
            gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
          },
        },
      }),
    ]);

    const questionsByType = await prisma.gameQuestion.groupBy({
      by: ['gameType'],
      _count: { id: true },
      where: { isActive: true },
    });

    const finishedSessions = await prisma.gameSession.groupBy({
      by: ['gameType'],
      _count: { id: true },
      where: {
        status: 'FINISHED',
      },
    });

    res.json({
      totalQuestions,
      activeSessions,
      questionsByType: questionsByType.map((q) => ({
        type: q.gameType,
        count: q._count.id,
      })),
      finishedByType: finishedSessions.map((s) => ({
        type: s.gameType,
        count: s._count.id,
      })),
    });
  } catch (error) {
    console.error('Get game stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export const gamesRouter = router;
