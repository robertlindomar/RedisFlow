import { obterSistema } from '@/server/sistema';
import { ErroAplicacao } from '@/server/erros';
import { lerJson, respostaErro, respostaJson, validarOrigem } from '@/server/http';
import { esquemaComparacao, esquemaEmissao, esquemaGuiche, esquemaLimpeza, esquemaModo, esquemaReinicio } from '@/server/validacao';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function atender(requisicao: Request): Promise<Response> {
  try {
    const url = new URL(requisicao.url);
    const caminho = url.pathname.replace(/\/$/, '');
    if (requisicao.method === 'POST') validarOrigem(requisicao);
    const sistema = obterSistema();
    await sistema.inicializar();
    if (requisicao.method === 'GET') {
      if (caminho === '/api/saude') {
        await sistema.pool.query('SELECT 1');
        return respostaJson({ postgresDisponivel: true, redisDisponivel: sistema.redis.isReady });
      }
      if (caminho === '/api/estado') return respostaJson(await sistema.fila.estado(esquemaModo.parse(url.searchParams.get('modo'))));
      if (caminho === '/api/comparacao') return respostaJson(sistema.laboratorio.estado());
      if (caminho === '/api/eventos') {
        const codificador = new TextEncoder();
        let encerrar = () => {};
        const fluxo = new ReadableStream<Uint8Array>({
          start(controlador) {
            let encerrado = false;
            const enviar = (conteudo: string) => {
              if (encerrado) return;
              try { controlador.enqueue(codificador.encode(conteudo)); } catch { encerrar(); }
            };
            const notificar = () => enviar('event: alteracao\ndata: {}\n\n');
            const temporizador = setInterval(() => enviar(': conexao ativa\n\n'), 15000);
            encerrar = () => {
              if (encerrado) return;
              encerrado = true;
              clearInterval(temporizador);
              sistema.ouvintes.delete(notificar);
              requisicao.signal.removeEventListener('abort', encerrar);
              try { controlador.close(); } catch { /* O navegador já encerrou o fluxo. */ }
            };
            sistema.ouvintes.add(notificar);
            requisicao.signal.addEventListener('abort', encerrar, { once: true });
            if (requisicao.signal.aborted) encerrar();
            else enviar('event: conectado\ndata: {}\n\n');
          },
          cancel() { encerrar(); },
        });
        return new Response(fluxo, { headers: {
          'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive', 'X-Accel-Buffering': 'no',
        } });
      }
    }
    if (requisicao.method === 'POST') {
      if (caminho === '/api/comparacao/cancelar') {
        sistema.laboratorio.cancelar();
        return respostaJson(sistema.laboratorio.estado());
      }
      if (caminho === '/api/reiniciar' || caminho === '/api/limpar' || caminho === '/api/reconstruir-redis') {
        const corpo = await lerJson(requisicao);
        if (caminho === '/api/reiniciar') esquemaReinicio.parse(corpo);
        const limpeza = caminho === '/api/limpar' ? esquemaLimpeza.parse(corpo) : undefined;
        return await sistema.coordenacao.exclusiva(async () => {
          if (sistema.laboratorio.emExecucao()) throw new ErroAplicacao(409, 'Cancele a comparação e aguarde seu término antes da manutenção.');
          if (caminho === '/api/reconstruir-redis') return respostaJson({ reconstruidas: await sistema.fila.reconstruir() });
          await sistema.fila.limpar(limpeza?.modo);
          if (caminho === '/api/reiniciar') sistema.laboratorio.limpar();
          return respostaJson({ sucesso: true });
        });
      }
      if (caminho === '/api/comparacao') {
        const configuracao = esquemaComparacao.parse(await lerJson(requisicao));
        return await sistema.coordenacao.executar(async () => {
          sistema.laboratorio.iniciar(configuracao);
          return respostaJson(sistema.laboratorio.estado(), 202);
        });
      }
      if (caminho === '/api/senhas') {
        const { modo, quantidade } = esquemaEmissao.parse(await lerJson(requisicao));
        return await sistema.coordenacao.executar(async () => respostaJson({ senhas: await sistema.fila.emitir(modo, quantidade) }, 201));
      }
      if (caminho === '/api/chamar' || caminho === '/api/finalizar') {
        const { modo, guiche } = esquemaGuiche.parse(await lerJson(requisicao));
        return await sistema.coordenacao.executar(async () => {
          const senha = caminho === '/api/chamar' ? await sistema.fila.chamar(modo, guiche) : await sistema.fila.finalizar(modo, guiche);
          if (!senha && caminho === '/api/finalizar') throw new ErroAplicacao(404, 'Este guichê não possui atendimento ativo.');
          return respostaJson({ senha });
        });
      }
    }
    return respostaJson({ mensagem: 'Rota inexistente.' }, 404);
  } catch (erro) { return respostaErro(erro); }
}

export { atender as GET, atender as POST };
