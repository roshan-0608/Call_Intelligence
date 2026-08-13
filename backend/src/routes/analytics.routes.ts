import { Router } from 'express';
import { getAnalytics } from '../controllers/analytics.controller.js';

export const analyticsRouter = Router();

analyticsRouter.get('/', getAnalytics);
