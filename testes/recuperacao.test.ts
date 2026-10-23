import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ServicoFila } from '../src/server/fila';

function recursosFalsos({ falharPublicacao = false, falharCommit = false, disponivel = true } = {}) {
  const operacoes: string[] = [];
  let notificacoes = 0;
  const cliente = {
    async query(texto: string) {
      if (texto === 'COMMIT' && falharCommit) { operacoes.push('COMMIT incerto'); throw Error('Falha de confirmação SQL'); }
      if (texto.includes('RETURNING last_number')) { operacoes.push('numerar'); return { rows: [{ last_number: 1 }] }; }
      if (texto.includes('INSERT INTO tickets')) {
        operacoes.push('persistir');
        return { rows: [{ id: '1', mode: 'redis', number: 1, status: 'WAITING', counter: null, created_at: new Date(0), called_at: null, completed_at: null }] };
      }
      operacoes.push(texto.trim());
      return { rows: [] };
    },
    release() { operacoes.push('liberar'); },
  };
  const pool = { async connect() { operacoes.push('conectar SQL'); return cliente; } };
  const redis = {
    isReady: disponivel, isOpen: disponivel,
    async sendCommand(argumentos: string[]) {
      operacoes.push(argumentos[0]);
      if (falharPublicacao && argumentos[0] === 'LPUSH') throw Error('Falha de publicação');
      return 1;
    },
    destroy() { operacoes.push('desconectar Redis'); redis.isReady = false; redis.isOpen = false; },
  };
  const fila = new ServicoFila(
    pool as unknown as ConstructorParameters<typeof ServicoFila>[0],
    redis as unknown as ConstructorParameters<typeof ServicoFila>[1],
    'teste', () => { notificacoes++; },
  );
  return { fila, redis, operacoes, notificacoes: () => notificacoes };
}

test('emissão Redis só publica depois de persistir e confirmar SQL', async () => {
  const { fila, operacoes, notificacoes } = recursosFalsos();
  const senhas = await fila.emitir('redis', 1);
  assert.equal(senhas[0].numero, 1);
  assert.equal(senhas[0].situacao, 'aguardando');
  assert.ok(operacoes.indexOf('COMMIT') < operacoes.indexOf('LPUSH'));
  assert.equal(notificacoes(), 1);
});

test('publicação falha após commit: orienta recuperação, bloqueia novas emissões e não repete SQL', async () => {
  const { fila, redis, operacoes, notificacoes } = recursosFalsos({ falharPublicacao: true });
  await assert.rejects(fila.emitir('redis', 1), /Senhas salvas no PostgreSQL/);
  assert.equal(redis.isReady, false);
  assert.equal(operacoes.includes('ROLLBACK'), false);
  assert.equal(notificacoes(), 1);
  await assert.rejects(fila.emitir('redis', 1), /indisponível/);
  assert.equal(operacoes.filter(operacao => operacao === 'persistir').length, 1);
});

test('Redis sabidamente indisponível rejeita emissão antes de persistir', async () => {
  const { fila, operacoes } = recursosFalsos({ disponivel: false });
  await assert.rejects(fila.emitir('redis', 1), /indisponível/);
  assert.deepEqual(operacoes, []);
});

test('falha de commit na limpeza exige reconstrução antes de reutilizar Redis', async () => {
  const { fila, redis, operacoes } = recursosFalsos({ falharCommit: true });
  await assert.rejects(fila.limpar('redis'), /confirmação SQL/);
  assert.ok(operacoes.indexOf('DEL') < operacoes.indexOf('COMMIT incerto'));
  assert.equal(operacoes.includes('ROLLBACK'), true);
  assert.equal(operacoes.includes('liberar'), true);
  assert.equal(redis.isReady, false);
});
