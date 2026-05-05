import type { BackstageCredentials, BackstageUserPrincipal, DatabaseService, LoggerService } from '@backstage/backend-plugin-api';
import type { Config } from '@backstage/config';
import { stringifyEntityRef, type Entity } from '@backstage/catalog-model';
import { InputError, NotFoundError, ServiceUnavailableError } from '@backstage/errors';
import { catalogServiceRef } from '@backstage/plugin-catalog-node';
import { UptimeRobotService as UptimeRobotV3Client, type Monitor,
  type MonitorUptimeStats, type URFullResponse } from 'uptime-robot-v3';
import { UPTIMEROBOT_MONITOR_URL_ANNOTATION } from '../annotationDefaults';
import { MAX_UPTIME_GRAPH_DAYS, readPluginRuntimeConfig, type PluginRuntimeConfig } from '../readPluginConfig';
import type { DailyUptime, BasicIncident, MonitorStats, MonitorSummaryStats, ResponseTimeChart } from '../types';
import { resolveMonitorNameFromEntity } from './catalogProcessor';
import { type DailyUptimeCacheIdentity, type DailyUptimeCacheStats, DailyUptimeStore } from './dailyUptimeStore';
import { callUptimeRobot, UptimeRobotHttpError } from './httpClient';
import { INCIDENT_LOOKBACK_DAYS, buildRelativeIsoDate, getStatusLabel, getUptimeRatio,
  parseNextMonitorListCursor, toGraphDisplay, toBasicIncident } from './utils';

// ////////////////////////////////////////////
//            TYPES AND CONSTANTS            //
// ////////////////////////////////////////////

/** The options for creating the UptimeRobot service
 * 
 * @param config - The configuration
 * @param database - The database
 * @param logger - The logger
 * @param catalog - The catalog
 * @returns The options for creating the UptimeRobot service
 */
type ServiceCreateOptions = {
  config: Config;
  database: DatabaseService;
  logger: LoggerService;
  catalog: typeof catalogServiceRef.T;
};

/** The public health response
 * 
 * @property ok - Whether the public health is OK
 * @property status - The status of the public health
 * @property configured - Whether the UptimeRobot API key is configured
 * @property detail - The detail of the public health
 */
type PublicHealthResponse = {
  ok: boolean;
  status: string;
  configured: boolean;
  detail?: string;
};

/** The credentials for the user
 * 
 * @param credentials - The credentials for the user
 * @returns The credentials for the user
 */
type Credentials = {
  credentials: BackstageCredentials<BackstageUserPrincipal>;
};

/** The common options for all methods
 *
 * @param credentials - The credentials for the user
 * @param refresh - Whether to refresh the stats
 * @returns The options for getting the stats for an entity
 */
type CommonOptions = Credentials & {
  refresh?: boolean;
};

/** The date range parameters
 * 
 * @param from - The start date
 * @param to - The end date
 * @returns The date range parameters
 */
type DateRangeParams = {
  from: string;
  to: string;
};

// ////////////////////////////////////////////
//            MAIN CLASS DEFINITION          //
// ////////////////////////////////////////////

/** UptimeRobot service: catalog entity → v3 monitor + stats. */
export class UptimeRobotService {
  readonly #runtime: PluginRuntimeConfig;
  readonly #logger: LoggerService;
  readonly #catalog: typeof catalogServiceRef.T;
  readonly #dailyUptimeStore: DailyUptimeStore;
  readonly #cache = new Map<string, { expiresAt: number; value: MonitorStats }>();
  readonly #summaryCache = new Map<string, { expiresAt: number; value: MonitorSummaryStats }>();
  #v3?: UptimeRobotV3Client;

  /** The UptimeRobot service constructor. Only callable by the create method.
   * 
   * @param runtime - The runtime configuration
   * @param logger - The logger
   * @param catalog - The catalog
   * @param dailyUptimeStore - The daily uptime store
   * @returns The UptimeRobot service
   */
  private constructor(
    runtime: PluginRuntimeConfig,
    logger: LoggerService,
    catalog: typeof catalogServiceRef.T,
    dailyUptimeStore: DailyUptimeStore,
  ) {
    this.#runtime = runtime;
    this.#logger = logger;
    this.#catalog = catalog;
    this.#dailyUptimeStore = dailyUptimeStore;
  }

