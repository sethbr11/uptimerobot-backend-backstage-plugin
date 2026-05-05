import type {
  BackstageCredentials,
  BackstageUserPrincipal,
  DatabaseService,
  LoggerService,
} from '@backstage/backend-plugin-api';
import { ConfigReader } from '@backstage/config';
import { UPTIMEROBOT_MONITOR_URL_ANNOTATION } from '../annotationDefaults';
import { InputError, NotFoundError } from '@backstage/errors';
import { UptimeRobotHttpError } from '../services/httpClient';
import { UptimeRobotService } from '../services/UptimeRobotService';
import { createInMemoryDatabaseService } from './inMemoryDatabaseTestUtils';

const mockMonitorList = jest.fn();
const mockGetUptimeStatistics = jest.fn();
const mockBuildUtcCalendarDayRanges = jest.fn();
const mockIncidentsList = jest.fn().mockResolvedValue([]);
const mockGetResponseTimeStatisticsByRegion = jest.fn().mockResolvedValue({
  all: {
    summary: { avg: 10, max: 20, min: 5 },
    time_series: [{ timestamp: '2026-05-01T00:00:00Z', value: 15 }],
  },
});

const guestCredentials = {
  principal: { type: 'user' as const, userEntityRef: 'user:default/guest' },
} as unknown as BackstageCredentials<BackstageUserPrincipal>;

jest.mock('uptime-robot-v3', () => ({
  UptimeRobotService: jest.fn().mockImplementation(() => ({
    incidents: {
      list: mockIncidentsList,
    },
    monitors: {
      getResponseTimeStatisticsByRegion: mockGetResponseTimeStatisticsByRegion,
      getUptimeStatistics: mockGetUptimeStatistics,
      list: mockMonitorList,
    },
    tools: {
      buildUtcCalendarDayRanges: mockBuildUtcCalendarDayRanges,
    },
  })),
}));

describe('UptimeRobotService.create', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  const catalog = {} as Parameters<typeof UptimeRobotService.create>[0]['catalog'];
  const database = {
    getClient: jest.fn(),
  } as unknown as DatabaseService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('accepts object-shaped graph config with disabled flags', () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'test-key',
        graphs: {
          dailyUptime: {
            enabled: false,
            days: 30,
          },
          responseTime: {
            enabled: false,
            days: 90,
          },
        },
      },
    });

    expect(() =>
      UptimeRobotService.create({
        catalog,
        config,
        database,
        logger,
      }),
    ).not.toThrow();
  });

  it('still accepts boolean graph shorthand', () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'test-key',
        graphs: {
          dailyUptime: true,
          responseTime: false,
        },
      },
    });

    expect(() =>
      UptimeRobotService.create({
        catalog,
        config,
        database,
        logger,
      }),
    ).not.toThrow();
  });
});

