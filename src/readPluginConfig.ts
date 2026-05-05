import type { Config } from '@backstage/config';
import type { LoggerService } from '@backstage/backend-plugin-api';
import { UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION } from './annotationDefaults';

// ////////////////////////////////////////
//           CONSTANTS AND TYPES         //
// ////////////////////////////////////////

const DEFAULT_DAILY_UPTIME_DAYS = 30;
const DEFAULT_RESPONSE_TIME_DAYS = 90;
const MIN_GRAPH_DAYS = 1;
/** API / UI max for daily uptime; also the DB retention window so widening the graph does not lose history. */
export const MAX_UPTIME_GRAPH_DAYS = 90;
const MAX_RESPONSE_TIME_DAYS = 90;

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_HTTP_TIMEOUT_MS = 45_000;
const DEFAULT_MONITOR_LIST_PAGE_LIMIT = 50;
const DEFAULT_MONITOR_LIST_MAX_PAGES = 80;

/** Single catalog annotation: monitor selector (see annotationDefaults)
 * 
 * @property entityAnnotation - The catalog annotation to use to select the monitor.
*/
export type EntityAnnotationConfig = {
  entityAnnotation: string;
};

/** Configuration for a single graph.
 * 
 * @property enabled - Whether the graph is enabled.
 * @property days - The number of days to include in the graph.
 * @internal
 */
type graphConfig = {
  enabled: boolean;
  days: number;
};

/** Runtime configuration for the UptimeRobot graphs
 * 
 * @property dailyUptime - The configuration for the daily uptime graph.
 * @property responseTime - The configuration for the response time graph.
*/
type GraphRuntimeConfig = {
  dailyUptime: graphConfig;
  responseTime: graphConfig;
};

/** Runtime configuration for the UptimeRobot plugin.
 * 
 * @property apiKey - The API key to use to access the UptimeRobot API.
 * @property annotations - The catalog annotation to use to select the monitor.
 * @property graphs - The configuration for the graphs.
 * @property cacheTtlMs - The cache TTL in milliseconds.
 * @property httpTimeoutMs - The HTTP timeout in milliseconds.
 * @property monitorListPageLimit - The page limit for the monitor list.
 * @property monitorListMaxPages - The maximum number of pages to walk when searching by name.
 * @property debug - Whether to enable debug logging.
*/
export type PluginRuntimeConfig = {
  apiKey?: string;
  annotations: EntityAnnotationConfig;
  graphs: GraphRuntimeConfig;
  cacheTtlMs: number;
  httpTimeoutMs: number;
  monitorListPageLimit: number;
  monitorListMaxPages: number;
  debug: boolean;
};

// ////////////////////////////////////////
//             MAIN FUNCTION             //
// ////////////////////////////////////////

/** Reads all runtime options for the UptimeRobot backend plugin from root config.
 * 
 * @param config - The configuration to read from.
 * @param logger - The logger to use to log the warning.
 * @returns The runtime configuration for the UptimeRobot plugin.
*/
export function readPluginRuntimeConfig(
  config: Config,
  logger: LoggerService,
): PluginRuntimeConfig {
  const graphs = readGraphRuntimeConfig(config, logger);

  const cacheTtlSeconds = readPositiveInt(
    config,
    'uptimerobot.cacheTtlSeconds',
    DEFAULT_CACHE_TTL_MS / 1000,
    logger,
    'uptimerobot.cacheTtlSeconds',
  );
  const httpTimeoutSeconds = readPositiveInt(
    config,
    'uptimerobot.httpTimeoutSeconds',
    DEFAULT_HTTP_TIMEOUT_MS / 1000,
    logger,
    'uptimerobot.httpTimeoutSeconds',
  );

  return {
    apiKey: config.getOptionalString('uptimerobot.apiKey'),
    annotations: {
      entityAnnotation:
        config.getOptionalString('uptimerobot.catalog.entityAnnotation') ??
        UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION,
    },
    graphs,
    cacheTtlMs: cacheTtlSeconds * 1000,
    httpTimeoutMs: httpTimeoutSeconds * 1000,
    monitorListPageLimit: readPositiveInt(
      config,
      'uptimerobot.monitors.listPageLimit',
      DEFAULT_MONITOR_LIST_PAGE_LIMIT,
      logger,
      'uptimerobot.monitors.listPageLimit',
    ),
    monitorListMaxPages: readPositiveInt(
      config,
      'uptimerobot.monitors.listMaxPages',
      DEFAULT_MONITOR_LIST_MAX_PAGES,
      logger,
      'uptimerobot.monitors.listMaxPages',
    ),
    debug: config.getOptionalBoolean('uptimerobot.debug') ?? false,
  };
}

// ////////////////////////////////////////
//           HELPER FUNCTIONS            //
// ////////////////////////////////////////

