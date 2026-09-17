import express from 'express';
import path from 'node:path';
import config, { ROOT } from './config.js';
import {
  cookies, cors, errorHandler, loadSession, notFoundHandler,
  csrfProtection, rateLimit, requireAuth, securityHeaders,
} from './middleware.js';

import authRoutes from './routes/auth.js';
import accountRoutes from './routes/account.js';
import areaRoutes from './routes/areas.js';
import taskRoutes from './routes/tasks.js';
import projectRoutes from './routes/projects.js';
import objectiveRoutes, { milestoneRouter } from './routes/objectives.js';
import { notesRouter, eventsRouter } from './routes/notes.js';
import reminderRoutes, { notificationsRouter } from './routes/reminders.js';
import overviewRoutes from './routes/overview.js';
import calendarRoutes from './routes/calendar.js';
import insightRoutes from './routes/insights.js';
import searchRoutes from './routes/search.js';
import assistantRoutes from './routes/assistant.js';
import reflectionRoutes from './routes/reflections.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(securityHeaders);
  app.use(cors);
  app.use(cookies);

  // A bounded JSON body: oversized payloads are rejected before parsing.
  app.use(
    express.json({
      limit: '2mb',
      verify: (req, _res, buf) => {
        if (buf.length > 2 * 1024 * 1024) throw new Error('Payload too large');
      },
    })
  );

  app.use(loadSession);

  // A broad ceiling on API traffic; credential endpoints add tighter limits.
  app.use('/api', rateLimit({ windowMs: 60_000, max: 600, key: 'api' }));
  app.use('/api', csrfProtection);

  app.get('/api/health', (req, res) => res.json({ ok: true, name: 'TELOS' }));

  app.use('/api/auth', authRoutes);

  // Everything past this point requires an authenticated session. The guard is
  // mounted before the routers themselves, so no data route can be reached
  // without one.
  const guarded = express.Router();
  guarded.use(requireAuth);
  guarded.use('/account', accountRoutes);
  guarded.use('/areas', areaRoutes);
  guarded.use('/tasks', taskRoutes);
  guarded.use('/projects', projectRoutes);
  guarded.use('/objectives', objectiveRoutes);
  guarded.use('/milestones', milestoneRouter);
  guarded.use('/notes', notesRouter);
  guarded.use('/events', eventsRouter);
  guarded.use('/reminders', reminderRoutes);
  guarded.use('/notifications', notificationsRouter);
  guarded.use('/overview', overviewRoutes);
  guarded.use('/calendar', calendarRoutes);
  guarded.use('/insights', insightRoutes);
  guarded.use('/search', searchRoutes);
  guarded.use('/assistant', assistantRoutes);
  guarded.use('/reflections', reflectionRoutes);
  app.use('/api', guarded);

  app.use(notFoundHandler);

  // Static client. The SPA is served for any non-API path so deep links work.
  const publicDir = path.join(ROOT, 'public');
  app.use(
    express.static(publicDir, {
      index: false,
      etag: true,
      maxAge: config.isProduction ? '1h' : 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  app.use(errorHandler);
  return app;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href;

if (isMain) {
  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    console.log(`\n  TELOS — Live with intention. Move with purpose.`);
    console.log(`  Running at http://${config.host}:${config.port}  (${config.env})\n`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default createApp;
