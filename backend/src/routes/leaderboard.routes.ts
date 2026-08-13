import { Router } from 'express';
import { getLeaderboard } from '../controllers/leaderboard.controller.js';

export const leaderboardRouter = Router();

leaderboardRouter.get('/', getLeaderboard);
