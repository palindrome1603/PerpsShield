/**
 * Red-Folder Macro News Blackout Radar for MyFundedPerps funded accounts:
 * - Entry Lock:   10 minutes before to 2 minutes after (no opening/adding/reversing)
 * - Hard Lock:     2 minutes before to 2 minutes after (no manual trades, including closing)
 * - Pre-Flight:   15 minutes before (early warning for resting limit orders & open exposure)
 */

export const NEWS_WINDOWS_MS = {
  PREFLIGHT: 15 * 60 * 1000,
  ENTRY_LOCK_BEFORE: 10 * 60 * 1000,
  HARD_LOCK_BEFORE: 2 * 60 * 1000,
  LOCK_AFTER: 2 * 60 * 1000,
};

const CALENDAR_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
let cachedCalendar = { fetchedAt: 0, events: null };
const CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Evaluate the blackout status of a macro event relative to `nowMs`.
 * @param {{ title: string, impact: string, timestampUtc: string }} event
 * @param {number} [nowMs]
 */
export function evaluateEventWindow(event, nowMs = Date.now()) {
  if (event.impact?.toLowerCase() !== 'high') {
    return { status: 'CLEAR', minutesToEvent: null, event };
  }

  const eventMs = Date.parse(event.timestampUtc);
  if (Number.isNaN(eventMs)) {
    throw new Error(`Invalid event timestampUtc: ${event.timestampUtc}`);
  }

  const deltaMs = eventMs - nowMs;
  const minutesToEvent = Math.round((deltaMs / 60000) * 10) / 10;

  if (deltaMs < 0 && Math.abs(deltaMs) <= NEWS_WINDOWS_MS.LOCK_AFTER) {
    return { status: 'HARD_LOCK', minutesToEvent, event };
  }

  if (deltaMs >= 0 && deltaMs <= NEWS_WINDOWS_MS.HARD_LOCK_BEFORE) {
    return { status: 'HARD_LOCK', minutesToEvent, event };
  }

  if (deltaMs > NEWS_WINDOWS_MS.HARD_LOCK_BEFORE && deltaMs <= NEWS_WINDOWS_MS.ENTRY_LOCK_BEFORE) {
    return { status: 'ENTRY_LOCK', minutesToEvent, event };
  }

  if (deltaMs > NEWS_WINDOWS_MS.ENTRY_LOCK_BEFORE && deltaMs <= NEWS_WINDOWS_MS.PREFLIGHT) {
    return { status: 'PREFLIGHT_WARN', minutesToEvent, event };
  }

  return { status: 'CLEAR', minutesToEvent, event };
}

/**
 * Scan a list of scheduled macro events and return the highest-severity active window.
 * @param {Array<{ title: string, impact: string, timestampUtc: string }>} events
 * @param {number} [nowMs]
 */
export function getActiveNewsStatus(events, nowMs = Date.now()) {
  const priority = { HARD_LOCK: 3, ENTRY_LOCK: 2, PREFLIGHT_WARN: 1, CLEAR: 0 };
  let highest = { status: 'CLEAR', minutesToEvent: null, event: null };

  for (const event of events) {
    const result = evaluateEventWindow(event, nowMs);
    if (priority[result.status] > priority[highest.status]) {
      highest = result;
    }
  }
  return highest;
}

/**
 * Normalize raw ForexFactory-style JSON into PerpShield high-impact macro events.
 * @param {Array<any>} raw
 */
export function normalizeMacroEvents(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item?.impact === 'High' && (item?.country === 'USD' || item?.country === 'EUR'))
    .map((item) => ({
      title: `${item.country} ${item.title}`,
      impact: 'high',
      country: item.country,
      timestampUtc: new Date(item.date).toISOString(),
    }))
    .filter((item) => !Number.isNaN(Date.parse(item.timestampUtc)));
}

/**
 * Fetch live weekly high-impact macro calendar (cached for 15 minutes),
 * falling back to demo events if offline or rate-limited.
 */
export async function fetchLiveMacroEvents(fetchImpl = fetch) {
  const now = Date.now();
  if (cachedCalendar.events && now - cachedCalendar.fetchedAt < CACHE_TTL_MS) {
    return cachedCalendar.events;
  }

  try {
    const res = await fetchImpl(CALENDAR_URL, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Calendar HTTP ${res.status}`);
    const raw = await res.json();
    const events = normalizeMacroEvents(raw);
    if (events.length > 0) {
      cachedCalendar = { fetchedAt: now, events };
      return events;
    }
  } catch {
    // Fallback cleanly to deterministic demo events when offline
  }

  return getDemoMacroEvents(now);
}

/**
 * Sample high-impact events for local demo/dry-run mode.
 * @param {number} [nowMs]
 */
export function getDemoMacroEvents(nowMs = Date.now()) {
  return [
    {
      title: 'US CPI (MoM & YoY)',
      impact: 'high',
      country: 'USD',
      timestampUtc: new Date(nowMs + 9 * 60 * 1000 + 14 * 1000).toISOString(),
    },
    {
      title: 'FOMC Rate Decision',
      impact: 'high',
      country: 'USD',
      timestampUtc: new Date(nowMs + 4 * 60 * 60 * 1000).toISOString(),
    },
    {
      title: 'US Initial Jobless Claims',
      impact: 'high',
      country: 'USD',
      timestampUtc: new Date(nowMs + 26 * 60 * 60 * 1000).toISOString(),
    },
  ];
}
