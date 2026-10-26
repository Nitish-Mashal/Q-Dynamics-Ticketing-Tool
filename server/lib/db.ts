import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { NodeFS } from "@electric-sql/pglite/nodefs";
import { readFileSync, readdirSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, "..", "..");
const DEFAULT_DATA_DIR = join(PROJECT_ROOT, ".local", "pglite");
const MIGRATIONS_DIR = join(PROJECT_ROOT, "supabase", "migrations");
const SEED_FILE = join(PROJECT_ROOT, "supabase", "seed.sql");
const SHIM_FILE = join(HERE, "..", "shim.sql");

export type Claims = Record<string, unknown> & { sub?: string };

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  affectedRows: number;
}

export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface ColumnInfo {
  name: string;
  dataType: string;
  udtName: string;
  isNullable: boolean;
}

export interface ForeignKey {
  constraint: string;
  srcTable: string;
  srcColumn: string;
  dstTable: string;
  dstColumn: string;
}

export interface TableInfo {
  name: string;
  columns: Map<string, ColumnInfo>;
  columnOrder: string[];
  primaryKey: string[];
  foreignKeys: ForeignKey[];
}

const MIGRATION_TABLE_SQL = `
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name text,
    applied_at timestamptz not null default now()
  );
`;

export class LocalDb {
  private pg: PGlite | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private tables = new Map<string, TableInfo>();
  private enumTypes = new Set<string>();
  readonly dataDir: string;

  constructor(dataDir = DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
  }

  get ready(): boolean {
    return this.pg !== null;
  }

  async init(opts: { reset?: boolean; seed?: boolean } = {}): Promise<void> {
    if (opts.reset && existsSync(this.dataDir)) {
      rmSync(this.dataDir, { recursive: true, force: true });
    }
    mkdirSync(this.dataDir, { recursive: true });
    this.pg = new PGlite({
      dataDir: this.dataDir,
      fs: new NodeFS(this.dataDir),
      extensions: { pgcrypto },
    });
    await this.pg.waitReady;
    await this.execAsSuperuser(MIGRATION_TABLE_SQL);
    await this.execAsSuperuser(readFileSync(SHIM_FILE, "utf8"));
    const applied = await this.applyMigrations();
    if (opts.seed || applied > 0) {
      await this.execAsSuperuser(readFileSync(SEED_FILE, "utf8"));
    }
    await this.refreshSchema();
  }

  private async applyMigrations(): Promise<number> {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const done = new Set<string>();
    const existing = await this.queryAsSuperuser<{ version: string }>(
      "select version from supabase_migrations.schema_migrations",
    );
    for (const row of existing.rows) done.add(row.version);

    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      if (done.has(version)) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      await this.execAsSuperuser(sql);
      await this.queryAsSuperuser(
        "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
        [version, file],
      );
      count += 1;
      console.log(`  applied migration ${file}`);
    }
    return count;
  }

  async execAsSuperuser(sql: string): Promise<void> {
    await this.enqueue(async () => {
      await this.require().exec(sql);
    });
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async queryAsSuperuser<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.enqueue(async () => {
      const pg = this.require();
      const res = await pg.query<T>(sql, params);
      return { rows: res.rows as T[], affectedRows: res.affectedRows ?? res.rows.length };
    });
  }

  async withRequest<T>(
    claims: Claims | null,
    role: "anon" | "authenticated" | "service_role",
    fn: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const pg = this.require();
      const tx: Tx = {
        query: async <R>(sql: string, params?: unknown[]) => {
          const res = await pg.query<R>(sql, params);
          return { rows: res.rows as R[], affectedRows: res.affectedRows ?? res.rows.length };
        },
        exec: async (sql: string) => {
          await pg.exec(sql);
        },
      };
      await pg.exec("begin");
      try {
        await pg.query("select set_config('request.jwt.claims', $1, true)", [
          claims ? JSON.stringify(claims) : "",
        ]);
        await pg.query("select set_config('request.jwt.claim.sub', $1, true)", [
          typeof claims?.sub === "string" ? claims.sub : "",
        ]);
        await pg.query("select set_config('request.jwt.claim.role', $1, true)", [
          typeof claims?.role === "string" ? claims.role : role,
        ]);
        await pg.exec(`set local role ${role}`);
        const out = await fn(tx);
        await pg.exec("commit");
        return out;
      } catch (err) {
        try {
          await pg.exec("rollback");
        } catch {
          /* already rolled back */
        }
        throw err;
      }
    });
  }

  async refreshSchema(): Promise<void> {
    const cols = await this.queryAsSuperuser<{
      table_name: string;
      column_name: string;
      data_type: string;
      udt_name: string;
      is_nullable: string;
      ordinal_position: number;
    }>(
      `select table_name, column_name, data_type, udt_name, is_nullable, ordinal_position
         from information_schema.columns
        where table_schema = 'public'
        order by table_name, ordinal_position`,
    );
    const pks = await this.queryAsSuperuser<{ table_name: string; column_name: string }>(
      `select tc.table_name, kcu.column_name
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
        where tc.table_schema = 'public' and tc.constraint_type = 'PRIMARY KEY'
        order by kcu.ordinal_position`,
    );
    const fks = await this.queryAsSuperuser<{
      constraint_name: string;
      src_table: string;
      src_column: string;
      dst_table: string;
      dst_column: string;
    }>(
      `select tc.constraint_name, kcu.table_name as src_table, kcu.column_name as src_column,
              ccu.table_name as dst_table, ccu.column_name as dst_column
         from information_schema.table_constraints tc
         join information_schema.key_column_usage kcu
           on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
         join information_schema.constraint_column_usage ccu
           on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
        where tc.table_schema = 'public' and tc.constraint_type = 'FOREIGN KEY'
        order by tc.constraint_name`,
    );
    const enums = await this.queryAsSuperuser<{ typname: string }>(
      `select t.typname from pg_type t
         join pg_namespace n on n.oid = t.typnamespace
        where n.nspname = 'public' and t.typtype = 'e'`,
    );

    this.tables.clear();
    for (const c of cols.rows) {
      let info = this.tables.get(c.table_name);
      if (!info) {
        info = {
          name: c.table_name,
          columns: new Map(),
          columnOrder: [],
          primaryKey: [],
          foreignKeys: [],
        };
        this.tables.set(c.table_name, info);
      }
      info.columns.set(c.column_name, {
        name: c.column_name,
        dataType: c.data_type,
        udtName: c.udt_name,
        isNullable: c.is_nullable === "YES",
      });
      info.columnOrder.push(c.column_name);
    }
    for (const p of pks.rows) {
      this.tables.get(p.table_name)?.primaryKey.push(p.column_name);
    }
    for (const f of fks.rows) {
      this.tables.get(f.src_table)?.foreignKeys.push({
        constraint: f.constraint_name,
        srcTable: f.src_table,
        srcColumn: f.src_column,
        dstTable: f.dst_table,
        dstColumn: f.dst_column,
      });
    }
    this.enumTypes = new Set(enums.rows.map((e) => e.typname));
  }

  table(name: string): TableInfo | undefined {
    return this.tables.get(name);
  }

  tableNames(): string[] {
    return [...this.tables.keys()];
  }

  isEnum(name: string): boolean {
    return this.enumTypes.has(name);
  }

  private require(): PGlite {
    if (!this.pg) throw new Error("LocalDb not initialised; call init() first");
    return this.pg;
  }
}
