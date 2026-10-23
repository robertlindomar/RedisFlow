'use client';

import { useState } from 'react';
import { Confirmacao } from '@/components/confirmacao';
import { useConsulta } from '@/lib/use-consulta';
import { enviarJson } from '@/lib/requisicao-api';
import { formatarNumero, formatarSenha, nomeModo } from '@/lib/formatacao';
import type { EstadoFila, Modo, Senha } from '@/types/aplicacao';
import estilos from './painel-atendimento.module.css';

export function PainelAtendimento() {
  const [modo, definirModo] = useState<Modo>('postgres');
  const { dados, erro, conectado, atualizar } = useConsulta<EstadoFila>(`/api/estado?modo=${modo}`, 5000, true);
  const estado = dados?.modo === modo ? dados : null;
  const [ocupada, definirOcupada] = useState(false);
  const [mensagem, definirMensagem] = useState('');
  const [erroAcao, definirErroAcao] = useState('');
  const [confirmacao, definirConfirmacao] = useState<'modo' | 'sistema' | null>(null);

  async function executar(caminho: string, corpo: unknown, sucesso: string) {
    definirOcupada(true); definirErroAcao(''); definirMensagem('');
    try {
      const resposta = await enviarJson<{ senha?: Senha | null }>(caminho, corpo);
      definirMensagem(caminho === '/api/chamar' && resposta.senha === null ? 'Não há senhas aguardando neste modo.' : sucesso);
      definirConfirmacao(null);
    } catch (erro) { definirErroAcao(erro instanceof Error ? erro.message : 'Não foi possível realizar a operação.'); }
    finally { definirOcupada(false); atualizar(); }
  }
  const indisponivel = ocupada || !estado || Boolean(erro);
  const redisIndisponivel = modo === 'redis' && !estado?.redisDisponivel;

  return <section id="atendimento" className={estilos.secao} aria-labelledby="titulo-atendimento">
    <div className={estilos.cabecalho}>
      <div><span className="sobretitulo">SISTEMA DE ATENDIMENTO</span><h1 id="titulo-atendimento">Controle de senhas<span className={estilos.ponto}>.</span></h1><p>Uma fila real. Duas estratégias de processamento.</p></div>
      <div className={estilos.status}><span className={conectado && !erro ? estilos.aoVivo : estilos.desconectado}>{conectado && !erro ? '● Atualização ao vivo' : '○ Verificando conexão'}</span><button className="botao discreto" disabled={ocupada} onClick={() => { definirErroAcao(''); definirConfirmacao('sistema'); }}>Reiniciar sistema</button></div>
    </div>
    <div className={estilos.modos}><div><strong>Motor da fila</strong><p>As filas de cada modo são independentes.</p></div><div className={estilos.seletor} aria-label="Motor da fila">
      {(['postgres', 'redis'] as const).map(opcao => <button key={opcao} type="button" aria-pressed={modo === opcao} disabled={ocupada || confirmacao !== null} onClick={() => { definirModo(opcao); definirErroAcao(''); definirMensagem(''); }}>{opcao === 'postgres' ? 'PostgreSQL' : 'Redis'}</button>)}
    </div></div>
    {erro && <div className="erro" role="alert">{erro} <button className="botao discreto" onClick={atualizar}>Tentar novamente</button></div>}
    {erroAcao && !confirmacao && <p className="erro" role="alert">{erroAcao}</p>}
    <p className={estilos.mensagem} role="status" aria-live="polite">{mensagem}</p>
    {redisIndisponivel && <p className="aviso" role="status">Redis indisponível. Os dados persistidos continuam visíveis. Use “Reconstruir fila Redis” após restabelecer o serviço.</p>}
    <div className={estilos.indicadores} aria-busy={!estado}>
      {[['Aguardando', estado?.indicadores.aguardando, 'Senhas na fila'], ['Em atendimento', estado?.indicadores.emAtendimento, 'Guichês ocupados'], ['Finalizados', estado?.indicadores.concluidas, 'Atendimentos concluídos'], ['Total emitido', estado?.indicadores.total, 'Neste modo']].map(([rotulo, valor, descricao]) => <article className={estilos.indicador} key={rotulo}><span>{rotulo}</span><strong>{typeof valor === 'number' ? formatarNumero(valor) : '—'}</strong><small>{descricao}</small></article>)}
    </div>
    <div className={estilos.colunas}>
      <section className="painel" aria-labelledby="titulo-fila"><div className="cabecalho-painel"><div><h2 id="titulo-fila">Fila de espera</h2><p>Próximas senhas por ordem de chegada</p></div><span className="etiqueta">FIFO</span></div>
        <div className={estilos.emissao}><div><span className="sobretitulo">EMISSÃO DE SENHAS</span><h3>Nova senha</h3><p>O cliente entra no fim da fila.</p></div><div className={estilos.acoes}><button className="botao primario" disabled={indisponivel || redisIndisponivel} onClick={() => void executar('/api/senhas', { modo, quantidade: 1 }, 'Senha emitida com sucesso.')}>+ Emitir senha</button><button className="botao secundario" disabled={indisponivel || redisIndisponivel} onClick={() => void executar('/api/senhas', { modo, quantidade: 10 }, 'Dez senhas emitidas com sucesso.')}>+ 10 senhas</button></div></div>
        <div className={estilos.rotulo}><span>ORDEM DE ATENDIMENTO</span><span>{estado ? `${formatarNumero(estado.indicadores.aguardando)} na fila` : 'Carregando…'}</span></div>
        <ol className={estilos.fila}>{estado?.aguardando.map(senha => <li key={senha.id}><small>Senha</small><strong>{formatarSenha(senha.numero)}</strong></li>)}</ol>
        {estado && !estado.aguardando.length && <p className="vazio">A fila está vazia. Emita uma senha para começar.</p>}
        {estado && estado.indicadores.aguardando > 12 && <p className="texto-suave">Exibindo as próximas 12 senhas.</p>}
        <div className={estilos.rodape}><span>{nomeModo(modo)}</span><button className="botao discreto" disabled={indisponivel} onClick={() => { definirErroAcao(''); definirConfirmacao('modo'); }}>Limpar este modo</button></div>
        {modo === 'redis' && <button className="botao secundario" disabled={ocupada || !estado} onClick={() => void executar('/api/reconstruir-redis', {}, 'Fila Redis reconstruída a partir do PostgreSQL.')}>Reconstruir fila Redis</button>}
      </section>
      <section className="painel" aria-labelledby="titulo-guiches"><div className="cabecalho-painel"><div><h2 id="titulo-guiches">Guichês de atendimento</h2><p>Chame e finalize cada atendimento</p></div><span className="etiqueta">3 GUICHÊS</span></div>
        <div className={estilos.guiches}>{['01', '02', '03'].map(guiche => {
          const senha = estado?.ativas.find(senha => senha.guiche === guiche);
          return <article className={estilos.guiche} key={guiche}><div><span>Guichê {guiche}</span><strong>{senha ? formatarSenha(senha.numero) : 'Livre'}</strong><small>{senha ? 'Em atendimento' : 'Pronto para chamar'}</small></div><button className={`botao ${senha ? 'secundario' : 'primario'}`} disabled={indisponivel || (!senha && redisIndisponivel)} onClick={() => void executar(senha ? '/api/finalizar' : '/api/chamar', { modo, guiche }, senha ? `Atendimento finalizado no guichê ${guiche}.` : `Senha chamada no guichê ${guiche}.`)} aria-label={`${senha ? 'Finalizar atendimento' : 'Chamar próxima senha'} no guichê ${guiche}`}>{senha ? 'Finalizar' : 'Chamar próxima'}</button></article>;
        })}</div>
        <h3 className={estilos.tituloRecentes}>Últimas chamadas</h3>
        <ul className={estilos.recentes}>{estado?.recentes.map(senha => <li key={senha.id}><strong>{formatarSenha(senha.numero)}</strong><span>Guichê {senha.guiche}</span><small>{senha.situacao === 'concluida' ? 'Concluída' : 'Em atendimento'}</small></li>)}</ul>
        {estado && !estado.recentes.length && <p className="vazio">Nenhuma senha chamada neste modo.</p>}
      </section>
    </div>
    {confirmacao && <Confirmacao titulo={confirmacao === 'sistema' ? 'Reiniciar todo o sistema?' : `Limpar a fila ${nomeModo(modo)}?`} descricao={confirmacao === 'sistema' ? 'Todas as senhas, atendimentos e resultados atuais serão apagados. A numeração voltará para 001. Esta ação é irreversível.' : 'As senhas e o histórico deste modo serão apagados. A numeração voltará para 001. Esta ação é irreversível.'} frase={confirmacao === 'sistema' ? 'REINICIAR SISTEMA' : 'LIMPAR FILA'} ocupada={ocupada} erro={erroAcao} fechar={() => definirConfirmacao(null)} confirmar={() => void executar(confirmacao === 'sistema' ? '/api/reiniciar' : '/api/limpar', confirmacao === 'sistema' ? { confirmacao: 'REINICIAR SISTEMA' } : { modo, confirmacao: 'LIMPAR FILA' }, confirmacao === 'sistema' ? 'Sistema reiniciado.' : 'Fila limpa.')} />}
  </section>;
}
