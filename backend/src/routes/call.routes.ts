import { Router } from 'express';
import { getCallById, listCalls } from '../controllers/call.controller.js';

/** URL → controller. No logic lives here by design. */
export const callRouter = Router();

callRouter.get('/', listCalls);
callRouter.get('/:id', getCallById);