describe('UptimeRobotService daily uptime cache', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  const config = new ConfigReader({
    uptimerobot: {
      apiKey: 'test-key',
      graphs: {
        dailyUptime: {
          enabled: true,
          days: 2,
        },
        responseTime: {
          enabled: false,
        },
      },
    },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-02T12:00:00Z').getTime());
    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });
    mockBuildUtcCalendarDayRanges.mockImplementation((days: number) => {
      if (days === 90) {
        return [{ date: '2026-02-02', from: '2026-02-02T00:00:00Z', to: '2026-02-02T23:59:59Z' }];
      }
      return [
        { date: '2026-05-01', from: '2026-05-01T00:00:00Z', to: '2026-05-01T23:59:59Z' },
        { date: '2026-05-02', from: '2026-05-02T00:00:00Z', to: '2026-05-02T12:00:00Z' },
      ];
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reuses saved past days and refreshes only today', async () => {
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: {
            'backstage.io/uptimerobot': 'Demo',
          },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await service.getDailyUptimeForEntity('component:default/demo', { credentials: guestCredentials });
    expect(mockGetUptimeStatistics).toHaveBeenCalledTimes(2);

    await service.getDailyUptimeForEntity('component:default/demo', { credentials: guestCredentials });
    expect(mockGetUptimeStatistics).toHaveBeenCalledTimes(3);
    expect(mockGetUptimeStatistics.mock.calls[2][1]).toEqual({
      from: '2026-05-02T00:00:00Z',
      to: '2026-05-02T12:00:00Z',
    });
  });

  it('rethrows rate-limit errors from daily uptime API (mapped to UptimeRobotHttpError)', async () => {
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    mockGetUptimeStatistics.mockRejectedValueOnce(new Error('API Error (429): too many'));
    await expect(
      service.getDailyUptimeForEntity('component:default/demo', { credentials: guestCredentials }),
    ).rejects.toThrow(
      UptimeRobotHttpError,
    );
  });

  it('persists non-fatal daily fetch errors and continues other days', async () => {
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    mockGetUptimeStatistics.mockRejectedValueOnce(new Error('soft fail'));
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 88 });

    const rows = await service.getDailyUptimeForEntity('component:default/demo', {
      credentials: guestCredentials,
    });
    expect(rows.find(d => d.date === '2026-05-01')).toEqual(expect.objectContaining({ date: '2026-05-01' }));
    expect(rows.find(d => d.date === '2026-05-01')?.uptimeRatio).toBeUndefined();
    expect(rows.find(d => d.date === '2026-05-02')?.uptimeRatio).toBe(88);
    expect(logger.warn).toHaveBeenCalledWith(
      'Failed to fetch daily UptimeRobot stats',
      expect.objectContaining({ date: '2026-05-01' }),
    );
  });
});

