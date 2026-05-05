import type { DatabaseService } from '@backstage/backend-plugin-api';
import type { DailyUptime } from '../types';

const TABLE_NAME = 'uptimerobot_daily_uptime';
const SOURCE_VERSION = 'v1';

// ////////////////////////////////////////////
//                  TYPES                    //
// ////////////////////////////////////////////

/** The daily uptime cache row type
 * 
 * @param DailyUptime - The daily uptime type
 * @param error - The error message
 * @returns The daily uptime cache row type
 */
type DailyUptimeCacheRow = DailyUptime & {
  error?: string;
};

/** The daily uptime database row type
 * 
 * @param monitor_id - The monitor ID
 * @param monitor_name - The monitor name
 * @param entity_ref - The entity reference
 * @param date - The date
 * @param uptime_ratio - The uptime ratio
 * @param fetched_at - The fetched at date
 * @param error - The error message
 * @param source_version - The source version
 * @returns The daily uptime database row type
 */
type DailyUptimeDbRow = {
  monitor_id: string;
  monitor_name: string;
  entity_ref: string;
  date: string;
  uptime_ratio: number | null;
  fetched_at: string;
  error: string | null;
  source_version: string;
};

/** The daily uptime cache stats type
 * 
 * @param records - The number of records
 * @param components - The number of components
 * @param oldestDate - The oldest date
 * @param newestDate - The newest date
 * @returns The daily uptime cache stats type
 */
export type DailyUptimeCacheStats = {
  records: number;
  components: number;
  oldestDate?: string;
  newestDate?: string;
};

/** The daily uptime cache identity type
 * 
 * @param entityRef - The entity reference
 * @param monitorId - The monitor ID
 * @param monitorName - The monitor name
 * @returns The daily uptime cache identity type
 */
export type DailyUptimeCacheIdentity = {
  entityRef: string;
  monitorId: string | number;
  monitorName: string;
};

// ////////////////////////////////////////////
//          MAIN CLASS DEFINITION            //
// ////////////////////////////////////////////

/** Persistent store for immutable historical daily uptime buckets */
export class DailyUptimeStore {
  readonly #database: DatabaseService;
  #initPromise?: Promise<void>; // For initializing the database table if it doesn't exist

  /** The daily uptime store constructor
   * 
   * @param database - The database service
   */
  constructor(database: DatabaseService) {
    this.#database = database;
  }

  /** Get the daily uptime for a given identity and dates
   * 
   * @param identity - The daily uptime cache identity
   * @param dates - The dates to get the daily uptime for
   * @returns The daily uptime for the given identity and dates
   */
  async getDailyUptime(
    identity: DailyUptimeCacheIdentity,
    dates: string[],
  ): Promise<Map<string, DailyUptimeCacheRow>> {
    await this.#ensureInitialized();
    if (dates.length === 0) return new Map();

    // Get the daily uptime from the database
    const knex = await this.#database.getClient();
    const rows = await knex<DailyUptimeDbRow>(TABLE_NAME)
      .where({ monitor_id: String(identity.monitorId), source_version: SOURCE_VERSION })
      .whereIn('date', dates);

    // Return the daily uptime as a map of date to daily uptime
    return new Map(
      rows.map(row => [
        row.date,
        {
          date: row.date,
          uptimeRatio: row.uptime_ratio ?? undefined,
          error: row.error ?? undefined,
        },
      ]),
    );
  }

  /** Upsert the daily uptime for a given identity and day
   * 
   * @param identity - The daily uptime cache identity
   * @param day - The day to upsert the daily uptime for
   * @returns The daily uptime for the given identity and day
   */
  async upsertDailyUptime(
    identity: DailyUptimeCacheIdentity,
    day: DailyUptimeCacheRow,
  ): Promise<void> {
    await this.#ensureInitialized();

    const knex = await this.#database.getClient();
    await knex<DailyUptimeDbRow>(TABLE_NAME)
      .insert({
        monitor_id: String(identity.monitorId),
        monitor_name: identity.monitorName,
        entity_ref: identity.entityRef,
        date: day.date,
        uptime_ratio: day.uptimeRatio ?? null,
        fetched_at: new Date().toISOString(),
        error: day.error ?? null,
        source_version: SOURCE_VERSION,
      })
      .onConflict(['monitor_id', 'date'])
      .merge({
        monitor_name: identity.monitorName,
        entity_ref: identity.entityRef,
        uptime_ratio: day.uptimeRatio ?? null,
        fetched_at: new Date().toISOString(),
        error: day.error ?? null,
        source_version: SOURCE_VERSION,
      });
  }

