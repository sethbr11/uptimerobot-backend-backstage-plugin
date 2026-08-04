import { createPermission } from '@backstage/plugin-permission-common';
import { RESOURCE_TYPE_CATALOG_ENTITY } from '@backstage/plugin-catalog-common/alpha';

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

/**
 * Reset daily-uptime cache rows for one catalog entity.
 *
 * Resource permission on `catalog-entity` so host policies can allow owners
 * (e.g. `catalogConditions.isEntityOwner`) and/or elevated groups.
 */
export const uptimerobotCacheResetEntityPermission = createPermission({
  name: 'uptimerobot.cache.reset-entity',
  attributes: { action: 'delete' },
  resourceType: RESOURCE_TYPE_CATALOG_ENTITY,
});

/** Permissions registered by the UptimeRobot backend plugin (for policy authors). */
export const uptimerobotPermissions = [
  uptimerobotCacheReadPermission,
  uptimerobotCacheResetPermission,
  uptimerobotCacheResetEntityPermission,
];