describe('UptimeRobotService entity resolution and health', () => {
  const logger = {
    error: jest.fn(),
    warn: jest.fn(),
  } as unknown as LoggerService;

  const credentials = guestCredentials;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    mockMonitorList.mockReset();
    mockMonitorList.mockResolvedValue({ data: [], nextLink: null });
    mockIncidentsList.mockReset();
    mockIncidentsList.mockResolvedValue([]);
    mockGetResponseTimeStatisticsByRegion.mockReset();
    mockGetResponseTimeStatisticsByRegion.mockResolvedValue({
      all: {
        summary: { avg: 10, max: 20, min: 5 },
        time_series: [{ timestamp: '2026-05-01T00:00:00Z', value: 15 }],
      },
    });
  });

  it('throws InputError when api key is missing', async () => {
    const config = new ConfigReader({ uptimerobot: {} });
    const database = { getClient: jest.fn() } as unknown as DatabaseService;
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await expect(
      service.getStatsForEntity('component:default/demo', { credentials }),
    ).rejects.toThrow(InputError);
  });

  it('throws NotFoundError when catalog returns no entity', async () => {
    const config = new ConfigReader({ uptimerobot: { apiKey: 'k' } });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue(null),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await expect(
      service.getStatsForEntity('component:default/demo', { credentials }),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when no monitor matches the annotation name', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: false }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'MissingMonitor' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({ data: [], nextLink: null });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await expect(
      service.getStatsForEntity('component:default/demo', { credentials }),
    ).rejects.toThrow(NotFoundError);
  });

  it('reuses in-memory stats cache when refresh is false', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: false }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    const ref = 'component:default/demo';

    await service.getStatsForEntity(ref, { credentials, refresh: false });
    const afterFirst = mockGetUptimeStatistics.mock.calls.length;

    await service.getStatsForEntity(ref, { credentials, refresh: false });
    expect(mockGetUptimeStatistics.mock.calls.length).toBe(afterFirst);
  });

  it('getPublicHealth reports unconfigured when api key absent', async () => {
    const config = new ConfigReader({ uptimerobot: {} });
    const database = { getClient: jest.fn() } as unknown as DatabaseService;
    const catalog = {} as Parameters<typeof UptimeRobotService.create>[0]['catalog'];
    const service = UptimeRobotService.create({ catalog, config, database, logger });

    await expect(service.getPublicHealth()).resolves.toEqual({
      ok: true,
      status: 'ok',
      configured: false,
      detail: 'uptimerobot.apiKey not configured',
    });
    expect(mockMonitorList).not.toHaveBeenCalled();
  });

  it('getPublicHealth probes API when configured', async () => {
    const config = new ConfigReader({ uptimerobot: { apiKey: 'k' } });
    const { database } = createInMemoryDatabaseService();
    const catalog = {} as Parameters<typeof UptimeRobotService.create>[0]['catalog'];
    mockMonitorList.mockResolvedValue({ data: [{ id: 1 }], nextLink: null });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await expect(service.getPublicHealth()).resolves.toEqual({
      ok: true,
      status: 'ok',
      configured: true,
    });
  });

  it('getPublicHealth returns error payload when probe fails', async () => {
    const config = new ConfigReader({ uptimerobot: { apiKey: 'k' } });
    const { database } = createInMemoryDatabaseService();
    const catalog = {} as Parameters<typeof UptimeRobotService.create>[0]['catalog'];
    mockMonitorList.mockRejectedValueOnce(new Error('network down'));

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await expect(service.getPublicHealth()).resolves.toEqual({
      ok: false,
      status: 'error',
      configured: true,
      detail: 'network down',
    });
  });

  it('caches getStatsSummaryForEntity when refresh is false', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: false }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    const ref = 'component:default/demo';

    await service.getStatsSummaryForEntity(ref, { credentials, refresh: false });
    const afterFirst = mockGetUptimeStatistics.mock.calls.length;
    await service.getStatsSummaryForEntity(ref, { credentials, refresh: false });
    expect(mockGetUptimeStatistics.mock.calls.length).toBe(afterFirst);
  });

  it('returns response time chart when graph is enabled', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: {
          dailyUptime: { enabled: false },
          responseTime: { enabled: true, days: 7 },
        },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    const chart = await service.getResponseTimeForEntity('component:default/demo', { credentials });
    expect(chart).toMatchObject({
      windowDays: 7,
      avgMs: 10,
      maxMs: 20,
      minMs: 5,
    });
    expect(chart?.series?.length).toBeGreaterThan(0);
    expect(mockGetResponseTimeStatisticsByRegion).toHaveBeenCalled();
  });

  it('maps incidents from UptimeRobot', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: false }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });
    mockIncidentsList.mockResolvedValueOnce([
      {
        id: 42,
        type: 'Down',
        startedAt: '2026-04-01T10:00:00Z',
        duration: 30,
        reason: 'timeout',
      },
    ]);

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    const incidents = await service.getIncidentsForEntity('component:default/demo', { credentials });
    expect(incidents).toEqual([
      expect.objectContaining({
        id: '42',
        type: 'Down',
        reason: 'timeout',
      }),
    ]);
  });

  it('includes normalized monitor URL from catalog annotation', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: false }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          namespace: 'default',
          name: 'demo',
          annotations: {
            'backstage.io/uptimerobot': 'Demo',
            [UPTIMEROBOT_MONITOR_URL_ANNOTATION]: 'https://example.com/path/',
          },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://uptimerobot-target.example' }],
      nextLink: null,
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    const summary = await service.getStatsSummaryForEntity('component:default/demo', { credentials });
    expect(summary.monitor.url).toBe('https://example.com/path/');
  });

  it('ignores monitor URL annotation without http(s) scheme', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: false }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Component',
        metadata: {
          namespace: 'default',
          name: 'demo',
          annotations: {
            'backstage.io/uptimerobot': 'Demo',
            [UPTIMEROBOT_MONITOR_URL_ANNOTATION]: 'ftp://files.example/file',
          },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });

    const service = UptimeRobotService.create({ catalog, config, database, logger });
    const summary = await service.getStatsSummaryForEntity('component:default/demo', { credentials });
    expect(summary.monitor.url).toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('resetDailyUptimeCache clears stored rows', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: true, days: 2 }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockResolvedValue({
        metadata: {
          name: 'demo',
          annotations: { 'backstage.io/uptimerobot': 'Demo' },
        },
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockResolvedValue({
      data: [{ id: 1, friendlyName: 'Demo', status: 'UP', url: 'https://example.com' }],
      nextLink: null,
    });
    mockBuildUtcCalendarDayRanges.mockImplementation((days: number) => {
      if (days === 90) {
        return [{ date: '2026-02-02', from: '2026-02-02T00:00:00Z', to: '2026-02-02T23:59:59Z' }];
      }
      return [
        { date: '2026-05-01', from: '2026-05-01T00:00:00Z', to: '2026-05-01T23:59:59Z' },
        { date: '2026-05-02', from: '2026-05-02T00:00:00Z', to: '2026-05-02T12:00:00Z' },
      ];
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });

    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-02T12:00:00Z').getTime());
    const service = UptimeRobotService.create({ catalog, config, database, logger });
    await service.getDailyUptimeForEntity('component:default/demo', { credentials });
    expect((await service.getDailyUptimeCacheStats()).records).toBeGreaterThan(0);

    const { deleted } = await service.resetDailyUptimeCache();
    expect(deleted).toBeGreaterThan(0);
    expect((await service.getDailyUptimeCacheStats()).records).toBe(0);
    jest.restoreAllMocks();
  });

  it('resetDailyUptimeCacheForEntity clears rows for that entity only', async () => {
    const config = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: true, days: 1 }, responseTime: { enabled: false } },
      },
    });
    const { database } = createInMemoryDatabaseService();
    const catalog = {
      getEntityByRef: jest.fn().mockImplementation(async (ref: string) => {
        if (ref === 'component:default/a') {
          return {
            metadata: { name: 'a', annotations: { 'backstage.io/uptimerobot': 'MonA' } },
          };
        }
        if (ref === 'component:default/b') {
          return {
            metadata: { name: 'b', annotations: { 'backstage.io/uptimerobot': 'MonB' } },
          };
        }
        return null;
      }),
    } as unknown as Parameters<typeof UptimeRobotService.create>[0]['catalog'];

    mockMonitorList.mockImplementation(async (params: { name?: string }) => {
      const name = params?.name ?? '';
      if (name === 'MonA') {
        return { data: [{ id: 1, friendlyName: 'MonA', status: 'UP', url: 'https://a' }], nextLink: null };
      }
      if (name === 'MonB') {
        return { data: [{ id: 2, friendlyName: 'MonB', status: 'UP', url: 'https://b' }], nextLink: null };
      }
      return { data: [], nextLink: null };
    });
    mockBuildUtcCalendarDayRanges.mockImplementation((days: number) => {
      if (days === 90) {
        return [{ date: '2026-02-02', from: '2026-02-02T00:00:00Z', to: '2026-02-02T23:59:59Z' }];
      }
      return [{ date: '2026-05-02', from: '2026-05-02T00:00:00Z', to: '2026-05-02T12:00:00Z' }];
    });
    mockGetUptimeStatistics.mockResolvedValue({ uptime: 100 });

    jest.spyOn(Date, 'now').mockReturnValue(new Date('2026-05-02T12:00:00Z').getTime());
    const service = UptimeRobotService.create({ catalog, config, database, logger });

    await service.getDailyUptimeForEntity('component:default/a', { credentials });
    await service.getDailyUptimeForEntity('component:default/b', { credentials });
    expect((await service.getDailyUptimeCacheStats()).records).toBe(2);

    await service.resetDailyUptimeCacheForEntity('component:default/a', { credentials });
    const stats = await service.getDailyUptimeCacheStats();
    expect(stats.records).toBe(1);
    jest.restoreAllMocks();
  });
});
