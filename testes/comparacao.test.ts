import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { Laboratorio, type OperacoesFila } from '../src/server/comparacao';
import { conclusao, estatisticas, mediana } from '../src/features/comparacao/estatisticas';
import { esquemaComparacao, esquemaEmissao, esquemaGuiche, esquemaReinicio } from '../src/server/validacao';
import type { EstadoComparacao, Modo, Senha } from '../src/types/aplicacao';

function senha(numero: number): Senha {
  return { id: String(numero), numero, situacao: 'aguardando', guiche: null, criadaEm: '2026-01-01T00:00:00.000Z', chamadaEm: null, concluidaEm: null };
}

function filaFalsa(divergente = false) {
  let proxima = 1, quantidade = 0, finalizadas = 0, simultaneas = 0, pico = 0;
  const guiches = new Map<string, Senha>();
  const fila: OperacoesFila = {
    async emitir(_modo, total) { quantidade = total; return Array.from({ length: total }, (_, indice) => senha(indice + 1)); },
    async chamar(_modo, guiche) {
      if (proxima > quantidade) return null;
      const atual = senha(proxima++);
      guiches.set(guiche, atual); simultaneas++; pico = Math.max(pico, simultaneas);
      await setImmediate();
      return atual;
    },
    async finalizar(_, guiche) { const atual = guiches.get(guiche)!; guiches.delete(guiche); simultaneas--; finalizadas++; return divergente ? { ...atual, id: 'divergente' } : atual; },
    async auditar() { return { total: quantidade, concluidas: finalizadas }; },
  };
  return { fila, pico: () => pico, simultaneas: () => simultaneas };
}

test('estatísticas usam mediana e p95 nearest rank', () => {
  assert.equal(mediana([8, 2, 4, 6]), 5);
  assert.equal(mediana([3, 1, 2]), 2);
  assert.equal(mediana([]), 0);
  assert.deepEqual(estatisticas(Array.from({ length: 100 }, (_, indice) => indice + 1)), { media: 50.5, p95: 95 });
});

test('valida limites e contratos em português', () => {
  assert.deepEqual(esquemaComparacao.parse({ quantidade: 1000, atendentes: 20 }), { quantidade: 1000, atendentes: 20 });
  for (const quantidade of [0, 11, 1001, '100', null]) assert.equal(esquemaComparacao.safeParse({ quantidade, atendentes: 3 }).success, false);
  assert.equal(esquemaComparacao.safeParse({ quantidade: 100, atendentes: 200 }).success, false);
  assert.equal(esquemaEmissao.safeParse({ modo: 'redis', quantidade: 100 }).success, false);
  assert.equal(esquemaGuiche.safeParse({ modo: 'postgres', guiche: '04' }).success, false);
  assert.equal(esquemaReinicio.safeParse({ confirmacao: 'sim' }).success, false);
});

async function comparar(divergente = false) {
  const ordem: Modo[] = [];
  const filas: ReturnType<typeof filaFalsa>[] = [];
  const laboratorio = new Laboratorio({
    async preparar() {},
    async isolar(operacao) {
      const contexto = filaFalsa(divergente); filas.push(contexto);
      const original = contexto.fila.emitir;
      contexto.fila.emitir = async (modo, quantidade) => { ordem.push(modo); return original(modo, quantidade); };
      const resultado = await operacao(contexto.fila);
      assert.equal(contexto.simultaneas(), 0);
      return resultado;
    },
  });
  laboratorio.iniciar({ quantidade: 100, atendentes: 10 });
  assert.throws(() => laboratorio.iniciar({ quantidade: 10, atendentes: 3 }), /execução/);
  await laboratorio.tarefa;
  return { laboratorio, ordem, filas };
}

test('executa aquecimento, três rodadas, alterna motores e usa consumidores simultâneos', async () => {
  const { laboratorio, ordem, filas } = await comparar();
  const estado = laboratorio.estado();
  assert.equal(estado.situacao, 'concluida');
  assert.equal(estado.resultados.length, 6);
  assert.ok(estado.resultados.every(resultado => resultado.valido && resultado.finalizadas === 100));
  assert.deepEqual(ordem, ['postgres', 'postgres', 'redis', 'redis', 'redis', 'redis', 'postgres', 'postgres', 'postgres', 'postgres', 'redis', 'redis']);
  assert.ok(filas.every(fila => fila.pico() === 10));
  // Consumidores não podem modificar o estado interno pela resposta da API.
  estado.resultados.length = 0;
  assert.equal(laboratorio.estado().resultados.length, 6);
});

test('finalização divergente interrompe o aquecimento, sem resultado válido', async () => {
  const { laboratorio, filas } = await comparar(true);
  assert.equal(laboratorio.estado().situacao, 'interrompida');
  assert.equal(laboratorio.estado().resultados.length, 0);
  assert.equal(filas.length, 1);
});

test('cancelamento aguarda consumidores antes da limpeza', async () => {
  const contexto = filaFalsa();
  let liberar!: () => void, avisar!: () => void;
  const bloqueio = new Promise<void>(resolve => { liberar = resolve; });
  const iniciou = new Promise<void>(resolve => { avisar = resolve; });
  const original = contexto.fila.chamar;
  contexto.fila.chamar = async (modo, guiche) => { const atual = await original(modo, guiche); avisar(); await bloqueio; return atual; };
  let limpa = false;
  const laboratorio = new Laboratorio({ async preparar() {}, async isolar(operacao) {
    try { return await operacao(contexto.fila); }
    finally { assert.equal(contexto.simultaneas(), 0); limpa = true; }
  } });
  laboratorio.iniciar({ quantidade: 100, atendentes: 3 });
  await iniciou;
  laboratorio.cancelar();
  assert.equal(limpa, false);
  liberar(); await laboratorio.tarefa;
  assert.equal(limpa, true);
  assert.equal(laboratorio.estado().situacao, 'cancelada');
  assert.equal(conclusao(laboratorio.estado()), 'Sem vencedor definitivo');
});

test('conclusão exige rodadas únicas, métricas finitas e integridade', async () => {
  const { laboratorio } = await comparar();
  const estado = laboratorio.estado();
  estado.resultados.forEach(resultado => { resultado.tempoTotalMs = resultado.modo === 'postgres' ? 100 : 200; });
  assert.match(conclusao(estado), /PostgreSQL teve menor/);
  const alterar = (funcao: (copia: EstadoComparacao) => void) => { const copia = structuredClone(estado); funcao(copia); return conclusao(copia); };
  assert.equal(alterar(copia => { copia.situacao = 'cancelada'; }), 'Sem vencedor definitivo');
  assert.equal(alterar(copia => { copia.resultados[0].tempoTotalMs = NaN; }), 'Sem vencedor definitivo');
  assert.equal(alterar(copia => { copia.resultados[0].duplicacoes = 1; }), 'Sem vencedor definitivo');
  assert.equal(alterar(copia => { copia.resultados[2].rodada = 1; }), 'Sem vencedor definitivo');
  assert.equal(alterar(copia => { copia.resultados[0].finalizadas--; }), 'Sem vencedor definitivo');
  assert.equal(alterar(copia => { copia.resultados.forEach(resultado => { resultado.tempoTotalMs = 100; }); }), 'Empate no tempo total');
  assert.equal(alterar(copia => { copia.resultados.forEach(resultado => { resultado.tempoTotalMs = resultado.modo === 'postgres' ? 100 : 100.5; }); }), 'Desempenho muito próximo');
});
