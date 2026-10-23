export type Modo = 'postgres' | 'redis';
export type SituacaoSenha = 'aguardando' | 'em_atendimento' | 'concluida';

export interface Senha {
  id: string;
  numero: number;
  situacao: SituacaoSenha;
  guiche: string | null;
  criadaEm: string;
  chamadaEm: string | null;
  concluidaEm: string | null;
}

export interface EstadoFila {
  modo: Modo;
  indicadores: { aguardando: number; emAtendimento: number; concluidas: number; total: number };
  aguardando: Senha[];
  ativas: Senha[];
  recentes: Senha[];
  redisDisponivel: boolean;
  tamanhoRedis: number | null;
}

export interface ConfiguracaoComparacao { quantidade: number; atendentes: number }
export interface ResultadoRodada {
  modo: Modo;
  rodada: number;
  quantidade: number;
  atendentes: number;
  criadas: number;
  chamadas: number;
  finalizadas: number;
  erros: number;
  duplicacoes: number;
  tempoCriacaoMs: number;
  tempoAtendimentoMs: number;
  tempoTotalMs: number;
  atendimentosPorSegundo: number;
  mediaMs: number;
  p95Ms: number;
  valido: boolean;
}
export type SituacaoComparacao = 'ociosa' | 'executando' | 'concluida' | 'cancelada' | 'interrompida';
export interface EstadoComparacao {
  situacao: SituacaoComparacao;
  configuracao?: ConfiguracaoComparacao;
  resultados: ResultadoRodada[];
  progresso?: { modo: Modo; rodada: number; fase: 'aquecimento' | 'criacao' | 'atendimento' | 'auditoria'; finalizadas: number };
  motivo?: string;
}
