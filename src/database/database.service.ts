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

/** Connection to MySQL / MariaDB. Connects on first use, so the site starts even if MySQL is still off. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly name: string;
  private readonly connection;
  private ready?: Promise<Pool>;

  constructor(config: ConfigService) {
    this.name = config.get<string>('DB_NAME') || 'bp_management';
    if (!/^\w+$/.test(this.name)) throw new Error('DB_NAME may only contain letters, numbers and underscores');
    this.connection = {
      host: config.get<string>('DB_HOST') || '127.0.0.1',
      port: Number(config.get('DB_PORT')) || 3306,
      user: config.get<string>('DB_USER') || 'root',
      password: config.get<string>('DB_PASSWORD') || '',
      charset: 'utf8mb4',
      timezone: 'Z',
      connectTimeout: 5000,
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
    try {
      const [rows] = await (await this.pool()).query(sql, params);
      return rows as T[];
    } catch (e) {
      throw this.translate(e);
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
        if (!String((e as { code?: string }).code).includes('ACCESS_DENIED')) throw e;
      } finally {
        await admin.end().catch(() => undefined);
      }

      const pool = createPool({ ...this.connection, database: this.name, connectionLimit: 10 });
      // Times are UTC. Strict mode: XAMPP would otherwise cut off text that is too long without an error.
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
      this.logger.error(`Could not use MySQL at ${this.connection.host}:${this.connection.port} (${code ?? message}). Start MySQL in XAMPP and check the DB_ settings in .env.`);
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

  private translate(e: unknown): unknown {
    const code = String((e as { code?: string }).code);
    if (CONNECTION_ERRORS.has(code)) {
      return new ServiceUnavailableException('The database is not running. Start MySQL in XAMPP, then try again.');
    }
    if (code.includes('ACCESS_DENIED')) {
      return new ServiceUnavailableException('The database did not accept the login. Check the DB_ settings in .env.');
    }
    this.logger.error(`Query failed: ${(e as Error).message}`);
    return e;
  }
}
