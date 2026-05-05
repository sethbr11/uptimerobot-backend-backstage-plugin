import { InputError } from '@backstage/errors';
import type { Entity } from '@backstage/catalog-model';
import { resolveMonitorNameFromEntity } from '../services/catalogProcessor';

const ann = { entityAnnotation: 'backstage.io/uptimerobot' };

function entity(partial: Partial<Entity> & { metadata: Entity['metadata'] }): Entity {
  return partial as Entity;
}

describe('resolveMonitorNameFromEntity', () => {
  it('returns trimmed literal monitor name', () => {
    const e = entity({
      metadata: {
        name: 'svc',
        annotations: { 'backstage.io/uptimerobot': '  Payments API  ' },
      },
    });
    expect(resolveMonitorNameFromEntity(e, ann)).toBe('Payments API');
  });

  it('uses entity name when annotation is yes/true/1 (case-insensitive)', () => {
    const e = entity({
      metadata: {
        name: 'my-service',
        annotations: { 'backstage.io/uptimerobot': 'YES' },
      },
    });
    expect(resolveMonitorNameFromEntity(e, ann)).toBe('my-service');
  });

  it('throws when annotation is missing', () => {
    const e = entity({
      metadata: { name: 'x', annotations: {} },
    });
    expect(() => resolveMonitorNameFromEntity(e, ann)).toThrow(InputError);
    expect(() => resolveMonitorNameFromEntity(e, ann)).toThrow(/Entity is missing backstage\.io\/uptimerobot/);
  });

  it('throws when annotation is empty or whitespace', () => {
    expect(() =>
      resolveMonitorNameFromEntity(
        entity({ metadata: { name: 'x', annotations: { 'backstage.io/uptimerobot': '  ' } } }),
        ann,
      ),
    ).toThrow(/must not be empty/);
  });

  it.each(['false', '0', 'no', 'off', 'FALSE', 'Off'])('throws when annotation is disabled (%s)', value => {
    expect(() =>
      resolveMonitorNameFromEntity(
        entity({ metadata: { name: 'x', annotations: { 'backstage.io/uptimerobot': value } } }),
        ann,
      ),
    ).toThrow(/is disabled for this entity/);
  });
});