  // ////////////////////////////////////////////
  //            PUBLIC METHODS                 //
  // ////////////////////////////////////////////

  /** Method to create the UptimeRobot service
   * 
   * @param options - The options for the UptimeRobot service
   * @returns The UptimeRobot service
   */
  static create(options: ServiceCreateOptions) {
    return new UptimeRobotService(
      readPluginRuntimeConfig(options.config, options.logger),
      options.logger,
      options.catalog,
      new DailyUptimeStore(options.database),
    );
  }

  /** Get the stats for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the stats for the entity
   * @returns The stats for the entity
   */
  async getStatsForEntity(entityRef: string, options: CommonOptions): Promise<MonitorStats> {
    const { monitorName, monitor, entity } = await this.#getMonitorForEntity(entityRef, options);
    const monitorUrlOverride = this.#resolveMonitorUrlFromEntity(entity);
    const cached = this.#cache.get(entityRef);
    if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;

    // Build the monitor stats
    const stats = await this.#buildMonitorStats(
      monitor,
      { entityRef, monitorId: monitor.id, monitorName },
      monitorUrlOverride,
    );

    // Cache the stats
    this.#cache.set(entityRef, {
      expiresAt: Date.now() + this.#runtime.cacheTtlMs,
      value: stats,
    });

    return stats;
  }

  /** Get the stats summary for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the stats summary for the entity
   * @returns The stats summary for the entity
   */
  async getStatsSummaryForEntity(entityRef: string, options: CommonOptions): Promise<MonitorSummaryStats> {
    const { monitor, entity } = await this.#getMonitorForEntity(entityRef, options);
    const monitorUrlOverride = this.#resolveMonitorUrlFromEntity(entity);
    const cached = this.#summaryCache.get(entityRef);
    if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.value;

    // Build the monitor summary stats
    const summary = await this.#buildMonitorSummaryStats(monitor, monitorUrlOverride);

    // Cache the summary stats
    this.#summaryCache.set(entityRef, {
      expiresAt: Date.now() + this.#runtime.cacheTtlMs,
      value: summary,
    });

    return summary;
  }

  /** Get the daily uptime for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the daily uptime for the entity
   * @returns The daily uptime for the entity
   */
  async getDailyUptimeForEntity(entityRef: string, options: CommonOptions): Promise<DailyUptime[]> {
    const { monitor, monitorName } = await this.#getMonitorForEntity(entityRef, options);

    // Build and return the daily uptime
    return this.#buildDailyUptime({ entityRef, monitorId: monitor.id, monitorName });
  }

  /** Get the response time for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the response time for the entity
   * @returns The response time for the entity
   */
  async getResponseTimeForEntity(entityRef: string, options: CommonOptions): Promise<ResponseTimeChart | undefined> {
    const { monitor } = await this.#getMonitorForEntity(entityRef, options);
    if (!this.#runtime.graphs.responseTime.enabled) return undefined;
    return this.#getOptionalResponseTimeChart(monitor.id, new Date().toISOString(), true);
  }

  /** Get the incidents for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the incidents for the entity
   * @returns The incidents for the entity
   */
  async getIncidentsForEntity(entityRef: string, options: CommonOptions): Promise<BasicIncident[]> {
    const { monitor } = await this.#getMonitorForEntity(entityRef, options);
    return this.#getOptionalIncidents(monitor.id);
  }

  /** Get the daily uptime cache stats
   * 
   * @returns The daily uptime cache stats
   */
  async getDailyUptimeCacheStats(): Promise<DailyUptimeCacheStats> {
    return this.#dailyUptimeStore.getStats();
  }

  /** Reset the daily uptime cache
   * 
   * @returns The number of deleted daily uptime cache entries
   */
  async resetDailyUptimeCache(): Promise<{ deleted: number }> {
    const deleted = await this.#dailyUptimeStore.resetAll();
    this.#cache.clear();
    this.#summaryCache.clear();
    return { deleted };
  }

  /** Reset the daily uptime cache for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for resetting the daily uptime cache for the entity
   * @returns The number of deleted daily uptime cache entries
   */
  async resetDailyUptimeCacheForEntity(
    entityRef: string,
    options: { credentials: BackstageCredentials<BackstageUserPrincipal> },
  ): Promise<{ deleted: number }> {
    await this.#getMonitorNameForEntity(entityRef, options);
    const deleted = await this.#dailyUptimeStore.resetEntity(entityRef);
    this.#cache.clear();
    this.#summaryCache.clear();
    return { deleted };
  }

  /** Public health for `GET /api/uptimerobot/health`
   * 
   * When an API key is configured, performs a minimal UptimeRobot API call; otherwise
   * reports unconfigured OK.
   */
  async getPublicHealth(): Promise<PublicHealthResponse> {
    if (!this.#runtime.apiKey) {
      return {
        ok: true,
        status: 'ok',
        configured: false,
        detail: 'uptimerobot.apiKey not configured',
      };
    }
    try {
      await callUptimeRobot(
        () => this.#client().monitors.list({ limit: 1 }, true),
        this.#runtime.httpTimeoutMs,
      );
      return { ok: true, status: 'ok', configured: true };
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      return { ok: false, status: 'error', configured: true, detail };
    }
  }

  // ////////////////////////////////////////////
  //             PRIVATE METHODS               //
  // ////////////////////////////////////////////

  /** Get the UptimeRobot V3 client
   * 
   * @returns The UptimeRobot V3 client
   */
  #client(): UptimeRobotV3Client {
    if (!this.#runtime.apiKey) throw new InputError('Missing required config value uptimerobot.apiKey');

    // Initialize the UptimeRobot V3 client if it hasn't been initialized yet
    if (!this.#v3) {
      this.#v3 = new UptimeRobotV3Client({
        apiKey: this.#runtime.apiKey,
        logger: (message, level) => {
          if (level === 'error') this.#logger.error(message);
          else this.#logger.warn(message);
        },
      });
    }

    return this.#v3;
  }

  /** Get the monitor for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the monitor for the entity
   * @returns The monitor for the entity
   */
  async #getMonitorForEntity(entityRef: string, options: CommonOptions): Promise<{ monitorName: string; monitor: Monitor; entity: Entity }> {
    if (!this.#runtime.apiKey) throw new InputError('Missing required config value uptimerobot.apiKey');

    // Get the entity from the catalog
    const entity = await this.#catalog.getEntityByRef(entityRef, options);
    if (!entity) throw new NotFoundError(`No entity found for ref '${entityRef}'`);

    // Get the monitor name from the entity
    const monitorName = resolveMonitorNameFromEntity(entity, this.#runtime.annotations);

    // Find the monitor by name
    const monitor = await this.#findMonitorByName(monitorName);
    if (!monitor) {
      this.#logger.warn('No UptimeRobot monitor matched catalog entity', {
        entityRef,
        monitorName,
      });
      throw new NotFoundError(`No UptimeRobot monitor found with name '${monitorName}'`);
    }

    // Return the monitor, monitor name, and entity
    return { monitorName, monitor, entity };
  }

  /** Get the monitor name for an entity
   * 
   * @param entityRef - The entity reference
   * @param options - The options for getting the monitor name for the entity
   * @returns The monitor name for the entity
   */
  async #getMonitorNameForEntity(entityRef: string, options: Credentials): Promise<string> {
    // Get the entity from the catalog
    const entity = await this.#catalog.getEntityByRef(entityRef, options);
    if (!entity) throw new NotFoundError(`No entity found for ref '${entityRef}'`);
    return resolveMonitorNameFromEntity(entity, this.#runtime.annotations);
  }

  /** Optional `https?://...` URL from catalog for the card subheader link (never UptimeRobot's healthcheck URL)
   * 
   * @param entity - The entity
   * @returns The monitor URL for the entity
   */
  #resolveMonitorUrlFromEntity(entity: Entity): string | undefined {
    // Get the monitor URL from the entity annotations
    const raw = entity.metadata.annotations?.[UPTIMEROBOT_MONITOR_URL_ANNOTATION]?.trim();
    if (!raw) return undefined;

    // Check if the monitor URL starts with http:// or https://
    const lower = raw.toLowerCase();
    if (!lower.startsWith('http://') && !lower.startsWith('https://')) {
      this.#logger.warn('uptimerobot monitor URL annotation must start with http:// or https://', {
        entityRef: stringifyEntityRef(entity),
        annotation: UPTIMEROBOT_MONITOR_URL_ANNOTATION,
      });
      return undefined;
    }

    // Try to parse the monitor URL
    try {
      return new URL(raw).toString();
    } catch {
      this.#logger.warn('uptimerobot monitor URL annotation is not a valid URL', {
        entityRef: stringifyEntityRef(entity),
        annotation: UPTIMEROBOT_MONITOR_URL_ANNOTATION,
      });
      return undefined;
    }
  }

  /** Find a monitor by name
   * 
   * @param monitorName - The name of the monitor
   * @returns The monitor
   */
  async #findMonitorByName(monitorName: string): Promise<Monitor | undefined> {
    // Convert the monitor name to lowercase
    const lowerName = monitorName.toLocaleLowerCase();
    let cursor: number | undefined;

    // Loop through the pages of monitors
    for (let page = 0; page < this.#runtime.monitorListMaxPages; page++) {
      const pageResp = await this.#listMonitorsByName(monitorName, cursor);

      const { data = [], nextLink } = pageResp as URFullResponse<Monitor>;

      // Find the exact monitor by name
      const exact = data.find(m => (m.friendlyName ?? '').toLocaleLowerCase() === lowerName);
      if (exact) return exact;

      // Get and set the next cursor
      const nextCursor = parseNextMonitorListCursor(nextLink);
      if (nextCursor === undefined) return undefined;
      cursor = nextCursor;
    }

    return undefined; // No monitor found
  }

  /** List monitors by name
   * 
   * @param monitorName - The name of the monitor
   * @param cursor - The cursor
   * @returns The monitors
   */
  async #listMonitorsByName(monitorName: string, cursor: number | undefined): Promise<URFullResponse<Monitor>> {
    return callUptimeRobot(
      () =>
        this.#client().monitors.list(
          {
            limit: this.#runtime.monitorListPageLimit,
            name: monitorName,
            ...(cursor !== undefined ? { cursor } : {}),
          },
          true,
        ),
      this.#runtime.httpTimeoutMs,
    ) as Promise<URFullResponse<Monitor>>;
  }

  /** Build the monitor stats
   * 
   * Uptime summaries use a few range calls so they can return before slower chart and incident objects finish.
   * Optional daily pills still use one `stats/uptime` per UTC day in `graphs.dailyUptime.days`.
   * 
   * @param monitor - The monitor
   * @param identity - The identity of the monitor
   * @param monitorUrlOverride - The monitor URL override
   * @returns The monitor stats
   */
  async #buildMonitorStats(
    monitor: Monitor,
    identity: DailyUptimeCacheIdentity,
    monitorUrlOverride?: string,
  ): Promise<MonitorStats> {
    const [summary, dailyUptime, responseTime, incidents] = await Promise.all([
      this.#buildMonitorSummaryStats(monitor, monitorUrlOverride),
      this.#buildDailyUptime(identity),
      this.#runtime.graphs.responseTime.enabled
        ? this.#getOptionalResponseTimeChart(monitor.id, new Date().toISOString(), true)
        : undefined,
      this.#getOptionalIncidents(monitor.id),
    ]);

    return {
      ...summary,
      dailyUptime,
      responseTime: responseTime ?? summary.responseTime,
      incidents,
    };
  }

  /** Build the monitor summary stats
   * 
   * @param monitor - The monitor
   * @param monitorUrlOverride - The monitor URL override
   * @returns The monitor summary stats
   */
  async #buildMonitorSummaryStats(
    monitor: Monitor,
    monitorUrlOverride?: string,
  ): Promise<MonitorSummaryStats> {
    // Get the monitor ID and current date
    const id = monitor.id;
    const now = new Date().toISOString();

    // Get the last 24 hours, last 7 days, chart days, and last 90 days stats
    const [last24Stats, last7Stats, chartStats, last90Stats, responseTime] = await Promise.all([
      this.#getOptionalMonitorUptime(id, {
        from: buildRelativeIsoDate(1),
        to: now,
      }),
      this.#getOptionalMonitorUptime(id, {
        from: buildRelativeIsoDate(7),
        to: now,
      }),
      this.#getOptionalMonitorUptime(id, {
        from: buildRelativeIsoDate(this.#runtime.graphs.dailyUptime.days),
        to: now,
      }),
      this.#getOptionalMonitorUptime(id, {
        from: buildRelativeIsoDate(90),
        to: now,
      }),
      this.#runtime.graphs.responseTime.enabled
        ? this.#getOptionalResponseTimeChart(id, now, false)
        : undefined,
    ]);

    // Return the monitor summary stats
    return {
      chartDayCount: this.#runtime.graphs.dailyUptime.days,
      display: toGraphDisplay(this.#runtime),
      monitor: {
        id: String(monitor.id),
        name: monitor.friendlyName,
        ...(monitorUrlOverride ? { url: monitorUrlOverride } : {}),
        status: getStatusLabel(monitor.status),
      },
      uptime: {
        last24Hours: last24Stats ? getUptimeRatio(last24Stats) : undefined,
        last7Days: last7Stats ? getUptimeRatio(last7Stats) : undefined,
        last30Days: chartStats ? getUptimeRatio(chartStats) : undefined,
        last90Days: last90Stats ? getUptimeRatio(last90Stats) : undefined,
      },
      responseTime,
    };
  }

  /** Build the daily uptime
   * 
   * @param identity - The identity of the monitor
   * @returns The daily uptime
   */
  async #buildDailyUptime(identity: DailyUptimeCacheIdentity): Promise<DailyUptime[]> {
    // Initialize the daily uptime array
    const dailyUptime: DailyUptime[] = [];

    // Return the daily uptime array if the daily uptime is not enabled
    if (!this.#runtime.graphs.dailyUptime.enabled) return dailyUptime;

    // Get the client, current date, and ranges
    const v3 = this.#client();
    const nowMs = Date.now();
    const today = new Date(nowMs).toISOString().slice(0, 10);
    const ranges = v3.tools.buildUtcCalendarDayRanges(this.#runtime.graphs.dailyUptime.days, nowMs);
    const retentionRanges = v3.tools.buildUtcCalendarDayRanges(MAX_UPTIME_GRAPH_DAYS, nowMs);
    const cached = await this.#dailyUptimeStore.getDailyUptime(
      identity,
      ranges.map(range => range.date),
    );

    // Keep rows for the full API max window even when the graph shows fewer days (config can change later).
    await this.#dailyUptimeStore.deleteOlderThan(
      identity.monitorId,
      retentionRanges[0]?.date ?? today,
    );

    // Loop through the ranges
    for (const range of ranges) {
      // Get the cached day
      const cachedDay = cached.get(range.date);

      // Check if the day is not today, cached, not in error, and has an uptime ratio
      if (
        range.date !== today &&
        cachedDay &&
        cachedDay.error === undefined &&
        cachedDay.uptimeRatio !== undefined
      ) {
        dailyUptime.push({ date: range.date, uptimeRatio: cachedDay.uptimeRatio });
        continue;
      }

      // Try to get the monitor uptime
      try {
        // Get the monitor uptime
        const stats = await this.#getMonitorUptime(identity.monitorId, { from: range.from, to: range.to });

        // Get the uptime ratio
        const uptimeRatio = getUptimeRatio(stats);

        // Create the day object
        const day = {
          date: range.date,
          uptimeRatio,
          error: uptimeRatio === undefined ? 'Uptime value missing from UptimeRobot response' : undefined,
        };

        // Upsert the day
        await this.#dailyUptimeStore.upsertDailyUptime(identity, day);

        // Add the day to the daily uptime array
        dailyUptime.push({ date: day.date, uptimeRatio: day.uptimeRatio });
      } catch (e) {
        // Check if the error is a UptimeRobotHttpError
        if (e instanceof UptimeRobotHttpError) throw e;

        // Log the error
        this.#logger.warn('Failed to fetch daily UptimeRobot stats', {
          monitorId: String(identity.monitorId),
          date: range.date,
          error: e instanceof Error ? e.message : String(e),
        });

        // Upsert (update or insert) the day
        await this.#dailyUptimeStore.upsertDailyUptime(identity, {
          date: range.date,
          error: e instanceof Error ? e.message : String(e),
        });

        // Add the day to the daily uptime array
        dailyUptime.push({ date: range.date });
      }
    }

    return dailyUptime;
  }

  /** Get the optional response time chart
   * 
   * @param monitorId - The monitor ID
   * @param nowIso - The current date in ISO format
   * @param includeTimeSeries - Whether to include the time series
   * @returns The response time chart
   */
  async #getOptionalResponseTimeChart(
    monitorId: number | string,
    nowIso: string,
    includeTimeSeries: boolean,
  ): Promise<ResponseTimeChart> {
    // Get the window days
    const windowDays = this.#runtime.graphs.responseTime.days;

    // Try to get the response time chart
    try {
      const raw = await callUptimeRobot(
        () =>
          this.#client().monitors.getResponseTimeStatisticsByRegion(monitorId, {
            from: buildRelativeIsoDate(windowDays),
            to: nowIso,
            includeTimeSeries,
          }),
        this.#runtime.httpTimeoutMs,
      );

      // Get the all data
      const all = raw.all;

      // Check if the all data is not present
      if (!all) {
        return {
          windowDays,
          series: [],
        };
      }

      // Get the series
      const series = includeTimeSeries
        ? [...(all.time_series ?? [])]
            .map(p => ({ timestamp: String(p.timestamp), valueMs: p.value }))
            .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
        : [];

      // Return the response time chart
      return {
        windowDays,
        avgMs: all.summary?.avg,
        maxMs: all.summary?.max,
        minMs: all.summary?.min,
        series,
      };
    } catch (error) {
      // Check if the error is a UptimeRobotHttpError
      if (error instanceof UptimeRobotHttpError) throw error;

      // Log the error
      this.#logger.warn('Failed to fetch UptimeRobot response time stats', {
        monitorId: String(monitorId),
        error: error instanceof Error ? error.message : String(error),
      });

      // Return the response time chart with no series
      return {
        windowDays,
        series: [],
      };
    }
  }

  /** Get the monitor uptime
   * 
   * @param monitorId - The monitor ID
   * @param params - The parameters for getting the monitor uptime
   * @returns The monitor uptime
   */
  async #getMonitorUptime(monitorId: number | string, params: DateRangeParams): Promise<MonitorUptimeStats> {
    return callUptimeRobot(
      () => this.#client().monitors.getUptimeStatistics(monitorId, params),
      this.#runtime.httpTimeoutMs,
    );
  }

  /** Get the optional monitor uptime
   * 
   * @param monitorId - The monitor ID
   * @param params - The parameters for getting the monitor uptime
   * @returns The monitor uptime
   */
  async #getOptionalMonitorUptime(monitorId: number | string, params: DateRangeParams): Promise<MonitorUptimeStats | undefined> {
    try {
      return await this.#getMonitorUptime(monitorId, params);
    } catch (error) {
      // Check if the error is a UptimeRobotHttpError
      if (error instanceof UptimeRobotHttpError) throw error;

      // Log the error
      this.#logger.warn('Failed to fetch UptimeRobot uptime stats', {
        monitorId: String(monitorId),
        error: error instanceof Error ? error.message : String(error),
      });

      return undefined; // Return undefined
    }
  }

  /** Get the incidents
   * 
   * @param monitorId - The monitor ID
   * @returns The incidents
   */
  async #getIncidents(monitorId: number | string): Promise<BasicIncident[]> {
    // Get the monitor ID
    const mid = typeof monitorId === 'number' ? monitorId : Number(monitorId);

    // Check if the monitor ID is not a finite number
    if (!Number.isFinite(mid)) {
      throw new ServiceUnavailableError(`Invalid UptimeRobot monitor id: ${String(monitorId)}`);
    }

    // Get the incidents
    const incidents = await callUptimeRobot(
      () =>
        this.#client().incidents.list({
          monitor_id: mid,
          started_after: buildRelativeIsoDate(INCIDENT_LOOKBACK_DAYS),
        }),
      this.#runtime.httpTimeoutMs,
    );

    // Return the incidents
    return incidents.map(incident => toBasicIncident(incident)).sort((a, b) => {
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });
  }

  /** Get the optional incidents
   * 
   * @param monitorId - The monitor ID
   * @returns The incidents
   */
  async #getOptionalIncidents(monitorId: number | string): Promise<BasicIncident[]> {
    try {
      return await this.#getIncidents(monitorId);
    } catch (error) {
      if (error instanceof UptimeRobotHttpError) throw error;
      this.#logger.warn('Failed to fetch UptimeRobot incidents', {
        monitorId: String(monitorId),
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }
}
