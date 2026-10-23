import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerJson, respostaErro, validarOrigem } from '../src/server/http';
import { ErroAplicacao } from '../src/server/erros';
import { esquemaGuiche } from '../src/server/validacao';

test('aceita a origem pública no Docker, preservando endereço, protocolo e porta', () => {
  for (const host of ['127.0.0.1:3000', 'localhost:3000', 'localhost:3035']) {
    const requisicao = new Request('http://0.0.0.0:3000/api/comparacao', {
      method: 'POST', headers: { host, origin: `http://${host}` },
    });
    assert.doesNotThrow(() => validarOrigem(requisicao));
  }
  assert.doesNotThrow(() => validarOrigem(new Request('http://localhost:3000/api/comparacao')));
  assert.doesNotThrow(() => validarOrigem(new Request('http://localhost:3000/api/comparacao', {
    headers: { origin: 'http://localhost:3000' },
  })));
});

test('rejeita outra origem, porta, protocolo, origem opaca e encaminhamento forjado', () => {
  for (const origem of ['https://externo.example', 'http://localhost:3035', 'https://localhost:3000', 'null']) {
    const requisicao = new Request('http://localhost:3000/api/comparacao', {
      method: 'POST', headers: { host: 'localhost:3000', origin: origem, 'x-forwarded-host': 'externo.example' },
    });
    assert.throws(() => validarOrigem(requisicao), /Origem da requisição não permitida/);
  }
});

test('rejeita JSON inválido e corpo acima de 32 KiB', async () => {
  await assert.rejects(lerJson(new Request('http://localhost/api/senhas', { method: 'POST', body: '{' })), /JSON inválido/);
  await assert.rejects(lerJson(new Request('http://localhost/api/senhas', { method: 'POST', body: 'x'.repeat(32769) })), /grande demais/);
  assert.deepEqual(await lerJson(new Request('http://localhost/api/senhas', { method: 'POST', body: '{"modo":"redis"}' })), { modo: 'redis' });
});

test('respostas de erro têm status, mensagem em português e desabilitam cache', async () => {
  const resposta = respostaErro(new ErroAplicacao(409, 'Guichê ocupado.'));
  assert.equal(resposta.status, 409);
  assert.equal(resposta.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await resposta.json(), { mensagem: 'Guichê ocupado.' });
  const validacao = esquemaGuiche.safeParse({});
  assert.equal(validacao.success, false);
  if (!validacao.success) {
    const invalida = respostaErro(validacao.error);
    assert.equal(invalida.status, 400);
    assert.match((await invalida.json()).mensagem, /Dados inválidos/);
  }
});
