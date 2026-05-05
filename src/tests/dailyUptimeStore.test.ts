import { createInMemoryDatabaseService } from './inMemoryDatabaseTestUtils';
import { DailyUptimeStore } from '../services/dailyUptimeStore';

describe('DailyUptimeStore', () => {
  const identity = {
    entityRef: 'component:default/demo',
    monitorId: 123,
    monitorName: 'Demo',
  };

  it('stores, reads, and updates daily uptime rows', async () => {
    const { database } = createInMemoryDatabaseService();
    const store = new DailyUptimeStore(database);

    await store.upsertDailyUptime(identity, { date: '2026-05-01', uptimeRatio: 99.5 });
    await store.upsertDailyUptime(identity, { date: '2026-05-01', uptimeRatio: 100 });

    const rows = await store.getDailyUptime(identity, ['2026-05-01']);
    expect(rows.get('2026-05-01')).toEqual({
      date: '2026-05-01',
      uptimeRatio: 100,
      error: undefined,
    });
  });

  it('deletes stale rows and reports cache stats', async () => {
    const { database } = createInMemoryDatabaseService();
    const store = new DailyUptimeStore(database);

    await store.upsertDailyUptime(identity, { date: '2026-04-30', uptimeRatio: 99 });
    await store.upsertDailyUptime(identity, { date: '2026-05-01', uptimeRatio: 100 });
    await store.deleteOlderThan(identity.monitorId, '2026-05-01');

    const rows = await store.getDailyUptime(identity, ['2026-04-30', '2026-05-01']);
    expect(rows.has('2026-04-30')).toBe(false);
    expect(rows.has('2026-05-01')).toBe(true);
    expect(await store.getStats()).toEqual({
      records: 1,
      components: 1,
      oldestDate: '2026-05-01',
      newestDate: '2026-05-01',
    });
  });

  it('resets all rows or one entity', async () => {
    const { database } = createInMemoryDatabaseService();
    const store = new DailyUptimeStore(database);

    await store.upsertDailyUptime(identity, { date: '2026-05-01', uptimeRatio: 100 });
    await store.upsertDailyUptime(
      { ...identity, entityRef: 'component:default/other', monitorId: 456 },
      { date: '2026-05-01', uptimeRatio: 100 },
    );

    expect(await store.resetEntity(identity.entityRef)).toBe(1);
    expect((await store.getStats()).records).toBe(1);
    expect(await store.resetAll()).toBe(1);
    expect((await store.getStats()).records).toBe(0);
  });

  it('resetMonitor deletes only rows for that monitor', async () => {
    const { database } = createInMemoryDatabaseService();
    const store = new DailyUptimeStore(database);

    await store.upsertDailyUptime(identity, { date: '2026-05-01', uptimeRatio: 100 });
    await store.upsertDailyUptime(
      { ...identity, monitorId: 999, entityRef: 'component:default/other' },
      { date: '2026-05-01', uptimeRatio: 50 },
    );

    expect(await store.resetMonitor(identity.monitorId)).toBe(1);
    const left = await store.getDailyUptime(
      { ...identity, monitorId: 999, entityRef: 'component:default/other', monitorName: 'X' },
      ['2026-05-01'],
    );
    expect(left.has('2026-05-01')).toBe(true);
  });

  it('getDailyUptime returns empty map for empty date list without touching storage', async () => {
    const { database } = createInMemoryDatabaseService();
    const store = new DailyUptimeStore(database);
    expect(await store.getDailyUptime(identity, [])).toEqual(new Map());
  });

  it('returns cached rows that only have error set', async () => {
    const { database } = createInMemoryDatabaseService();
    const store = new DailyUptimeStore(database);
    await store.upsertDailyUptime(identity, { date: '2026-05-01', error: 'rate limited' });
    const rows = await store.getDailyUptime(identity, ['2026-05-01']);
    expect(rows.get('2026-05-01')).toEqual({
      date: '2026-05-01',
      error: 'rate limited',
    });
  });
});