  /** Delete the daily uptime for a given monitor ID and oldest date
   * 
   * @param monitorId - The monitor ID to delete the daily uptime for
   * @param oldestDate - The oldest date to delete the daily uptime for
   * @returns The daily uptime for the given monitor ID and oldest date
   */
  async deleteOlderThan(monitorId: string | number, oldestDate: string): Promise<void> {
    await this.#ensureInitialized();
    const knex = await this.#database.getClient();
    await knex<DailyUptimeDbRow>(TABLE_NAME)
      .where({ monitor_id: String(monitorId) })
      .andWhere('date', '<', oldestDate)
      .delete();
  }

  /** Reset all the daily uptime
   * 
   * @returns The number of daily uptime records deleted
   */
  async resetAll(): Promise<number> {
    await this.#ensureInitialized();
    const knex = await this.#database.getClient();
    return knex<DailyUptimeDbRow>(TABLE_NAME).delete();
  }

  /** Reset the daily uptime for a given entity reference
   * 
   * @param entityRef - The entity reference to reset the daily uptime for
   * @returns The number of daily uptime records deleted
   */
  async resetEntity(entityRef: string): Promise<number> {
    await this.#ensureInitialized();
    const knex = await this.#database.getClient();
    return knex<DailyUptimeDbRow>(TABLE_NAME).where({ entity_ref: entityRef }).delete();
  }

  /** Reset the daily uptime for a given monitor ID
   * 
   * @param monitorId - The monitor ID to reset the daily uptime for
   * @returns The number of daily uptime records deleted
   */
  async resetMonitor(monitorId: string | number): Promise<number> {
    await this.#ensureInitialized();
    const knex = await this.#database.getClient();
    return knex<DailyUptimeDbRow>(TABLE_NAME)
      .where({ monitor_id: String(monitorId) })
      .delete();
  }

  /** Get the daily uptime cache stats
   * 
   * @returns The daily uptime cache stats
   */
  async getStats(): Promise<DailyUptimeCacheStats> {
    await this.#ensureInitialized();
    const knex = await this.#database.getClient();
    const rows = await knex<DailyUptimeDbRow>(TABLE_NAME)
      .select('entity_ref', 'date')
      .where({ source_version: SOURCE_VERSION });

    const dates = rows.map(row => row.date).sort();
    return {
      records: rows.length,
      components: new Set(rows.map(row => row.entity_ref)).size,
      oldestDate: dates[0],
      newestDate: dates[dates.length - 1],
    };
  }
  

  // ////////////////////////////////////////////
  //              HELPER UTILITIES             //
  // ////////////////////////////////////////////

  /** Ensure the daily uptime store is initialized
   * 
   * @returns The daily uptime store
   */
  async #ensureInitialized(): Promise<void> {
    if (!this.#initPromise) this.#initPromise = this.#initialize();
    return this.#initPromise;
  }

  /** Initialize the daily uptime store
   * 
   * @returns The daily uptime store
   */
  async #initialize(): Promise<void> {
    if (this.#database.migrations?.skip) return;

    const knex = await this.#database.getClient();
    const exists = await knex.schema.hasTable(TABLE_NAME);
    if (exists) return;

    await knex.schema.createTable(TABLE_NAME, table => {
      table.string('monitor_id').notNullable();
      table.string('monitor_name').notNullable();
      table.string('entity_ref').notNullable();
      table.string('date').notNullable();
      table.float('uptime_ratio').nullable();
      table.string('fetched_at').notNullable();
      table.text('error').nullable();
      table.string('source_version').notNullable();
      table.unique(['monitor_id', 'date']);
      table.index(['entity_ref', 'date']);
      table.index(['monitor_id', 'date']);
    });
  }
}