/** Reads the runtime configuration for the UptimeRobot graphs.
 * 
 * @param config - The configuration to read from.
 * @param logger - The logger to use to log the warning.
 * @returns The runtime configuration for the UptimeRobot graphs.
*/
function readGraphRuntimeConfig(config: Config, logger: LoggerService): GraphRuntimeConfig {
  let dailyEnabled = false;
  let dailyDays = DEFAULT_DAILY_UPTIME_DAYS;

  if (config.has('uptimerobot.graphs.dailyUptime')) {
    const dailyRaw = config.getOptional('uptimerobot.graphs.dailyUptime');
    if (
      typeof dailyRaw === 'boolean' ||
      typeof dailyRaw === 'number' ||
      typeof dailyRaw === 'string'
    ) {
      const duBool = config.getOptionalBoolean('uptimerobot.graphs.dailyUptime');
      dailyEnabled = duBool ?? false;
      dailyDays = DEFAULT_DAILY_UPTIME_DAYS;
    } else {
      const duCfg = config.getConfig('uptimerobot.graphs.dailyUptime');
      const exEn = duCfg.getOptionalBoolean('enabled');
      const exDays = duCfg.getOptionalNumber('days');
      
      // Set dailyEnabled based on the configuration
      if (exEn !== undefined) dailyEnabled = exEn;
      else if (exDays !== undefined) dailyEnabled = true;
      else dailyEnabled = false;

      dailyDays = clampDailyUptimeDays(exDays ?? DEFAULT_DAILY_UPTIME_DAYS, logger);
    }
  }

  let responseEnabled = false;
  let responseDays = DEFAULT_RESPONSE_TIME_DAYS;

  if (config.has('uptimerobot.graphs.responseTime')) {
    const responseRaw = config.getOptional('uptimerobot.graphs.responseTime');
    if (
      typeof responseRaw === 'boolean' ||
      typeof responseRaw === 'number' ||
      typeof responseRaw === 'string'
    ) {
      const rtBool = config.getOptionalBoolean('uptimerobot.graphs.responseTime');
      responseEnabled = rtBool ?? false;
      responseDays = DEFAULT_RESPONSE_TIME_DAYS;
    } else {
      const rtCfg = config.getConfig('uptimerobot.graphs.responseTime');
      const exEn = rtCfg.getOptionalBoolean('enabled');
      const exDays = rtCfg.getOptionalNumber('days');
      if (exEn !== undefined) {
        responseEnabled = exEn;
      } else if (exDays !== undefined) {
        responseEnabled = true;
      } else {
        responseEnabled = false;
      }
      responseDays = clampResponseTimeDays(exDays ?? DEFAULT_RESPONSE_TIME_DAYS, logger);
    }
  }

  return {
    dailyUptime: { enabled: dailyEnabled, days: dailyDays },
    responseTime: { enabled: responseEnabled, days: responseDays },
  };
}

/** Clamps the number of days for the response time graph.
 * 
 * Used in readGraphRuntimeConfig method.
 * 
 * @param raw - The number of days to clamp.
 * @param logger - The logger to use to log the warning.
 * @returns The clamped number of days.
*/
function clampResponseTimeDays(raw: number, logger: LoggerService): number {
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    logger.warn('uptimerobot graphs.responseTime.days must be a finite integer; using default', {
      raw,
    });
    return DEFAULT_RESPONSE_TIME_DAYS;
  }
  if (raw < MIN_GRAPH_DAYS || raw > MAX_RESPONSE_TIME_DAYS) {
    const clamped = Math.min(MAX_RESPONSE_TIME_DAYS, Math.max(MIN_GRAPH_DAYS, raw));
    logger.warn('uptimerobot graphs.responseTime.days out of range (API max 90); clamping', {
      raw,
      min: MIN_GRAPH_DAYS,
      max: MAX_RESPONSE_TIME_DAYS,
      used: clamped,
    });
    return clamped;
  }
  return raw;
}

/** Clamps the number of days for the daily uptime graph.
 * 
 * @param raw - The number of days to clamp.
 * @param logger - The logger to use to log the warning.
 * @returns The clamped number of days.
*/
function clampDailyUptimeDays(raw: number, logger: LoggerService): number {
  if (!Number.isFinite(raw) || !Number.isInteger(raw)) {
    logger.warn('uptimerobot graphs.dailyUptime.days must be a finite integer; using default', {
      raw,
    });
    return DEFAULT_DAILY_UPTIME_DAYS;
  }
  if (raw < MIN_GRAPH_DAYS || raw > MAX_UPTIME_GRAPH_DAYS) {
    const clamped = Math.min(MAX_UPTIME_GRAPH_DAYS, Math.max(MIN_GRAPH_DAYS, raw));
    logger.warn('uptimerobot graphs.dailyUptime.days out of range; clamping', {
      raw,
      min: MIN_GRAPH_DAYS,
      max: MAX_UPTIME_GRAPH_DAYS,
      used: clamped,
    });
    return clamped;
  }
  return raw;
}

/** Reads a positive integer from the configuration.
 * 
 * @param config - The configuration to read from.
 * @param key - The key to read from the configuration.
 * @param fallback - The fallback value to use if the key is not found.
 * @param logger - The logger to use to log the warning.
 * @param label - The label to use in the warning message.
 * @returns The positive integer.
*/
function readPositiveInt(
  config: Config,
  key: string,
  fallback: number,
  logger: LoggerService,
  label: string,
): number {
  const raw = config.getOptionalNumber(key);
  if (raw === undefined) return fallback;
  if (!Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    logger.warn(`${label} must be a positive integer; using default`, { raw, fallback });
    return fallback;
  }
  return raw;
}
