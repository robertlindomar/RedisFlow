export async function requisicaoApi<T>(caminho: string, opcoes?: RequestInit): Promise<T> {
  let resposta: Response;
  try { resposta = await fetch(caminho, { ...opcoes, cache: 'no-store' }); }
  catch (erro) {
    if (erro instanceof Error && erro.name === 'AbortError') throw erro;
    throw new Error('Não foi possível conectar ao servidor. Verifique a conexão.');
  }
  const dados: unknown = await resposta.json().catch(() => null);
  if (!resposta.ok) {
    const mensagem = dados && typeof dados === 'object' && 'mensagem' in dados && typeof dados.mensagem === 'string'
      ? dados.mensagem : 'Não foi possível concluir a operação.';
    throw new Error(mensagem);
  }
  return dados as T;
}

export function enviarJson<T>(caminho: string, dados: unknown): Promise<T> {
  return requisicaoApi<T>(caminho, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados),
  });
}
