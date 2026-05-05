import type { PluginRuntimeConfig } from '../readPluginConfig';
import type { Incident } from 'uptime-robot-v3';
import {
  buildRelativeIsoDate,
  getStatusLabel,
  getUptimeRatio,
  parseNextMonitorListCursor,
  toBasicIncident,
  toGraphDisplay,
} from '../services/utils';

describe('parseNextMonitorListCursor', () => {
  it('returns undefined for empty, null, or literal null', () => {
    expect(parseNextMonitorListCursor(undefined)).toBeUndefined();
    expect(parseNextMonitorListCursor(null)).toBeUndefined();
    expect(parseNextMonitorListCursor('')).toBeUndefined();
    expect(parseNextMonitorListCursor('   ')).toBeUndefined();
    expect(parseNextMonitorListCursor('null')).toBeUndefined();
    expect(parseNextMonitorListCursor('NULL')).toBeUndefined();
  });

  it('parses absolute URL cursor', () => {
    expect(
      parseNextMonitorListCursor('https://api.uptimerobot.com/v3/monitors?cursor=42'),
    ).toBe(42);
  });

  it('parses relative next link against UptimeRobot base', () => {
    expect(parseNextMonitorListCursor('/v3/monitors?cursor=7')).toBe(7);
  });

  it('returns undefined when cursor param missing or non-numeric', () => {
    expect(parseNextMonitorListCursor('https://api.uptimerobot.com/v3/monitors')).toBeUndefined();
    expect(parseNextMonitorListCursor('https://api.uptimerobot.com/v3/monitors?cursor=abc')).toBeUndefined();
  });

  it('returns undefined on malformed URL', () => {
    expect(parseNextMonitorListCursor('://bad')).toBeUndefined();
  });
});

describe('toGraphDisplay', () => {
  it('maps graph flags and day counts', () => {
    const runtime = {
      graphs: {
        dailyUptime: { enabled: true, days: 14 },
        responseTime: { enabled: false, days: 60 },
      },
    } as PluginRuntimeConfig;

    expect(toGraphDisplay(runtime)).toEqual({
      dailyUptime: true,
      dailyUptimeDays: 14,
      responseTime: false,
      responseTimeDays: 60,
    });
  });
});

describe('buildRelativeIsoDate', () => {
  it('returns an ISO string in the past', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-06-01T00:00:00.000Z').getTime());
    const iso = buildRelativeIsoDate(1);
    expect(iso.startsWith('2026-05-')).toBe(true);
    jest.restoreAllMocks();
  });
});

describe('getUptimeRatio', () => {
  it('prefers uptime then overallUptime', () => {
    expect(getUptimeRatio({ uptime: 99 } as Parameters<typeof getUptimeRatio>[0])).toBe(99);
    expect(
      getUptimeRatio({ overallUptime: 88 } as unknown as Parameters<typeof getUptimeRatio>[0]),
    ).toBe(88);
  });
});

describe('getStatusLabel', () => {
  it.each([
    ['UP', 'Up'],
    ['down', 'Down'],
    ['PAUSED', 'Paused'],
    ['SEEMS_DOWN', 'Seems down'],
    ['NOT_CHECKED_YET', 'Not checked yet'],
    ['NOT CHECKED YET', 'Not checked yet'],
  ])('maps %s to %s', (input, expected) => {
    expect(getStatusLabel(input as 'UP')).toBe(expected);
  });

  it('reads name/value from object-shaped status', () => {
    expect(getStatusLabel({ name: 'up' } as never)).toBe('Up');
    expect(getStatusLabel({ value: 'DOWN' } as never)).toBe('Down');
  });

  it('returns Unknown for empty input', () => {
    expect(getStatusLabel(undefined)).toBe('Unknown');
  });

  it('returns raw label for unknown string status', () => {
    expect(getStatusLabel('CUSTOM' as never)).toBe('CUSTOM');
  });
});

describe('toBasicIncident', () => {
  it('maps incident fields with defaults', () => {
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-01-01T00:00:00Z').getTime());
    const incident = {
      id: 9,
      type: 'Timeout',
      startedAt: '2026-01-02T00:00:00Z',
      duration: 120,
      reason: 'conn reset',
    } as unknown as Incident;

    expect(toBasicIncident(incident)).toEqual({
      id: '9',
      type: 'Timeout',
      startedAt: '2026-01-02T00:00:00Z',
      durationSeconds: 120,
      reason: 'conn reset',
    });
    jest.restoreAllMocks();
  });

  it('defaults type and startedAt when missing', () => {
    jest.useFakeTimers({ now: new Date('2026-01-05T12:00:00.000Z') });
    const incident = { id: 1 } as unknown as Incident;
    const out = toBasicIncident(incident);
    expect(out.type).toBe('Incident');
    expect(out.startedAt).toBe('2026-01-05T12:00:00.000Z');
    jest.useRealTimers();
  });
});
