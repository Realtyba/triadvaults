import { Router } from 'express';
import { DatabaseManager } from '../../db/index.js';

export const leaderboardRouter = Router();

leaderboardRouter.get('/', async (req, res) => {
  const leaderboard = await DatabaseManager.getLeaderboard();
  res.json({ success: true, leaderboard });
});
