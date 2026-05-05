/** Daily uptime bucket returned by the uptimerobot backend for charts
 * 
 * @property date - The date of the daily uptime
 * @property uptimeRatio - The uptime ratio
 */
export type DailyUptime = {
  date: string;
  uptimeRatio?: number;
};

/** Incident row normalized from UptimeRobot v3 for the entity card
 * 
 * @property id - The incident ID
 * @property type - The incident type
 * @property startedAt - The timestamp of the incident start
 * @property durationSeconds - The duration of the incident in seconds
 * @property reason - The reason for the incident
 */
export type BasicIncident = {
  id: string;
  type: string;
  startedAt: string;
  durationSeconds?: number;
  reason?: string;
};

/** Point in the response-time series (`GET .../stats/response-time/all`, `all` aggregate)
 * 
 * @property timestamp - The timestamp of the response time
 * @property valueMs - The response time in milliseconds
*/
export type ResponseTimePoint = {
  timestamp: string;
  valueMs: number;
};

/** Response-time chart from one API call: `GET .../stats/response-time/all` with a single `from`/`to` range.
 * 
 * @property windowDays - The window days
 * @property avgMs - The average response time in milliseconds
 * @property maxMs - The maximum response time in milliseconds
 * @property minMs - The minimum response time in milliseconds
 * @property series - The response time series
 */
export type ResponseTimeChart = {
  windowDays: number;
  avgMs?: number;
  maxMs?: number;
  minMs?: number;
  series: ResponseTimePoint[];
};

/** Mirrors `uptimerobot.graphs` for the UI (booleans + day windows)
 * 
 * @property dailyUptime - Whether to display the daily uptime
 * @property dailyUptimeDays - The window for daily pills / "Last N days" uptime tile (from `graphs.dailyUptime.days`)
 * @property responseTime - Whether to display the response time
 * @property responseTimeDays - The window for the response-time request (from `graphs.responseTime.days`)
*/
export type GraphDisplay = {
  dailyUptime: boolean;
  dailyUptimeDays: number;
  responseTime: boolean;
  responseTimeDays: number;
};

/** Basic monitor
 * 
 * @property id - The monitor ID
 * @property name - The monitor name
 * @property url - Optional display link from catalog `backstage.io/uptimerobot-monitor-url` only (not UptimeRobot healthcheck URL)
 * @property status - The monitor status
 * 
 * @internal
 */
type BasicMonitor = {
  id: string;
  name: string;
  url?: string;
  status: string;
};

/** Monitor history uptime
 * 
 * @property last24Hours - The uptime in the last 24 hours
 * @property last7Days - The uptime in the last 7 days
 * @property last30Days - The uptime in the last 30 days
 * @property last90Days - The uptime in the last 90 days
 * 
 * @internal
 */
type MonitorHistoryUptime = {
  last24Hours?: number;
  last7Days?: number;
  last30Days?: number;
  last90Days?: number;
};

/** Fast payload returned before slower chart and incident objects are ready
 * 
 * @property chartDayCount - Same as `display.dailyUptimeDays`; length of pill chart when daily graph is on
 * @property display - The display settings
 * @property monitor - The monitor
 * @property uptime - The uptime
 * @property responseTime - The response time
*/
export type MonitorSummaryStats = {
  chartDayCount: number;
  display: GraphDisplay;
  monitor: BasicMonitor;
  uptime: MonitorHistoryUptime;
  responseTime?: ResponseTimeChart;
};

/** Payload returned by the uptimerobot backend entity stats routes for the frontend entity card
 * 
 * @property dailyUptime - The daily uptime
 * @property incidents - The incidents
 */
export type MonitorStats = MonitorSummaryStats & {
  dailyUptime: DailyUptime[];
  incidents: BasicIncident[];
};
