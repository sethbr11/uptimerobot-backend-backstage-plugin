import type { Entity } from '@backstage/catalog-model';
import { InputError } from '@backstage/errors';
import type { EntityAnnotationConfig } from '../readPluginConfig';

const USE_ENTITY_NAME_VALUES = new Set(['true', '1', 'yes']);
const ANNOTATION_OFF_VALUES = new Set(['false', '0', 'no', 'off']);

/** Resolves UptimeRobot monitor friendly name from catalog annotations
 * 
 * @param entity - The entity to resolve the monitor name from
 * @param ann - The annotation configuration
 * @returns The monitor name
 */
export function resolveMonitorNameFromEntity(entity: Entity, ann: EntityAnnotationConfig): string {
  const annotations = entity.metadata.annotations ?? {};

  // Test if the entity annotation is present
  const raw = annotations[ann.entityAnnotation];
  if (raw === undefined) throw new InputError(`Entity is missing ${ann.entityAnnotation}`);

  // Test if the entity annotation is not empty
  const value = raw.trim();
  if (!value) throw new InputError(`${ann.entityAnnotation} must not be empty`);

  // Test if the entity annotation is disabled
  const lower = value.toLowerCase();
  if (ANNOTATION_OFF_VALUES.has(lower)) throw new InputError(`${ann.entityAnnotation} is disabled for this entity`);

  // Test if the entity annotation is enabled
  if (USE_ENTITY_NAME_VALUES.has(lower)) return entity.metadata.name;

  // Return the entity annotation value
  return value;
}
