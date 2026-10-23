import type { Pool, PoolClient } from 'pg';
import type { EstadoFila, Modo, Senha } from '@/types/aplicacao';
import type { ClienteRedis } from './conexoes';
import { ExclusaoPorChave } from './coordenacao';
import { codigoDoErro, ErroAplicacao } from './erros';

interface RegistroSenha {
  id: string;
  mode: Modo;
  number: number;
  status: 'WAITING' | 'IN_SERVICE' | 'COMPLETED';
  counter: string | null;
  created_at: Date;
  called_at: Date | null;
  completed_at: Date | null;
}

function converterSenha(registro: RegistroSenha): Senha {
  return {
    id: String(registro.id), numero: registro.number,
    situacao: ({ WAITING: 'aguardando', IN_SERVICE: 'em_atendimento', COMPLETED: 'concluida' } as const)[registro.status],
    guiche: registro.counter, criadaEm: registro.created_at.toISOString(),
    chamadaEm: registro.called_at?.toISOString() ?? null, concluidaEm: registro.completed_at?.toISOString() ?? null,
  };
}

export class ServicoFila {
  private exclusao = new ExclusaoPorChave();
  private aguardando: string;
  private processamento: string;

  constructor(readonly pool: Pool, readonly redis: ClienteRedis, prefixo = 'redisflow', private notificar = () => {}) {
    this.aguardando = `${prefixo}:waiting`;
    this.processamento = `${prefixo}:processing`;
  }

