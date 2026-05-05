/**
 * Default catalog annotation for UptimeRobot integration (single key).
 * Keep in sync with `uptimerobot.catalog.entityAnnotation` default in
 * [config.d.ts](config.d.ts) and [../uptimerobot/src/annotationDefaults.ts](../uptimerobot/src/annotationDefaults.ts).
 *
 * Value semantics:
 * - `true`, `1`, or `yes` (case-insensitive) → resolve monitor by entity `metadata.name`
 * - any other non-empty string → that string is the UptimeRobot monitor friendly name
 * - `false`, `0`, `no`, or `off` (case-insensitive) → integration off for this entity
 */
export const UPTIMEROBOT_DEFAULT_ENTITY_ANNOTATION = 'backstage.io/uptimerobot';

/**
 * Optional absolute URL for the monitor name link on the entity card (UptimeRobot's monitored URL is not used).
 */
export const UPTIMEROBOT_MONITOR_URL_ANNOTATION = 'backstage.io/uptimerobot-monitor-url';
