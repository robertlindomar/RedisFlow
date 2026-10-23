import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Coordenacao, ExclusaoPorChave } from '../src/server/coordenacao';

function barreira() {
  let liberar!: () => void;
  const promessa = new Promise<void>(resolve => { liberar = resolve; });
  return { promessa, liberar };
}

test('manutenção aguarda escritas, rejeita operações novas e libera após falha', async () => {
  const coordenacao = new Coordenacao();
  const escrita = barreira();
  let terminou = false;
  const operacao = coordenacao.executar(() => escrita.promessa);
  const manutencao = coordenacao.exclusiva(async () => { terminou = true; });
  assert.equal(terminou, false);
  await assert.rejects(coordenacao.executar(async () => {}), /manutenção/);
  escrita.liberar();
  await Promise.all([operacao, manutencao]);
  assert.equal(terminou, true);
  await assert.rejects(coordenacao.exclusiva(async () => { throw Error('Falha controlada'); }), /controlada/);
  assert.equal(await coordenacao.executar(async () => 42), 42);
});

test('operações no mesmo guichê são serializadas; guichês distintos avançam', async () => {
  const exclusao = new ExclusaoPorChave();
  const primeira = barreira();
  const ordem: string[] = [];
  const a = exclusao.executar('01', async () => { ordem.push('primeira'); await primeira.promessa; });
  const b = exclusao.executar('01', async () => { ordem.push('segunda'); });
  await exclusao.executar('02', async () => { ordem.push('outro guichê'); });
  assert.deepEqual(ordem, ['primeira', 'outro guichê']);
  primeira.liberar();
  await Promise.all([a, b]);
  assert.deepEqual(ordem, ['primeira', 'outro guichê', 'segunda']);
  await assert.rejects(exclusao.executar('01', async () => { throw Error('Falha'); }));
  assert.equal(await exclusao.executar('01', async () => 'recuperado'), 'recuperado');
});