  async comandoRedis(argumentos: string[]): Promise<unknown> {
    if (!this.redis.isReady) throw new ErroAplicacao(503, 'Redis indisponível. Reconstrua a fila após restabelecer a conexão.');
    let temporizador: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.redis.sendCommand(argumentos),
        new Promise<never>((_, rejeitar) => {
          temporizador = setTimeout(() => {
            if (this.redis.isOpen) this.redis.destroy();
            rejeitar(new ErroAplicacao(503, 'Tempo limite do Redis excedido. Resultado incerto; reconstrua a fila.'));
          }, 10000);
        }),
      ]);
    } finally { clearTimeout(temporizador); }
  }

  private async transacao<T>(operacao: (cliente: PoolClient) => Promise<T>): Promise<T> {
    const cliente = await this.pool.connect();
    try {
      await cliente.query('BEGIN');
      const resultado = await operacao(cliente);
      await cliente.query('COMMIT');
      return resultado;
    } catch (erro) {
      await cliente.query('ROLLBACK').catch(() => undefined);
      throw erro;
    } finally { cliente.release(); }
  }

  async emitir(modo: Modo, quantidade: number): Promise<Senha[]> {
    return this.exclusao.executar(`producao:${modo}`, async () => {
      // Não persistir novas senhas Redis quando a indisponibilidade já é conhecida.
      if (modo === 'redis' && !this.redis.isReady) throw new ErroAplicacao(503, 'Redis indisponível. Reconstrua a fila para continuar.');
      const registros = await this.transacao(async cliente => {
        const { rows } = await cliente.query<{ last_number: number }>(`
          INSERT INTO ticket_counters(mode,last_number) VALUES ($1,$2)
          ON CONFLICT(mode) DO UPDATE SET last_number=ticket_counters.last_number + EXCLUDED.last_number
          RETURNING last_number`, [modo, quantidade]);
        const ultimo = rows[0].last_number;
        const resultado = await cliente.query<RegistroSenha>(`
          INSERT INTO tickets(mode,number) SELECT $1,seq FROM generate_series($2::integer,$3::integer) AS seq
          RETURNING *`, [modo, ultimo - quantidade + 1, ultimo]);
        return resultado.rows.sort((a, b) => a.number - b.number);
      });
      try {
        if (modo === 'redis') await this.comandoRedis(['LPUSH', this.aguardando, ...registros.map(registro => String(registro.id))]);
      } catch {
        if (this.redis.isOpen) this.redis.destroy();
        throw new ErroAplicacao(503, 'Senhas salvas no PostgreSQL, mas a publicação no Redis falhou. Reconstrua a fila; não repita a emissão.');
      } finally { this.notificar(); }
      return registros.map(converterSenha);
    });
  }

  async chamar(modo: Modo, guiche: string): Promise<Senha | null> {
    return this.exclusao.executar(`guiche:${modo}:${guiche}`, async () => {
      try {
        let registro: RegistroSenha | undefined;
        if (modo === 'postgres') {
          registro = await this.transacao(async cliente => {
            const ocupado = await cliente.query("SELECT id FROM tickets WHERE mode=$1 AND counter=$2 AND status='IN_SERVICE'", [modo, guiche]);
            if (ocupado.rowCount) throw new ErroAplicacao(409, 'Este guichê já possui atendimento ativo.');
            const { rows } = await cliente.query<RegistroSenha>(`
              WITH proxima AS (
                SELECT id FROM tickets WHERE mode='postgres' AND status='WAITING'
                ORDER BY number FOR UPDATE SKIP LOCKED LIMIT 1
              )
              UPDATE tickets SET status='IN_SERVICE', counter=$1, called_at=NOW()
              WHERE id=(SELECT id FROM proxima) RETURNING *`, [guiche]);
            return rows[0];
          });
        } else {
          const ocupado = await this.pool.query("SELECT id FROM tickets WHERE mode=$1 AND counter=$2 AND status='IN_SERVICE'", [modo, guiche]);
          if (ocupado.rowCount) throw new ErroAplicacao(409, 'Este guichê já possui atendimento ativo.');
          for (;;) {
            const identificador = await this.comandoRedis(['LMOVE', this.aguardando, this.processamento, 'RIGHT', 'LEFT']);
            if (identificador === null) return null;
            // Uma falha deixa o ID em processamento. Não repetir uma escrita de resultado incerto.
            const { rows } = await this.pool.query<RegistroSenha>(`
              UPDATE tickets SET status='IN_SERVICE', counter=$2, called_at=NOW()
              WHERE id=$1 AND mode='redis' AND status='WAITING' RETURNING *`, [String(identificador), guiche]);
            this.notificar();
            await this.comandoRedis(['LREM', this.processamento, '1', String(identificador)]);
            if (rows[0]) { registro = rows[0]; break; }
          }
        }
        if (registro) this.notificar();
        return registro ? converterSenha(registro) : null;
      } catch (erro) {
        if (modo === 'redis' && !(erro instanceof ErroAplicacao && erro.codigo === 409)) {
          if (this.redis.isOpen) this.redis.destroy();
          this.notificar();
        }
        if (codigoDoErro(erro) === '23505') throw new ErroAplicacao(409, 'Guichê ocupado. Reconstrua a fila Redis se necessário.');
        throw erro;
      }
    });
  }

  async finalizar(modo: Modo, guiche: string): Promise<Senha | null> {
    return this.exclusao.executar(`guiche:${modo}:${guiche}`, async () => {
      const { rows } = await this.pool.query<RegistroSenha>(`
        UPDATE tickets SET status='COMPLETED', completed_at=NOW()
        WHERE mode=$1 AND counter=$2 AND status='IN_SERVICE' RETURNING *`, [modo, guiche]);
      if (rows[0]) this.notificar();
      return rows[0] ? converterSenha(rows[0]) : null;
    });
  }

  /** O chamador deve adquirir a coordenação exclusiva antes da reconstrução. */
  async reconstruir(): Promise<number> {
    try {
      if (!this.redis.isOpen) await this.redis.connect();
      const { rows } = await this.pool.query<{ id: string }>("SELECT id FROM tickets WHERE mode='redis' AND status='WAITING' ORDER BY number");
      await this.comandoRedis(['DEL', this.aguardando, this.processamento]);
      for (let inicio = 0; inicio < rows.length; inicio += 1000) {
        await this.comandoRedis(['LPUSH', this.aguardando, ...rows.slice(inicio, inicio + 1000).map(registro => String(registro.id))]);
      }
      this.notificar();
      return rows.length;
    } catch (erro) {
      if (this.redis.isOpen) this.redis.destroy();
      this.notificar();
      throw erro;
    }
  }

  async limpar(modo?: Modo): Promise<void> {
    // Redis deve estar disponível antes de qualquer exclusão persistente.
    if ((!modo || modo === 'redis') && !this.redis.isReady) throw new ErroAplicacao(503, 'Redis indisponível. Nenhum dado foi apagado.');
    try {
      await this.transacao(async cliente => {
        if (modo) {
          await cliente.query('DELETE FROM tickets WHERE mode=$1', [modo]);
          await cliente.query('DELETE FROM ticket_counters WHERE mode=$1', [modo]);
        } else {
          await cliente.query('TRUNCATE TABLE tickets, ticket_counters RESTART IDENTITY');
        }
        if (!modo || modo === 'redis') await this.comandoRedis(['DEL', this.aguardando, this.processamento]);
      });
    } catch (erro) {
      // Uma falha de commit após DEL deixa o resultado entre os bancos incerto.
      if ((!modo || modo === 'redis') && this.redis.isOpen) this.redis.destroy();
      this.notificar();
      throw erro;
    }
    this.notificar();
  }

  async estado(modo: Modo): Promise<EstadoFila> {
    const [indicadores, aguardando, ativas, recentes] = await Promise.all([
      this.pool.query<EstadoFila['indicadores']>(`SELECT
        COUNT(*) FILTER (WHERE status='WAITING')::int AS aguardando,
        COUNT(*) FILTER (WHERE status='IN_SERVICE')::int AS "emAtendimento",
        COUNT(*) FILTER (WHERE status='COMPLETED')::int AS concluidas,
        COUNT(*)::int AS total FROM tickets WHERE mode=$1`, [modo]),
      this.pool.query<RegistroSenha>("SELECT * FROM tickets WHERE mode=$1 AND status='WAITING' ORDER BY number LIMIT 12", [modo]),
      this.pool.query<RegistroSenha>("SELECT * FROM tickets WHERE mode=$1 AND status='IN_SERVICE' ORDER BY counter", [modo]),
      this.pool.query<RegistroSenha>('SELECT * FROM tickets WHERE mode=$1 AND called_at IS NOT NULL ORDER BY called_at DESC,id DESC LIMIT 8', [modo]),
    ]);
    let tamanhoRedis: number | null = null;
    if (modo === 'redis' && this.redis.isReady) {
      try { tamanhoRedis = Number(await this.comandoRedis(['LLEN', this.aguardando])); } catch { /* A fila SQL permanece visível. */ }
    }
    return {
      modo, indicadores: indicadores.rows[0], aguardando: aguardando.rows.map(converterSenha),
      ativas: ativas.rows.map(converterSenha), recentes: recentes.rows.map(converterSenha),
      redisDisponivel: this.redis.isReady, tamanhoRedis,
    };
  }

  async auditar(modo: Modo): Promise<{ total: number; concluidas: number }> {
    const { rows } = await this.pool.query<{ total: number; concluidas: number }>(
      "SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='COMPLETED')::int AS concluidas FROM tickets WHERE mode=$1", [modo]);
    return rows[0];
  }

  async removerChaves(): Promise<void> {
    await this.comandoRedis(['DEL', this.aguardando, this.processamento]);
  }
}
