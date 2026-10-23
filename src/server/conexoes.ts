import pg from 'pg';
import { createClient } from 'redis';

export function criarPool(esquema?: string, conexoes = 20) {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://redisflow:redisflow@localhost:5432/redisflow',
    max: conexoes,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
    query_timeout: 15000,
    options: esquema ? `-c search_path=${esquema}` : '-c search_path=public',
  });
}

export function criarRedis() {
  const cliente = createClient({
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    disableOfflineQueue: true,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
  });
  cliente.on('error', (erro: Error) => console.error('[Redis] Falha de conexão:', erro.message));
  return cliente;
}

export type ClienteRedis = ReturnType<typeof criarRedis>;

export const estruturaSql = `
  CREATE TABLE IF NOT EXISTS ticket_counters (
    mode TEXT PRIMARY KEY CHECK (mode IN ('postgres','redis')),
    last_number INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS tickets (
    id BIGSERIAL PRIMARY KEY,
    mode TEXT NOT NULL CHECK (mode IN ('postgres','redis')),
    number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','IN_SERVICE','COMPLETED')),
    counter TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    called_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE(mode, number)
  );
  CREATE INDEX IF NOT EXISTS ix_tickets_waiting ON tickets(mode,number) WHERE status='WAITING';
  CREATE UNIQUE INDEX IF NOT EXISTS ux_tickets_active_counter ON tickets(mode,counter) WHERE status='IN_SERVICE';
`;
