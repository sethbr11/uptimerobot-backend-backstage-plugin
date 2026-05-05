import type { LoggerService } from '@backstage/backend-plugin-api';
import { ConfigReader } from '@backstage/config';
import { UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION } from '../annotationDefaults';
import { MAX_UPTIME_GRAPH_DAYS, readPluginRuntimeConfig } from '../readPluginConfig';

function logger(): LoggerService {
  return { warn: jest.fn(), error: jest.fn() } as unknown as LoggerService;
}

describe('readPluginRuntimeConfig', () => {
  it('uses defaults when only apiKey is set', () => {
    const cfg = new ConfigReader({
      uptimerobot: { apiKey: 'k' },
    });
    const log = logger();
    const r = readPluginRuntimeConfig(cfg, log);

    expect(r.apiKey).toBe('k');
    expect(r.annotations.entityAnnotation).toBe(UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION);
    expect(r.graphs.dailyUptime.enabled).toBe(false);
    expect(r.graphs.dailyUptime.days).toBe(30);
    expect(r.graphs.responseTime.enabled).toBe(false);
    expect(r.graphs.responseTime.days).toBe(90);
    expect(r.cacheTtlMs).toBe(10 * 60 * 1000);
    expect(r.httpTimeoutMs).toBe(45_000);
    expect(r.monitorListPageLimit).toBe(50);
    expect(r.monitorListMaxPages).toBe(80);
    expect(r.debug).toBe(false);
  });

  it('reads custom annotation and list limits', () => {
    const cfg = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        catalog: { entityAnnotation: 'custom/uptime' },
        monitors: { listPageLimit: 10, listMaxPages: 3 },
        cacheTtlSeconds: 120,
        httpTimeoutSeconds: 12,
        debug: true,
      },
    });
    const r = readPluginRuntimeConfig(cfg, logger());
    expect(r.annotations.entityAnnotation).toBe('custom/uptime');
    expect(r.monitorListPageLimit).toBe(10);
    expect(r.monitorListMaxPages).toBe(3);
    expect(r.cacheTtlMs).toBe(120_000);
    expect(r.httpTimeoutMs).toBe(12_000);
    expect(r.debug).toBe(true);
  });

  it('clamps daily uptime days to API max and logs', () => {
    const log = logger();
    const cfg = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: true, days: 500 } },
      },
    });
    const r = readPluginRuntimeConfig(cfg, log);
    expect(r.graphs.dailyUptime.days).toBe(MAX_UPTIME_GRAPH_DAYS);
    expect(log.warn).toHaveBeenCalledWith(
      'uptimerobot graphs.dailyUptime.days out of range; clamping',
      expect.objectContaining({ raw: 500, used: MAX_UPTIME_GRAPH_DAYS }),
    );
  });

  it('falls back to default daily days when days is not an integer', () => {
    const log = logger();
    const cfg = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { dailyUptime: { enabled: true, days: 3.7 } },
      },
    });
    const r = readPluginRuntimeConfig(cfg, log);
    expect(r.graphs.dailyUptime.days).toBe(30);
    expect(log.warn).toHaveBeenCalledWith(
      'uptimerobot graphs.dailyUptime.days must be a finite integer; using default',
      expect.objectContaining({ raw: 3.7 }),
    );
  });

  it('enables response time when only days is set and clamps response time window', () => {
    const log = logger();
    const cfg = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { responseTime: { days: 500 } },
      },
    });
    const r = readPluginRuntimeConfig(cfg, log);
    expect(r.graphs.responseTime.enabled).toBe(true);
    expect(r.graphs.responseTime.days).toBe(90);
    expect(log.warn).toHaveBeenCalledWith(
      'uptimerobot graphs.responseTime.days out of range (API max 90); clamping',
      expect.objectContaining({ raw: 500 }),
    );
  });

  it('disables response time when config object has no days or enabled flag', () => {
    const cfg = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        graphs: { responseTime: {} },
      },
    });
    const r = readPluginRuntimeConfig(cfg, logger());
    expect(r.graphs.responseTime.enabled).toBe(false);
    expect(r.graphs.responseTime.days).toBe(90);
  });

  it('uses positive integer fallbacks for invalid monitor list settings', () => {
    const log = logger();
    const cfg = new ConfigReader({
      uptimerobot: {
        apiKey: 'k',
        monitors: { listPageLimit: -1, listMaxPages: 0 },
      },
    });
    const r = readPluginRuntimeConfig(cfg, log);
    expect(r.monitorListPageLimit).toBe(50);
    expect(r.monitorListMaxPages).toBe(80);
    expect(log.warn).toHaveBeenCalled();
  });
});
