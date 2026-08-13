import { Router } from 'express';
import { uploadTranscript } from '../controllers/upload.controller.js';
import { uploadLimiter } from '../middlewares/rateLimit.js';

/**
 * The rate limiter is attached here rather than in `app.ts` so the constraint
 * lives next to the route it protects — this is the only endpoint that spends
 * money per request.
 */
export const uploadRouter = Router();

uploadRouter.post('/', uploadLimiter, uploadTranscript);
