import type { HttpAuthService, PermissionsService } from '@backstage/backend-plugin-api';
import { mockServices } from '@backstage/backend-test-utils';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import express from 'express';
import request from 'supertest';
import { createRouter } from '../router';
import type { UptimeRobotService } from '../services/UptimeRobotService';

function sampleStats() {
  return {
    chartDayCount: 30,
    display: {
      dailyUptime: false,
      dailyUptimeDays: 30,
      responseTime: false,
      responseTimeDays: 90,
    },
    monitor: {
      id: '1',
      name: 'Demo',
      url: 'https://example.com',
      status: 'Up',
    },
    uptime: {
      last24Hours: 100,
      last7Days: 99.9,
      last30Days: 99.5,
      last90Days: 99,
    },
    dailyUptime: [],
    incidents: [],
  };
}

describe('createRouter', () => {
  async function mountTestApp(
    overrides: Partial<{
      httpAuth: HttpAuthService;
      permissions: PermissionsService;
      uptimeRobot: Partial<UptimeRobotService>;
    }> = {},
  ) {
    const credentials = { principal: { type: 'user' as const, userEntityRef: 'user:default/guest' } };
    const httpAuth = {
      credentials: jest.fn().mockResolvedValue(credentials),
    } as unknown as HttpAuthService;

    const permissions = overrides.permissions ?? mockServices.permissions();

    const defaultUptimeRobot = {
      getDailyUptimeCacheStats: jest.fn().mockResolvedValue({
        records: 0,
        components: 0,
      }),
      getDailyUptimeForEntity: jest.fn().mockResolvedValue([]),
      getIncidentsForEntity: jest.fn().mockResolvedValue([]),
      getPublicHealth: jest.fn().mockResolvedValue({
        ok: true,
        status: 'ok',
        configured: false,
        detail: 'uptimerobot.apiKey not configured',
      }),
      getResponseTimeForEntity: jest.fn().mockResolvedValue(null),
      getStatsForEntity: jest.fn().mockResolvedValue(sampleStats()),
      getStatsSummaryForEntity: jest.fn().mockResolvedValue(sampleStats()),
      resetDailyUptimeCache: jest.fn().mockResolvedValue({ deleted: 2 }),
      resetDailyUptimeCacheForEntity: jest.fn().mockResolvedValue({ deleted: 1 }),
    };

    const uptimeRobot = {
      ...defaultUptimeRobot,
      ...overrides.uptimeRobot,
    } as UptimeRobotService;

    const router = await createRouter({
      httpAuth: overrides.httpAuth ?? httpAuth,
      permissions,
      uptimeRobot,
    });

    const app = express();
    app.use(express.json());
    app.use(router);
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        const name = err && typeof err === 'object' && 'name' in err ? (err as { name?: string }).name : '';
        let status = 500;
        if (name === 'InputError') status = 400;
        else if (name === 'NotAllowedError') status = 403;
        else if (name === 'NotFoundError') status = 404;
        const message = err instanceof Error ? err.message : String(err);
        res.status(status).json({ message });
      },
    );

    return { app, httpAuth, uptimeRobot };
  }

  it('GET /health returns ok', async () => {
    const { app } = await mountTestApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ok',
      configured: false,
    });
    expect(res.body.detail).toBeDefined();
  });

  it('GET /entity/:kind/:namespace/:name forwards entity ref and refresh flag', async () => {
    const { app, uptimeRobot } = await mountTestApp();
    const res = await request(app).get('/entity/component/default/my-service?refresh=true');

    expect(res.status).toBe(200);
    expect(uptimeRobot.getStatsForEntity).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.objectContaining({ refresh: true }),
    );
    expect(res.body.monitor.name).toBe('Demo');
  });

  it('GET progressive entity endpoints forward entity ref and refresh flag', async () => {
    const { app, uptimeRobot } = await mountTestApp();

    await request(app).get('/entity/component/default/my-service/summary?refresh=true').expect(200);
    await request(app).get('/entity/component/default/my-service/daily-uptime?refresh=true').expect(200);
    await request(app).get('/entity/component/default/my-service/response-time?refresh=true').expect(200);
    await request(app).get('/entity/component/default/my-service/incidents?refresh=true').expect(200);

    expect(uptimeRobot.getStatsSummaryForEntity).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.objectContaining({ refresh: true }),
    );
    expect(uptimeRobot.getDailyUptimeForEntity).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.objectContaining({ refresh: true }),
    );
    expect(uptimeRobot.getResponseTimeForEntity).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.objectContaining({ refresh: true }),
    );
    expect(uptimeRobot.getIncidentsForEntity).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.objectContaining({ refresh: true }),
    );
  });

  it('supports daily uptime cache stats and resets', async () => {
    const { app, uptimeRobot, httpAuth } = await mountTestApp();

    await request(app).get('/stats-cache/daily-uptime').expect(200, {
      records: 0,
      components: 0,
    });
    await request(app).delete('/stats-cache/daily-uptime').expect(200, {
      deleted: 2,
    });
    await request(app)
      .delete('/entity/component/default/my-service/daily-uptime-cache')
      .expect(200, { deleted: 1 });

    expect(uptimeRobot.getDailyUptimeCacheStats).toHaveBeenCalled();
    expect(uptimeRobot.resetDailyUptimeCache).toHaveBeenCalled();
    expect(uptimeRobot.resetDailyUptimeCacheForEntity).toHaveBeenCalledWith(
      'component:default/my-service',
      expect.any(Object),
    );
    expect(httpAuth.credentials).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ allow: ['user'] }),
    );
  });

  it('returns 400 when refresh query fails validation', async () => {
    const { app } = await mountTestApp();
    const res = await request(app).get('/entity/component/default/my-service?refresh[]=true');
    expect(res.status).toBe(400);
    expect(res.body.message).toBeDefined();
  });

  it('returns 403 when catalog entity read is denied', async () => {
    const permissions = {
      authorize: jest.fn().mockResolvedValue([{ result: AuthorizeResult.DENY }]),
    } as unknown as PermissionsService;
    const { app } = await mountTestApp({ permissions });
    const res = await request(app).get('/entity/component/default/my-service');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Not allowed to read catalog entity/);
  });

  it('returns 403 when cache read permission is denied', async () => {
    const permissions = {
      authorize: jest.fn().mockResolvedValue([{ result: AuthorizeResult.DENY }]),
    } as unknown as PermissionsService;
    const { app } = await mountTestApp({ permissions });
    const res = await request(app).get('/stats-cache/daily-uptime');
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cache statistics/);
  });

  it('returns 403 when cache reset permission is denied', async () => {
    const permissions = {
      authorize: jest.fn().mockResolvedValue([{ result: AuthorizeResult.DENY }]),
    } as unknown as PermissionsService;
    const { app } = await mountTestApp({ permissions });
    const res = await request(app).delete('/stats-cache/daily-uptime');
    expect(res.status).toBe(403);
  });

  it('returns 503 from health when upstream reports error', async () => {
    const { app, uptimeRobot } = await mountTestApp({
      uptimeRobot: {
        getDailyUptimeCacheStats: jest.fn(),
        getDailyUptimeForEntity: jest.fn(),
        getIncidentsForEntity: jest.fn(),
        getPublicHealth: jest.fn().mockResolvedValue({
          ok: false,
          status: 'error',
          configured: true,
          detail: 'rate limited',
        }),
        getResponseTimeForEntity: jest.fn(),
        getStatsForEntity: jest.fn(),
        getStatsSummaryForEntity: jest.fn(),
        resetDailyUptimeCache: jest.fn(),
        resetDailyUptimeCacheForEntity: jest.fn(),
      },
    });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: 'error', configured: true, detail: 'rate limited' });
    expect(uptimeRobot.getPublicHealth).toHaveBeenCalled();
  });

  it('returns null JSON for disabled response-time graph', async () => {
    const { app, uptimeRobot } = await mountTestApp({
      uptimeRobot: {
        getDailyUptimeCacheStats: jest.fn(),
        getDailyUptimeForEntity: jest.fn().mockResolvedValue([]),
        getIncidentsForEntity: jest.fn().mockResolvedValue([]),
        getPublicHealth: jest.fn(),
        getResponseTimeForEntity: jest.fn().mockResolvedValue(undefined),
        getStatsForEntity: jest.fn(),
        getStatsSummaryForEntity: jest.fn(),
        resetDailyUptimeCache: jest.fn(),
        resetDailyUptimeCacheForEntity: jest.fn(),
      },
    });
    const res = await request(app).get('/entity/component/default/my-service/response-time');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    expect(uptimeRobot.getResponseTimeForEntity).toHaveBeenCalled();
  });
});
