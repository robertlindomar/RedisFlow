import { ZodError } from 'zod';
import { ErroAplicacao } from './erros';

export function validarOrigem(requisicao: Request): void {
  const origem = requisicao.headers.get('origin');
  if (!origem) return; // Clientes de terminal podem não enviar Origin.
  const url = new URL(requisicao.url);
  const host = requisicao.headers.get('host');
  // No Docker, a URL interna do Next pode usar localhost ou 0.0.0.0.
  // Host identifica o endereço acessado pelo navegador. Não confiar em
  // X-Forwarded-Host recebido diretamente neste servidor local.
  let origemEsperada: string;
  try {
    origemEsperada = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
  } catch {
    throw new ErroAplicacao(403, 'Origem da requisição não permitida.');
  }
  if (origem !== origemEsperada) throw new ErroAplicacao(403, 'Origem da requisição não permitida.');
}

export function respostaJson(dados: unknown, codigo = 200): Response {
  return Response.json(dados, { status: codigo, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

export async function lerJson(requisicao: Request): Promise<unknown> {
  const leitor = requisicao.body?.getReader();
  if (!leitor) throw new ErroAplicacao(400, 'Informe os dados da operação.');
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { value: parte, done: terminou } = await leitor.read();
      if (terminou) break;
      tamanho += parte.byteLength;
      if (tamanho > 32768) { await leitor.cancel(); throw new ErroAplicacao(413, 'Corpo da requisição grande demais.'); }
      partes.push(parte);
    }
  } finally { leitor.releaseLock(); }
  try { return JSON.parse(Buffer.concat(partes).toString('utf8')); }
  catch { throw new ErroAplicacao(400, 'JSON inválido.'); }
}

export function respostaErro(erro: unknown): Response {
  if (erro instanceof ZodError) return respostaJson({ mensagem: 'Dados inválidos. Confira o modo, as opções e a confirmação da operação.' }, 400);
  if (erro instanceof ErroAplicacao) return respostaJson({ mensagem: erro.message }, erro.codigo);
  console.error('[API] Não foi possível realizar a operação:', erro);
  return respostaJson({ mensagem: 'Não foi possível concluir a operação. Verifique os serviços e, no modo Redis, reconstrua a fila antes de tentar novamente.' }, 503);
}
