import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MyFundedPerpsClient } from './client.mjs';
import { fetchLiveMacroEvents, getActiveNewsStatus, getDemoMacroEvents } from './news-radar.mjs';
import { analyzeCorrelationHeat, computeTrueNetBuffer, simulatePostPayoutLock } from './risk-engine.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '../web/dist');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

/**
 * Create an in-memory PerpShield runtime state that works both with a live
 * MyFundedPerps sandbox/funded key and in interactive simulation mode.
 */
export function createRuntimeState(initialApiKey = process.env.FP_API_KEY || '') {
  return {
    apiKey: initialApiKey,
    mode: initialApiKey ? 'live' : 'sandbox-sim',
    connectedAccount: 'MyFundedPerps · 100K Select',
    account: {
      startingBalance: 100000,
      equity: 102650,
      startOfDayEquity: 102000,
      lossFloor: 96000,
      dailyLossLimit: 3060,
      accruedFunding: 42.8,
      estimatedExitCosts: 120.2,
    },
    positions: [
      { id: 'pos_1', symbol: 'binance|BTCUSDT', side: 'long', notional: 45000, stopLossRisk: 1150, unrealizedPnl: 480 },
      { id: 'pos_2', symbol: 'bybit|NQ100', side: 'long', notional: 40000, stopLossRisk: 1050, unrealizedPnl: 210 },
      { id: 'pos_3', symbol: 'hyperliquid|EURUSD', side: 'short', notional: 20000, stopLossRisk: 310, unrealizedPnl: -40 },
    ],
    restingOrders: [
      { id: 'ord_901', symbol: 'binance|BTCUSDT', side: 'buy', type: 'limit', size: 0.25, price: 91200 },
      { id: 'ord_902', symbol: 'bybit|NQ100', side: 'buy', type: 'limit', size: 1.0, price: 21140 },
    ],
    demoEventsAnchorMs: Date.now(),
    executionScore: 98,
    tiltStatus: 'Clear',
  };
}

/**
 * Build the full dashboard snapshot from current state + live macro calendar.
 */
export async function buildDashboardSnapshot(state, { useLiveCalendar = true } = {}) {
  const buffer = computeTrueNetBuffer(state.account);
  const correlationWarnings = analyzeCorrelationHeat(state.positions, buffer.bindingBuffer);

  let events = getDemoMacroEvents(state.demoEventsAnchorMs);
  if (useLiveCalendar) {
    const live = await fetchLiveMacroEvents();
    // Always keep at least one upcoming window visible if all weekly events already passed
    const activeLive = getActiveNewsStatus(live);
    if (activeLive.status !== 'CLEAR' || live.some((e) => Date.parse(e.timestampUtc) > Date.now())) {
      events = live;
    }
  }

  const news = getActiveNewsStatus(events);
  const payoutLock = simulatePostPayoutLock({
    startingBalance: state.account.startingBalance,
    currentEquity: state.account.equity,
    initialLossFloor: state.account.lossFloor,
    payoutAmount: 4000,
  });

  return {
    mode: state.mode,
    connectedAccount: state.connectedAccount,
    timestamp: new Date().toISOString(),
    buffer,
    news,
    events: events.slice(0, 8),
    positions: state.positions,
    restingOrders: state.restingOrders,
    correlationWarnings,
    payoutLock,
    executionScore: state.executionScore,
    tiltStatus: state.tiltStatus,
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 65536) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
}

