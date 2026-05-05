/*
 * Configuration schema for `@backstage-community/plugin-uptimerobot-backend`.
 * Merged at `backstage-cli config:check` / startup when the plugin is installed.
 */
export interface Config {
  uptimerobot?: {
    /** UptimeRobot read-only API key (v3). */
    apiKey?: string;

    /** When true, logs extra plugin diagnostics at `info` level (default: false). */
    debug?: boolean;

    /**
     * In-memory cache TTL for entity stats responses, in seconds (default: 600).
     * The frontend "Refresh" action still bypasses this via `?refresh=true`.
     */
    cacheTtlSeconds?: number;

    /** Per-HTTP-call timeout when calling api.uptimerobot.com, in seconds (default: 45). */
    httpTimeoutSeconds?: number;

    /**
     * Optional override for the single catalog annotation key (default: `backstage.io/uptimerobot`).
     * Value `true` / `1` / `yes` → monitor name = entity `metadata.name`; any other non-empty string → that
     * string is the monitor friendly name; `false` / `0` / `no` / `off` → off for this entity.
     */
    catalog?: {
      entityAnnotation?: string;
    };

    /** Optional tuning for monitor list pagination when resolving by name. */
    monitors?: {
      /** Page size for `GET /monitors` (default: 50). */
      listPageLimit?: number;
      /** Max pages to walk when searching by name (default: 80). */
      listMaxPages?: number;
    };

    /** Optional graphs — omit a key or use `enabled: false` to turn it off (defaults: both off). */
    graphs?: {
      /**
       * Daily uptime pills: `days` UTC calendar days (default 30, max 90). When enabled, one `stats/uptime` per day.
       */
      dailyUptime?: { enabled?: boolean; days?: number };
      /**
       * Response-time chart: single `stats/response-time/all` over `days` (default 90, max 90). Not one call per day.
       */
      responseTime?: { enabled?: boolean; days?: number };
    };
  };
}
