import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEventWindow, getActiveNewsStatus } from '../src/news-radar.mjs';
import { analyzeCorrelationHeat, computeTrueNetBuffer, simulatePostPayoutLock } from '../src/risk-engine.mjs';
import { MyFundedPerpsClient, parseRetryAfterMs } from '../src/client.mjs';

test('news radar flags PREFLIGHT_WARN (-15m), ENTRY_LOCK (-10m), and HARD_LOCK (-2m to +2m)', () => {
  const base = Date.UTC(2026, 10, 26, 13, 30, 0);
  const cpi = { title: 'US CPI', impact: 'high', timestampUtc: new Date(base).toISOString() };

  assert.equal(evaluateEventWindow(cpi, base - 20 * 60000).status, 'CLEAR');
  assert.equal(evaluateEventWindow(cpi, base - 12 * 60000).status, 'PREFLIGHT_WARN');
  assert.equal(evaluateEventWindow(cpi, base - 8 * 60000).status, 'ENTRY_LOCK');
  assert.equal(evaluateEventWindow(cpi, base - 90 * 1000).status, 'HARD_LOCK');
  assert.equal(evaluateEventWindow(cpi, base + 90 * 1000).status, 'HARD_LOCK');
  assert.equal(evaluateEventWindow(cpi, base + 3 * 60000).status, 'CLEAR');

  const active = getActiveNewsStatus([cpi], base - 5 * 60000);
  assert.equal(active.status, 'ENTRY_LOCK');
});

test('true net buffer deducts funding and exit costs accurately', () => {
  const res = computeTrueNetBuffer({
    equity: 102000,
    startOfDayEquity: 102000,
    lossFloor: 96000,
    dailyLossLimit: 3000,
    accruedFunding: 50,
    estimatedExitCosts: 150,
  });

  assert.equal(res.trueNetEquity, 101800);
  assert.equal(res.dailyBuffer, 2800);
  assert.equal(res.bindingBuffer, 2800);
});

test('correlation heat detects multi-asset macro cluster risk exceeding 65% of buffer', () => {
  const warnings = analyzeCorrelationHeat(
    [
      { symbol: 'binance|BTCUSDT', side: 'long', notional: 50000, stopLossRisk: 1100 },
      { symbol: 'bybit|NQ100', side: 'long', notional: 40000, stopLossRisk: 1000 },
    ],
    2500
  );

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].cluster, 'RISK_ON');
  assert.equal(warnings[0].combinedRisk, 2100);
});

test('post-payout drawdown lock simulator calculates buffer shrink', () => {
  const sim = simulatePostPayoutLock({
    startingBalance: 100000,
    currentEquity: 106000,
    initialLossFloor: 96000,
    payoutAmount: 4000,
  });

  assert.equal(sim.prePayoutBuffer, 10000);
  assert.equal(sim.postPayoutBuffer, 2000);
  assert.equal(sim.bufferShrinkPct, 80);
});

test('REST client reuses Idempotency-Key and honors Retry-After on 429', async () => {
  let calls = 0;
  const seenKeys = [];
  const fakeFetch = async (_url, init) => {
    calls += 1;
    seenKeys.push(init.headers['Idempotency-Key']);
    if (calls === 1) {
      return { status: 429, headers: new Headers({ 'retry-after': '0' }), ok: false };
    }
    return { status: 200, ok: true, json: async () => ({ ok: true }) };
  };

  const client = new MyFundedPerpsClient({ apiKey: 'fp_test_dummy', fetchImpl: fakeFetch });
  const result = await client.cancelOrder('ord_123');
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.ok(seenKeys[0]);
  assert.equal(seenKeys[0], seenKeys[1]);
  assert.equal(parseRetryAfterMs('2'), 2000);
});


import { normalizeMacroEvents } from '../src/news-radar.mjs';
import { buildDashboardSnapshot, createPerpShieldServer, createRuntimeState } from '../src/server.mjs';

test('normalizeMacroEvents filters high-impact USD/EUR macro prints', () => {
  const events = normalizeMacroEvents([
    { title: 'CPI m/m', country: 'USD', impact: 'High', date: '2026-11-26T13:30:00Z' },
    { title: 'Minor Speech', country: 'JPY', impact: 'Low', date: '2026-11-26T14:00:00Z' },
  ]);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'USD CPI m/m');
});

test('server /api/state and /api/orders/cancel-flagged work end-to-end', async () => {
  const state = createRuntimeState();
  const snapshot = await buildDashboardSnapshot(state, { useLiveCalendar: false });
  assert.equal(snapshot.restingOrders.length, 2);

  const server = createPerpShieldServer(state);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    const res1 = await fetch(`http://127.0.0.1:${port}/api/state`);
    assert.equal(res1.status, 200);
    const body1 = await res1.json();
    assert.equal(body1.restingOrders.length, 2);

    const res2 = await fetch(`http://127.0.0.1:${port}/api/orders/cancel-flagged`, { method: 'POST' });
    assert.equal(res2.status, 200);
    const body2 = await res2.json();
    assert.equal(body2.cancelledCount, 2);

    const res3 = await fetch(`http://127.0.0.1:${port}/api/state`);
    const body3 = await res3.json();
    assert.equal(body3.restingOrders.length, 0);
  } finally {
    server.close();
  }
});
