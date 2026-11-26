import { Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createConnection, createPool, Pool, PoolConnection } from 'mysql2/promise';
import { importJsonFiles } from './import-json';
import { TABLES } from './schema';

export type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Anything that means "the database cannot be reached right now". */
const CONNECTION_ERRORS = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'ER_SERVER_SHUTDOWN',
  'ER_CON_COUNT_ERROR',
]);

/**
 * Connection to MySQL, MariaDB (XAMPP) or TiDB Cloud. Connects on first use, so the site starts
 * even when the database is still off.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly name: string;
  private readonly connection;
  /** XAMPP on this computer, so the messages can say what to do */
  private readonly local: boolean;
  private ready?: Promise<Pool>;

  constructor(config: ConfigService) {
    // Either DATABASE_URL (as TiDB Cloud shows it) or the separate DB_ settings
    const url = config.get<string>('DATABASE_URL') ? new URL(config.get<string>('DATABASE_URL')!) : undefined;
    const host = url?.hostname || config.get<string>('DB_HOST') || '127.0.0.1';
    this.name = config.get<string>('DB_NAME') || url?.pathname.slice(1) || 'bp_management';
    if (!/^\w+$/.test(this.name)) throw new Error('DB_NAME may only contain letters, numbers and underscores');
    this.local = ['127.0.0.1', 'localhost', '::1'].includes(host);
    // TiDB Cloud only accepts encrypted connections
    const ssl = config.get<string>('DB_SSL') ? config.get<string>('DB_SSL') === 'true' : /\.tidbcloud\.com$/i.test(host);
    this.connection = {
      host,
      port: Number(url?.port || config.get('DB_PORT')) || 3306,
      user: url ? decodeURIComponent(url.username) : config.get<string>('DB_USER') || 'root',
      password: url ? decodeURIComponent(url.password) : config.get<string>('DB_PASSWORD') || '',
      ssl: ssl ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined,
      charset: 'utf8mb4',
      timezone: 'Z',
      connectTimeout: 10000,
      enableKeepAlive: true,
      decimalNumbers: true,
    };
  }

  async onModuleInit() {
    await this.pool().catch(() => undefined); // already logged
  }

  async onModuleDestroy() {
    const pool = await this.ready?.catch(() => undefined);
    await pool?.end().catch(() => undefined);
  }

  async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const pool = await this.pool().catch((e) => {
      throw this.translate(e, true);
    });
    for (let attempt = 1; ; attempt++) {
      try {
        const [rows] = await pool.query(sql, params);
        return rows as T[];
      } catch (e) {
        // A cloud database closes connections that sat idle; the pool then opens a fresh one
        if (attempt === 1 && CONNECTION_ERRORS.has(String((e as { code?: string }).code))) continue;
        throw this.translate(e);
      }
    }
  }

  private pool(): Promise<Pool> {
    // Try again on the next call when connecting failed
    this.ready ??= this.connect().catch((e) => {
      this.ready = undefined;
      throw e;
    });
    return this.ready;
  }

  private async connect(): Promise<Pool> {
    try {
      const admin = await createConnection(this.connection);
      try {
        await admin.query(`CREATE DATABASE IF NOT EXISTS \`${this.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      } catch (e) {
        // On shared hosting the database is made beforehand and creating is not allowed
        if (!/ACCESS_DENIED|access denied/i.test(`${(e as { code?: string }).code} ${(e as Error).message}`)) throw e;
      } finally {
        await admin.end().catch(() => undefined);
      }

      // Idle connections are closed after a minute, before a cloud database drops them itself
      const pool = createPool({ ...this.connection, database: this.name, connectionLimit: 10, maxIdle: 1, idleTimeout: 60000 });
      // Times are UTC. Strict mode: MariaDB in XAMPP would otherwise cut off text that is too long without an error.
      pool.pool.on('connection', (c) => {
        c.query("SET time_zone = '+00:00', SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION'");
      });
      try {
        for (const table of TABLES) await pool.query(table);
        await this.importOldFiles(pool);
      } catch (e) {
        await pool.end().catch(() => undefined);
        throw e;
      }
      this.logger.log(`Connected to MySQL database "${this.name}"`);
      return pool;
    } catch (e) {
      const { code, message } = e as { code?: string; message: string };
      this.logger.error(
        `Could not use the database at ${this.connection.host}:${this.connection.port} (${code ?? ''} ${message}). ` +
          (this.local ? 'Start MySQL in XAMPP and check the DB_ settings in .env.' : 'Check the DB_ settings and that the database is online.'),
      );
      throw e;
    }
  }

  private async importOldFiles(pool: Pool) {
    const connection: PoolConnection = await pool.getConnection();
    try {
      await importJsonFiles(connection, this.logger);
    } finally {
      connection.release();
    }
  }

  /** connecting: every failure to connect counts as "cannot be reached". */
  private translate(e: unknown, connecting = false): unknown {
    const code = String((e as { code?: string }).code);
    const message = String((e as Error).message);
    // TiDB Cloud reports a wrong password as ER_UNKNOWN_ERROR with this text
    if (code.includes('ACCESS_DENIED') || /access denied/i.test(message)) {
      return new ServiceUnavailableException('The database did not accept the login. Check the database user and password settings.');
    }
    if (connecting || CONNECTION_ERRORS.has(code) || /certificate|SSL|TLS|insecure transport/i.test(message)) {
      return new ServiceUnavailableException(
        this.local
          ? 'The database is not running. Start MySQL in XAMPP, then try again.'
          : 'The database cannot be reached right now. Try again in a minute. If it keeps happening, an admin needs to check the database settings.',
      );
    }
    this.logger.error(`Query failed: ${message}`);
    return e;
  }
}
