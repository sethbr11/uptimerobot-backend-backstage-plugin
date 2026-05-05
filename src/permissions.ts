import { createPermission } from '@backstage/plugin-permission-common';

/** Read aggregate daily-uptime cache statistics (admin / diagnostics). */
export const uptimerobotCacheReadPermission = createPermission({
  name: 'uptimerobot.cache.read',
  attributes: { action: 'read' },
});

/** Reset persisted or in-memory UptimeRobot caches (admin). */
export const uptimerobotCacheResetPermission = createPermission({
  name: 'uptimerobot.cache.reset',
  attributes: { action: 'delete' },
});

/** Permissions registered by the UptimeRobot backend plugin (for policy authors). */
export const uptimerobotPermissions = [
  uptimerobotCacheReadPermission,
  uptimerobotCacheResetPermission,
];
