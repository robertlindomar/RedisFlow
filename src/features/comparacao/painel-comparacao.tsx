'use client';

import { useState } from 'react';
import { useConsulta } from '@/lib/use-consulta';
import { enviarJson } from '@/lib/requisicao-api';
import { formatarNumero, nomeModo } from '@/lib/formatacao';
import type { EstadoComparacao, Modo } from '@/types/aplicacao';
import { conclusao, mediana, tempoResumido } from './estatisticas';
import estilos from './painel-comparacao.module.css';

const rotulosFases = { aquecimento: 'Aquecendo', criacao: 'Criando senhas', atendimento: 'Atendendo', auditoria: 'Conferindo integridade' };
const rotulosSituacoes = { ociosa: 'Pronto para comparar', executando: 'Comparação em andamento', concluida: 'Comparação concluída', cancelada: 'Comparação cancelada', interrompida: 'Comparação interrompida' };

export function PainelComparacao() {
  const { dados: estado, erro, atualizar } = useConsulta<EstadoComparacao>('/api/comparacao', 1500);
  const [quantidade, definirQuantidade] = useState(100);
  const [atendentes, definirAtendentes] = useState(3);
  const [enviando, definirEnviando] = useState(false);
  const [cancelamentoSolicitado, definirCancelamentoSolicitado] = useState(false);
  const [erroAcao, definirErroAcao] = useState('');
  const executando = estado?.situacao === 'executando';
  async function executar(cancelar = false) {
    definirEnviando(true); definirErroAcao('');
    try {
      await enviarJson(cancelar ? '/api/comparacao/cancelar' : '/api/comparacao', cancelar ? {} : { quantidade, atendentes });
      definirCancelamentoSolicitado(cancelar);
    } catch (erro) { definirErroAcao(erro instanceof Error ? erro.message : 'Não foi possível iniciar a operação.'); }
    finally { definirEnviando(false); atualizar(); }
  }
  const postgres = estado ? tempoResumido(estado.resultados, 'postgres') : null;
  const redis = estado ? tempoResumido(estado.resultados, 'redis') : null;
  const maior = (Math.max(postgres ?? 0, redis ?? 0) || 1);

  return <section id="comparacao" className={`painel ${estilos.secao}`} aria-labelledby="titulo-comparacao">
    <div className="cabecalho-painel"><div><span className="sobretitulo">MEDIÇÃO REAL</span><h2 id="titulo-comparacao">Laboratório de desempenho</h2><p>Execute a mesma carga e compare os resultados medidos neste ambiente.</p></div><span className="etiqueta">3 RODADAS POR MOTOR</span></div>
    <form className={estilos.formulario} onSubmit={evento => { evento.preventDefault(); void executar(); }}>
      <label>Quantidade de senhas<select value={quantidade} disabled={executando || enviando} onChange={evento => definirQuantidade(Number(evento.target.value))}>{[10, 100, 500, 1000].map(valor => <option key={valor} value={valor}>{formatarNumero(valor)} senhas</option>)}</select></label>
      <label>Atendentes simultâneos<select value={atendentes} disabled={executando || enviando} onChange={evento => definirAtendentes(Number(evento.target.value))}>{[3, 5, 10, 20].map(valor => <option key={valor} value={valor}>{valor} atendentes</option>)}</select></label>
      <button className="botao primario" type="submit" disabled={!estado || Boolean(erro) || executando || enviando}>{enviando ? 'Aguarde…' : 'Iniciar comparação'}</button>
      {executando && <button className="botao secundario" type="button" disabled={enviando || cancelamentoSolicitado} onClick={() => void executar(true)}>{cancelamentoSolicitado ? 'Aguardando encerramento…' : 'Cancelar comparação'}</button>}
    </form>
    <p className="texto-suave">Cada atendente executa uma chamada e uma finalização por vez. Os dados do laboratório ficam separados das filas do painel.</p>
    {(erro || erroAcao) && <p className="erro" role="alert">{erroAcao || erro}</p>}
    <div className={estilos.progresso} role="status" aria-live="polite">
      <strong>{estado ? rotulosSituacoes[estado.situacao] : 'Carregando laboratório…'}</strong>
      {executando && estado?.progresso && <span>{rotulosFases[estado.progresso.fase]} · {nomeModo(estado.progresso.modo)} · rodada {estado.progresso.rodada}/3 · {formatarNumero(estado.progresso.finalizadas)} finalizadas</span>}
      {estado?.motivo && <span>{estado.motivo}</span>}
    </div>
    {estado && estado.resultados.length > 0 ? <>
      <div className={estilos.resumo}><div><h3>Tempo total para criar e atender</h3><p>Mediana das rodadas válidas disponíveis. Menor é melhor.</p></div><strong>{conclusao(estado)}</strong></div>
      <div className={estilos.grafico} role="img" aria-label={`Tempo total mediano: PostgreSQL ${postgres === null ? 'sem resultado' : `${formatarNumero(postgres / 1000, 3)} segundos`}; Redis ${redis === null ? 'sem resultado' : `${formatarNumero(redis / 1000, 3)} segundos`}. Escala linear a partir de zero.`}>
        <svg viewBox="0 0 640 155" aria-hidden="true">
          {([{ modo: 'postgres', valor: postgres }, { modo: 'redis', valor: redis }] as { modo: Modo; valor: number | null }[]).map(({ modo, valor }, indice) => <g key={modo} className={modo === 'postgres' ? estilos.postgres : estilos.redis}>
            <text x="0" y={25 + indice * 70}>{nomeModo(modo)}</text>
            <rect x="0" y={35 + indice * 70} width={valor === null ? 0 : valor / maior * 475} height="21" rx="3" />
            <text className={estilos.valor} x="490" y={51 + indice * 70}>{valor === null ? 'Sem resultado' : `${formatarNumero(valor / 1000, 3)} s`}</text>
          </g>)}
        </svg>
      </div>
      <p className="texto-suave">Dois resultados: PostgreSQL e Redis. Tempos, taxas e finalizações mostram a mediana das rodadas válidas; erros e duplicações são somados.</p>
      <div className={estilos.tabela} tabIndex={0} role="region" aria-label="Comparação PostgreSQL e Redis, tabela com rolagem horizontal"><table><caption>Comparação dos dois motores · {estado.configuracao && `${formatarNumero(estado.configuracao.quantidade)} senhas, ${estado.configuracao.atendentes} atendentes simultâneos`}</caption><thead><tr><th scope="col">Motor</th><th scope="col">Total (ms)</th><th scope="col">Atendimentos/s</th><th scope="col">Média (ms)</th><th scope="col">p95 (ms)</th><th scope="col">Finalizadas</th><th scope="col">Erros</th><th scope="col">Duplicações</th><th scope="col">Integridade</th></tr></thead><tbody>{(['postgres', 'redis'] as const).map(modo => {
        const rodadas = estado.resultados.filter(resultado => resultado.modo === modo);
        if (!rodadas.length) return null;
        const validas = rodadas.filter(resultado => resultado.valido);
        const resumo = (campo: 'tempoTotalMs' | 'atendimentosPorSegundo' | 'mediaMs' | 'p95Ms' | 'finalizadas', casas = 2) => validas.length ? formatarNumero(mediana(validas.map(resultado => resultado[campo])), casas) : '—';
        return <tr key={modo}><th scope="row">{nomeModo(modo)}</th><td>{resumo('tempoTotalMs')}</td><td>{resumo('atendimentosPorSegundo')}</td><td>{resumo('mediaMs')}</td><td>{resumo('p95Ms')}</td><td>{resumo('finalizadas', 0)}</td><td>{rodadas.reduce((total, resultado) => total + resultado.erros, 0)}</td><td>{rodadas.reduce((total, resultado) => total + resultado.duplicacoes, 0)}</td><td>{rodadas.some(resultado => !resultado.valido) ? 'Inválida' : rodadas.length === 3 ? 'Válida' : 'Parcial'}</td></tr>;
      })}</tbody></table></div>
    </> : <p className="vazio">Escolha a carga e inicie uma comparação para ver as medições reais.</p>}
    <details className={estilos.explicacao}><summary>Como interpretar a comparação</summary><div><p>Comparamos PostgreSQL e Redis. O modo chamado Redis utiliza Redis + PostgreSQL. Nos dois modos o PostgreSQL persiste as senhas; o teste não representa Redis isolado.</p><p>Tempo total soma criação e atendimento. Atendimentos por segundo usa apenas o período de atendimento. Média e p95 medem cada ciclo completo de chamada e finalização, incluindo espera por conexão SQL. p95 significa que 95% dos ciclos medidos levaram até aquele tempo.</p><p>Há aquecimento e alternância da ordem dos motores. A auditoria confere as contagens persistidas. O destaque de tempo só aparece com seis rodadas válidas e completas. Diferenças abaixo de 1% recebem “Desempenho muito próximo”; isso não comprova equivalência estatística.</p><p>CPU, disco, rede e persistência influenciam os resultados. Evite usar o painel durante a medição. Os números não demonstram superioridade geral de uma tecnologia.</p><p>O limite é de dois minutos e 1 GiB de memória do processo, verificados entre operações. Os ciclos em andamento terminam antes da limpeza. Os resultados ficam em memória até uma nova execução ou reinicialização.</p></div></details>
  </section>;
}
