'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config');
const slots = require('./lib/slots');
const { ApiError } = require('./lib/auth');
const { migrate, seedAdmin, waitForDatabase } = require('./lib/migrate');

const app = express();

// Bakom Caddy/Nginx – krävs för korrekt IP i rate limiting och loggar.
app.set('trust proxy', 1);

app.use(
  helmet({
    // Frontend och API ligger på samma origin, så en strikt CSP räcker.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(express.json({ limit: '100kb' }));
app.use(morgan(config.isProd ? 'combined' : 'dev'));

// CORS behövs bara när webben körs separat i utvecklingsläge.
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      callback(new ApiError(403, 'Otillåten origin.'));
    },
    credentials: true,
  })
);

// ---------------------------------------------------------------------
//  API
// ---------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    await require('./lib/db').query('SELECT 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'database_unavailable' });
  }
});

// Bokningsreglerna, så att appen aldrig hårdkodar tider på egen hand.
app.get('/api/config', (_req, res) => {
  res.json({
    slotTimes: slots.SLOT_TIMES.map((start) => ({ start, end: slots.endTimeOf(start) })),
    durationMinutes: slots.DURATION_MINUTES,
    horizonDays: slots.HORIZON_DAYS,
    today: slots.today(),
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api', require('./routes/availability'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/admin', require('./routes/admin'));

app.use('/api', (_req, _res, next) => next(new ApiError(404, 'Okänd adress.')));

// ---------------------------------------------------------------------
//  Webbappen serveras från samma server – en enda process, en enda domän,
//  inga CORS-problem och inget separat webbserverbygge.
// ---------------------------------------------------------------------
const webRoot = path.join(__dirname, '..', 'public');

if (fs.existsSync(webRoot)) {
  app.use(
    express.static(webRoot, {
      maxAge: config.isProd ? '1y' : 0,
      index: false,
      setHeaders(res, filePath) {
        // index.html och service worker får aldrig cachas, annars fastnar
        // användarna på en gammal version efter en uppdatering.
        if (/index\.html$|sw\.js$|manifest\.webmanifest$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );

  // Alla övriga adresser lämnas till klientens routing.
  app.get('*', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
} else {
  app.get('/', (_req, res) =>
    res.status(503).send('Webbappen är inte byggd. Kör "npm run build" i web/.')
  );
}

// ---------------------------------------------------------------------
//  Felhantering – ett enda ställe, alltid JSON för API-anrop
// ---------------------------------------------------------------------
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error('[fel]', err);

  const message =
    status >= 500 && config.isProd
      ? 'Något gick fel. Försök igen.'
      : err.message || 'Något gick fel.';

  res.status(status).json({ error: message, code: err.code });
});

// ---------------------------------------------------------------------
//  Uppstart
// ---------------------------------------------------------------------
async function start() {
  await waitForDatabase();
  await migrate();
  await seedAdmin();

  const server = app.listen(config.port, () => {
    console.log(`[server] lyssnar på port ${config.port} (${config.isProd ? 'produktion' : 'utveckling'})`);
  });

  const shutdown = (signal) => {
    console.log(`[server] ${signal} – stänger ner`);
    server.close(() => {
      require('./lib/db').pool.end(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start().catch((err) => {
  console.error('[server] kunde inte starta:', err);
  process.exit(1);
});
