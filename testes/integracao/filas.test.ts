import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarPool, criarRedis, estruturaSql } from '../../src/server/conexoes';
import { ServicoFila } from '../../src/server/fila';
import { criarSistema } from '../../src/server/sistema';
import type { Modo } from '../../src/types/aplicacao';

// Exige destinos exclusivos. Nunca reutiliza automaticamente o banco da aplicação.
const habilitado = process.env.TESTE_BANCOS_REAIS === '1';
if (habilitado) {
  if (!process.env.DATABASE_URL_TESTE || !process.env.REDIS_URL_TESTE) throw Error('Informe DATABASE_URL_TESTE e REDIS_URL_TESTE de serviços exclusivos para testes.');
  process.env.DATABASE_URL = process.env.DATABASE_URL_TESTE;
  process.env.REDIS_URL = process.env.REDIS_URL_TESTE;
}

async function comFila<T>(operacao: (fila: ServicoFila) => Promise<T>): Promise<T> {
  const administrador = criarPool();
  const esquema = `rfteste_${randomUUID().replaceAll('-', '')}`;
  const pool = criarPool(esquema, 20);
  const redis = criarRedis();
  const fila = new ServicoFila(pool, redis, esquema);
  try {
    await administrador.query(`CREATE SCHEMA "${esquema}"`);
    await pool.query(estruturaSql);
    await redis.connect();
    return await operacao(fila);
  } finally {
    try {
      if (!redis.isOpen) await redis.connect();
      await fila.removerChaves();
    } finally {
      if (redis.isOpen) redis.destroy();
      await pool.end();
      try { await administrador.query(`DROP SCHEMA IF EXISTS "${esquema}" CASCADE`); }
      finally { await administrador.end(); }
    }
  }
}

for (const modo of ['postgres', 'redis'] as const) {
  test(`${modo}: emissão simultânea, FIFO e 100 senhas com dez consumidores sem duplicação`, { skip: !habilitado }, async () => comFila(async fila => {
    await Promise.all(Array.from({ length: 10 }, () => fila.emitir(modo, 10)));
    const primeiro = await fila.chamar(modo, 'inicial');
    assert.equal(primeiro?.numero, 1);
    await fila.finalizar(modo, 'inicial');
    const identificadores = new Set([primeiro!.id]);
    await Promise.all(Array.from({ length: 10 }, async (_, indice) => {
      for (;;) {
        const senha = await fila.chamar(modo, `teste-${indice}`);
        if (!senha) return;
        assert.equal(identificadores.has(senha.id), false);
        identificadores.add(senha.id);
        assert.equal((await fila.finalizar(modo, `teste-${indice}`))?.id, senha.id);
      }
    }));
    assert.equal(identificadores.size, 100);
    assert.deepEqual(await fila.auditar(modo), { total: 100, concluidas: 100 });
  }));

  test(`${modo}: chamadas simultâneas no mesmo guichê deixam uma única senha ativa`, { skip: !habilitado }, async () => comFila(async fila => {
    await fila.emitir(modo, 10);
    const resultados = await Promise.allSettled([fila.chamar(modo, '01'), fila.chamar(modo, '01')]);
    assert.equal(resultados.filter(resultado => resultado.status === 'fulfilled').length, 1);
    assert.equal(resultados.filter(resultado => resultado.status === 'rejected').length, 1);
    const estado = await fila.estado(modo);
    assert.equal(estado.ativas.length, 1);
    assert.equal(estado.indicadores.aguardando, 9);
    if (modo === 'redis') assert.equal(estado.tamanhoRedis, 9);
  }));
}

test('Redis: falha após LMOVE preserva senha SQL e permite reconstrução', { skip: !habilitado }, async () => comFila(async fila => {
  await fila.emitir('redis', 10);
  const original = fila.comandoRedis.bind(fila);
  fila.comandoRedis = async argumentos => {
    const resposta = await original(argumentos);
    if (argumentos[0] === 'LMOVE') { fila.redis.destroy(); throw Error('Falha de conexão injetada após retirada'); }
    return resposta;
  };
  await assert.rejects(fila.chamar('redis', '01'), /injetada/);
  assert.equal((await fila.estado('redis')).indicadores.aguardando, 10);
  await assert.rejects(fila.emitir('redis', 1), /indisponível/);
  fila.comandoRedis = original;
  await fila.reconstruir();
  assert.equal((await fila.chamar('redis', '01'))?.numero, 1);
  assert.equal((await fila.estado('redis')).tamanhoRedis, 9);
}));

test('Redis: falha após persistir chamada não reenvia senha ativa na reconstrução', { skip: !habilitado }, async () => comFila(async fila => {
  await fila.emitir('redis', 10);
  const original = fila.comandoRedis.bind(fila);
  fila.comandoRedis = async argumentos => {
    if (argumentos[0] === 'LREM') { fila.redis.destroy(); throw Error('Falha de confirmação injetada'); }
    return original(argumentos);
  };
  await assert.rejects(fila.chamar('redis', '01'), /injetada/);
  fila.comandoRedis = original;
  await fila.reconstruir();
  const estado = await fila.estado('redis');
  assert.equal(estado.ativas[0].numero, 1);
  assert.equal(estado.tamanhoRedis, 9);
  assert.equal((await fila.chamar('redis', '02'))?.numero, 2);
}));

test('Redis: nova instância recupera fila SQL após perda das listas', { skip: !habilitado }, async () => comFila(async fila => {
  await fila.emitir('redis', 10);
  await fila.removerChaves();
  const { rows } = await fila.pool.query<{ esquema: string }>('SELECT current_schema() AS esquema');
  const novaFila = new ServicoFila(fila.pool, fila.redis, rows[0].esquema);
  await novaFila.reconstruir();
  assert.equal((await novaFila.estado('redis')).tamanhoRedis, 10);
  assert.equal((await novaFila.chamar('redis', '01'))?.numero, 1);
}));

test('comparação real conclui seis rodadas e preserva as filas do painel', { skip: !habilitado }, async () => {
  const sistema = criarSistema();
  try {
    await sistema.inicializar();
    for (const modo of ['postgres', 'redis'] as Modo[]) await sistema.fila.emitir(modo, 10);
    const antes = await Promise.all((['postgres', 'redis'] as const).map(modo => sistema.fila.estado(modo)));
    sistema.laboratorio.iniciar({ quantidade: 100, atendentes: 10 });
    await sistema.laboratorio.tarefa;
    assert.equal(sistema.laboratorio.estado().situacao, 'concluida');
    assert.equal(sistema.laboratorio.estado().resultados.length, 6);
    assert.ok(sistema.laboratorio.estado().resultados.every(resultado => resultado.valido));
    const depois = await Promise.all((['postgres', 'redis'] as const).map(modo => sistema.fila.estado(modo)));
    assert.deepEqual(depois, antes);
  } finally {
    try { await sistema.fila.limpar(); }
    finally { await sistema.encerrar(); }
  }
});
