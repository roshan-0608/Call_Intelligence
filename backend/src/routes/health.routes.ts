import { Router } from 'express';
import { getLiveness, getReadiness, getStats } from '../controllers/health.controller.js';

export const healthRouter = Router();

healthRouter.get('/live', getLiveness);
healthRouter.get('/ready', getReadiness);
healthRouter.get('/stats', getStats);
