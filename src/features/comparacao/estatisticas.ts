import type { EstadoComparacao, Modo, ResultadoRodada } from '@/types/aplicacao';

export function mediana(valores: number[]): number {
  if (!valores.length) return 0;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  return ordenados.length % 2 ? ordenados[meio] : (ordenados[meio - 1] + ordenados[meio]) / 2;
}

export function estatisticas(valores: number[]): { media: number; p95: number } {
  if (!valores.length) return { media: 0, p95: 0 };
  const ordenados = [...valores].sort((a, b) => a - b);
  return {
    media: valores.reduce((soma, valor) => soma + valor, 0) / valores.length,
    p95: ordenados[Math.ceil(ordenados.length * 0.95) - 1],
  };
}

export function tempoResumido(resultados: ResultadoRodada[], modo: Modo): number | null {
  const rodadas = resultados.filter(resultado => resultado.modo === modo && resultado.valido);
  return rodadas.length ? mediana(rodadas.map(resultado => resultado.tempoTotalMs)) : null;
}

export function conclusao(estado: EstadoComparacao): string {
  const configuracao = estado.configuracao;
  if (estado.situacao !== 'concluida' || !configuracao || estado.resultados.length !== 6) return 'Sem vencedor definitivo';
  for (const modo of ['postgres', 'redis'] as const) {
    const rodadas = estado.resultados.filter(resultado => resultado.modo === modo);
    if (rodadas.length !== 3 || new Set(rodadas.map(resultado => resultado.rodada)).size !== 3 ||
      rodadas.some(resultado => ![1, 2, 3].includes(resultado.rodada) || !resultado.valido || resultado.erros || resultado.duplicacoes ||
        resultado.quantidade !== configuracao.quantidade || resultado.atendentes !== configuracao.atendentes ||
        resultado.criadas !== configuracao.quantidade || resultado.chamadas !== configuracao.quantidade || resultado.finalizadas !== configuracao.quantidade ||
        ![resultado.tempoTotalMs, resultado.mediaMs, resultado.p95Ms, resultado.atendimentosPorSegundo].every(valor => Number.isFinite(valor) && valor >= 0))) {
      return 'Sem vencedor definitivo';
    }
  }
  const postgres = tempoResumido(estado.resultados, 'postgres')!;
  const redis = tempoResumido(estado.resultados, 'redis')!;
  if (postgres === redis) return 'Empate no tempo total';
  const diferenca = Math.abs(postgres - redis) / Math.max(postgres, redis);
  if (diferenca < 0.01) return 'Desempenho muito próximo';
  return `${postgres < redis ? 'PostgreSQL' : 'Redis'} teve menor tempo total neste teste (${(diferenca * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% de redução).`;
}
