import { randomUUID } from 'node:crypto';
import { criarPool, criarRedis, estruturaSql } from './conexoes';
import { ServicoFila } from './fila';
import { Laboratorio } from './comparacao';
import { Coordenacao } from './coordenacao';
import { ErroAplicacao } from './erros';

export function criarSistema() {
  const pool = criarPool();
  pool.on('error', (erro: Error) => console.error('[PostgreSQL]', erro.message));
  const redis = criarRedis();
  const ouvintes = new Set<() => void>();
  const notificar = () => { for (const ouvinte of ouvintes) ouvinte(); };
  const fila = new ServicoFila(pool, redis, 'redisflow', notificar);
  const coordenacao = new Coordenacao();
  let inicializacao: Promise<void> | undefined;

  const laboratorio = new Laboratorio({
    async preparar() {
      if (!redis.isReady) throw new ErroAplicacao(503, 'Redis indisponível. Reconstrua a fila antes da comparação.');
      const { rows } = await pool.query<{ livres: number }>("SELECT current_setting('max_connections')::int - (SELECT count(*)::int FROM pg_stat_activity) AS livres");
      if (rows[0].livres < 25) throw new ErroAplicacao(503, 'PostgreSQL sem reserva de conexões para o laboratório.');
      const informacoes = String(await fila.comandoRedis(['INFO', 'memory']));
      const valores = Object.fromEntries(informacoes.split('\r\n').filter(linha => linha.includes(':')).map(linha => linha.split(':')));
      if (Number(valores.maxmemory) > 0 && (valores.maxmemory_policy !== 'noeviction' || Number(valores.used_memory) + 1000 * 256 > Number(valores.maxmemory) * 0.8)) {
        throw new ErroAplicacao(503, 'Redis sem margem de memória ou com política de remoção incompatível.');
      }
    },
    async isolar(operacao) {
      const esquema = `rfbench_${randomUUID().replaceAll('-', '')}`;
      const poolIsolado = criarPool(esquema, 20);
      poolIsolado.on('error', (erro: Error) => console.error('[Comparação PostgreSQL]', erro.message));
      const redisIsolado = criarRedis();
      const filaIsolada = new ServicoFila(poolIsolado, redisIsolado, esquema);
      await pool.query(`CREATE SCHEMA "${esquema}"`);
      try {
        await redisIsolado.connect();
        await poolIsolado.query(`
          CREATE TABLE ticket_counters (LIKE public.ticket_counters INCLUDING ALL);
          CREATE TABLE tickets (LIKE public.tickets INCLUDING ALL);
          CREATE SEQUENCE ticket_ids;
          ALTER TABLE tickets ALTER COLUMN id SET DEFAULT nextval('ticket_ids');
        `);
        return await operacao(filaIsolada);
      } finally {
        try {
          // A conexão principal pode limpar as chaves se a conexão da rodada falhar.
          const limpeza = redisIsolado.isReady ? filaIsolada : new ServicoFila(pool, redis, esquema);
          await limpeza.removerChaves();
        } finally {
          if (redisIsolado.isOpen) redisIsolado.destroy();
          await poolIsolado.end();
          await pool.query(`DROP SCHEMA "${esquema}" CASCADE`);
        }
      }
    },
  });

  return {
    pool, redis, fila, laboratorio, coordenacao, ouvintes,
    async inicializar() {
      inicializacao ??= (async () => {
        await pool.query(estruturaSql);
        try { await fila.reconstruir(); }
        catch (erro) { console.error('[Inicialização] Redis indisponível; modo PostgreSQL permanece disponível.', erro); }
      })().catch((erro: unknown) => { inicializacao = undefined; throw erro; });
      await inicializacao;
    },
    async encerrar() {
      laboratorio.cancelar();
      await laboratorio.tarefa;
      ouvintes.clear();
      if (redis.isOpen) redis.destroy();
      await pool.end();
    },
  };
}

// Compartilhar conexões, coordenação e laboratório entre rotas e recargas do Next.
const globalDoServidor = globalThis as typeof globalThis & { sistemaRedisFlow?: ReturnType<typeof criarSistema> };
export function obterSistema() {
  return globalDoServidor.sistemaRedisFlow ??= criarSistema();
}