export function createPerpShieldServer(state = createRuntimeState()) {
  const sseClients = new Set();

  const broadcastState = async () => {
    if (sseClients.size === 0) return;
    const snapshot = await buildDashboardSnapshot(state);
    const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of sseClients) {
      res.write(payload);
    }
  };

  const applyAccountPayload = (accountsRes) => {
    const list = Array.isArray(accountsRes?.data)
      ? accountsRes.data
      : Array.isArray(accountsRes?.accounts)
        ? accountsRes.accounts
        : Array.isArray(accountsRes)
          ? accountsRes
          : [];
    const first = list[0];
    if (!first) return;
    state.connectedAccount = `${first.name || first.plan || 'MyFundedPerps'} (${first.id || 'Sandbox'})`;
    const eq = Number(first.equity ?? first.balance);
    if (!Number.isNaN(eq) && eq > 0) state.account.equity = eq;
    const sod = Number(first.start_of_day_equity ?? first.startOfDayEquity ?? eq);
    if (!Number.isNaN(sod) && sod > 0) state.account.startOfDayEquity = sod;
    const lf = Number(first.loss_floor ?? first.lossFloor ?? first.max_loss_floor);
    if (!Number.isNaN(lf) && lf >= 0) state.account.lossFloor = lf;
    const dll = Number(first.daily_loss_limit ?? first.dailyLossLimit);
    if (!Number.isNaN(dll) && dll > 0) state.account.dailyLossLimit = dll;
  };

  let stopWs = null;
  if (state.apiKey) {
    const client = new MyFundedPerpsClient({
      apiKey: state.apiKey,
      baseUrl: process.env.FP_BASE_URL,
      wsUrl: process.env.FP_WS_URL,
    });
    client
      .getAccounts()
      .then((res) => {
        applyAccountPayload(res);
        return broadcastState();
      })
      .catch((err) => {
        console.warn('[PerpShield] Initial account sync warning:', err.message);
      });

    stopWs = client.connectAccountStream(
      (event) => {
        if (event?.equity) state.account.equity = Number(event.equity);
        broadcastState().catch(() => {});
      },
      (err) => {
        console.warn('[PerpShield] WS stream notice:', err.message);
      }
    );
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      const snapshot = await buildDashboardSnapshot(state);
      return sendJson(res, 200, snapshot);
    }

    if (req.method === 'GET' && url.pathname === '/api/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      sseClients.add(res);
      const snapshot = await buildDashboardSnapshot(state);
      res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/orders/cancel-flagged') {
      const cancelled = [...state.restingOrders];
      if (state.apiKey && state.mode === 'live') {
        const client = new MyFundedPerpsClient({ apiKey: state.apiKey });
        for (const ord of cancelled) {
          await client.cancelOrder(ord.id).catch(() => {});
        }
      }
      state.restingOrders = [];
      await broadcastState();
      return sendJson(res, 200, { ok: true, cancelledCount: cancelled.length, cancelled });
    }

    if (req.method === 'POST' && url.pathname === '/api/simulate-lock') {
      const body = await readJsonBody(req);
      const sim = simulatePostPayoutLock({
        startingBalance: Number(body.startingBalance ?? state.account.startingBalance),
        currentEquity: Number(body.currentEquity ?? state.account.equity),
        initialLossFloor: Number(body.initialLossFloor ?? state.account.lossFloor),
        payoutAmount: Number(body.payoutAmount ?? 4000),
      });
      return sendJson(res, 200, sim);
    }

    if (req.method === 'POST' && url.pathname === '/api/connect') {
      const body = await readJsonBody(req);
      const apiKey = String(body.apiKey || '').trim();
      if (!apiKey) {
        return sendJson(res, 400, { error: 'API key is required' });
      }
      try {
        const client = new MyFundedPerpsClient({ apiKey });
        const accounts = await client.getAccounts();
        state.apiKey = apiKey;
        state.mode = 'live';
        const first = Array.isArray(accounts?.data) ? accounts.data[0] : null;
        if (first) {
          state.connectedAccount = `${first.name || 'MyFundedPerps'} (${first.id || 'Live'})`;
          if (typeof first.equity === 'number') state.account.equity = first.equity;
          if (typeof first.loss_floor === 'number') state.account.lossFloor = first.loss_floor;
        }
        await broadcastState();
        return sendJson(res, 200, { ok: true, mode: 'live', connectedAccount: state.connectedAccount });
      } catch (err) {
        return sendJson(res, 400, { error: err instanceof Error ? err.message : 'Failed to connect' });
      }
    }

    // Serve built React frontend
    if (fs.existsSync(DIST_DIR)) {
      let filePath = path.join(DIST_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(DIST_DIR, 'index.html');
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
      return fs.createReadStream(filePath).pipe(res);
    }

    return sendJson(res, 404, { error: 'Frontend not built. Run `npm run web:build` first.' });
  });

  const ticker = setInterval(() => {
    broadcastState().catch(() => {});
  }, 1000);
  server.on('close', () => {
    clearInterval(ticker);
    stopWs?.();
  });

  return server;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const port = Number(process.env.PORT || 3030);
  const server = createPerpShieldServer();
  server.listen(port, () => {
    console.log(`🛡️  PerpShield Dashboard & API running at http://localhost:${port}`);
  });
}
