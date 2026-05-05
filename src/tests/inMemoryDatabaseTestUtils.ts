import type { DatabaseService } from '@backstage/backend-plugin-api';

type Row = Record<string, unknown>;
type TestTableBuilder = {
  float: () => ReturnType<typeof createColumnBuilder>;
  index: () => undefined;
  string: () => ReturnType<typeof createColumnBuilder>;
  text: () => ReturnType<typeof createColumnBuilder>;
  unique: () => undefined;
};

class InMemoryQueryBuilder {
  readonly #rows: Row[];
  #filters: Array<(row: Row) => boolean> = [];
  #insertRow?: Row;
  #conflictColumns: string[] = [];
  #selectedColumns?: string[];

  constructor(rows: Row[]) {
    this.#rows = rows;
  }

  select(...columns: string[]) {
    this.#selectedColumns = columns;
    return this;
  }

  where(columnOrValues: string | Row, value?: unknown) {
    if (typeof columnOrValues === 'string') {
      this.#filters.push(row => row[columnOrValues] === value);
    } else {
      this.#filters.push(row =>
        Object.entries(columnOrValues).every(([key, expected]) => row[key] === expected),
      );
    }
    return this;
  }

  andWhere(column: string, operator: string, value: unknown) {
    if (operator === '<') {
      this.#filters.push(row => String(row[column]) < String(value));
      return this;
    }
    throw new Error(`Unsupported test query operator '${operator}'`);
  }

  whereIn(column: string, values: unknown[]) {
    this.#filters.push(row => values.includes(row[column]));
    return this;
  }

  insert(row: Row) {
    this.#insertRow = row;
    return this;
  }

  onConflict(columns: string[]) {
    this.#conflictColumns = columns;
    return this;
  }

  async merge(updates: Row) {
    if (!this.#insertRow) throw new Error('merge called without insert');
    const existing = this.#rows.find(row =>
      this.#conflictColumns.every(column => row[column] === this.#insertRow?.[column]),
    );
    if (existing) {
      Object.assign(existing, updates);
    } else {
      this.#rows.push({ ...this.#insertRow });
    }
    return 1;
  }

  async delete() {
    const before = this.#rows.length;
    for (let index = this.#rows.length - 1; index >= 0; index--) {
      if (this.#matches(this.#rows[index])) {
        this.#rows.splice(index, 1);
      }
    }
    return before - this.#rows.length;
  }

  then<TResult1 = Row[], TResult2 = never>(
    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.#result()).then(onfulfilled, onrejected);
  }

  #matches(row: Row) {
    return this.#filters.every(filter => filter(row));
  }

  #result() {
    return this.#rows.filter(row => this.#matches(row)).map(row => {
      if (!this.#selectedColumns) return { ...row };
      return Object.fromEntries(
        this.#selectedColumns.map(column => [column, row[column]]),
      );
    });
  }
}

function createColumnBuilder() {
  return {
    notNullable() {
      return this;
    },
    nullable() {
      return this;
    },
  };
}

export function createInMemoryDatabaseService() {
  const rows: Row[] = [];
  let tableExists = false;

  const knex = ((tableName: string) => {
    if (tableName !== 'uptimerobot_daily_uptime') {
      throw new Error(`Unexpected test table '${tableName}'`);
    }
    return new InMemoryQueryBuilder(rows);
  }) as unknown as {
    schema: {
      hasTable(tableName: string): Promise<boolean>;
      createTable(tableName: string, callback: (table: TestTableBuilder) => void): Promise<void>;
    };
  };

  knex.schema = {
    async hasTable() {
      return tableExists;
    },
    async createTable(_tableName, callback) {
      tableExists = true;
      const table = {
        float: createColumnBuilder,
        index: () => undefined,
        string: createColumnBuilder,
        text: createColumnBuilder,
        unique: () => undefined,
      };
      callback(table);
    },
  };

  return {
    database: {
      getClient: async () => knex,
    } as unknown as DatabaseService,
    rows,
  };
}
