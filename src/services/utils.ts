import type { Incident, Monitor, MonitorUptimeStats } from 'uptime-robot-v3';
import type { PluginRuntimeConfig } from '../readPluginConfig';
import type { GraphDisplay, BasicIncident } from '../types';

// ////////////////////////////////////////////
//            CONSTANTS AND TYPES            //
// ////////////////////////////////////////////

/** Card only needs recent downtime; narrower window keeps the incidents request smaller. */
export const INCIDENT_LOOKBACK_DAYS = 90;

// ////////////////////////////////////////////
//            EXPORTED UTILITIES             //
// ////////////////////////////////////////////

/** Parse the next monitor list cursor from the next link
 * 
 * @param nextLink - The next link to parse the cursor from
 * @returns The next monitor list cursor
 */
export function parseNextMonitorListCursor(nextLink: string | null | undefined): number | undefined {
  if (!nextLink) return undefined;
  const trimmed = nextLink.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null') return undefined;

  try {
    const resolved = trimmed.includes('://')
      ? trimmed
      : new URL(trimmed, 'https://api.uptimerobot.com/v3/monitors').toString();

    const url = new URL(resolved);
    const cursorStr = url.searchParams.get('cursor');
    if (!cursorStr) return undefined;

    const cursorNum = Number(cursorStr);
    return Number.isFinite(cursorNum) ? cursorNum : undefined;
  } catch {
    return undefined;
  }
}

/** Convert the runtime configuration to a graph display
 * 
 * @param runtime - The runtime configuration
 * @returns The graph display
 */
export function toGraphDisplay(runtime: PluginRuntimeConfig): GraphDisplay {
  const g = runtime.graphs;
  return {
    dailyUptime: g.dailyUptime.enabled,
    dailyUptimeDays: g.dailyUptime.days,
    responseTime: g.responseTime.enabled,
    responseTimeDays: g.responseTime.days,
  } as GraphDisplay;
}

/** Build a relative ISO date
 * 
 * @param daysAgo - The number of days ago
 * @returns The relative ISO date
 */
export function buildRelativeIsoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString();
}

/** Get the uptime ratio from the monitor uptime stats
 * 
 * @param stats - The monitor uptime stats
 * @returns The uptime ratio
 */
export function getUptimeRatio(stats: MonitorUptimeStats): number | undefined {
  return stats.uptime ?? (stats as { overallUptime?: number }).overallUptime;
}

/** Get the status label from the monitor status
 * 
 * @param status - The monitor status
 * @returns The status label
 */
export function getStatusLabel(status?: Monitor['status']): string {
  const value =
    typeof status === 'string'
      ? status
      : String((status as { name?: string; value?: string } | undefined)?.name ??
          (status as { name?: string; value?: string } | undefined)?.value ??
          'Unknown');

  switch (value.toUpperCase()) {
    case 'PAUSED':
      return 'Paused';
    case 'NOT_CHECKED_YET':
    case 'NOT CHECKED YET':
      return 'Not checked yet';
    case 'UP':
      return 'Up';
    case 'SEEMS_DOWN':
    case 'SEEMS DOWN':
      return 'Seems down';
    case 'DOWN':
      return 'Down';
    default:
      return value;
  }
}

/** Convert the incident to a basic incident
 * 
 * @param incident - The incident
 * @returns The basic incident
 */
export function toBasicIncident(incident: Incident): BasicIncident {
  return {
    id: String(incident.id),
    type: incident.type ?? 'Incident',
    startedAt: incident.startedAt ?? new Date().toISOString(),
    durationSeconds: incident.duration,
    reason: incident.reason,
  };
}
