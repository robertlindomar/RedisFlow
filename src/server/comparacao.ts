import { performance } from 'node:perf_hooks';
import type { ConfiguracaoComparacao, EstadoComparacao, Modo, ResultadoRodada, Senha } from '@/types/aplicacao';
import { estatisticas } from '@/features/comparacao/estatisticas';
import { ErroAplicacao } from './erros';

export interface OperacoesFila {
  emitir(modo: Modo, quantidade: number): Promise<Senha[]>;
  chamar(modo: Modo, guiche: string): Promise<Senha | null>;
  finalizar(modo: Modo, guiche: string): Promise<Senha | null>;
  auditar(modo: Modo): Promise<{ total: number; concluidas: number }>;
}
export interface RecursosComparacao {
  preparar(): Promise<void>;
  isolar<T>(operacao: (fila: OperacoesFila) => Promise<T>): Promise<T>;
}

export class Laboratorio {
  private estadoAtual: EstadoComparacao = { situacao: 'ociosa', resultados: [] };
  private cancelada = false;
  private inicio = 0;
  tarefa: Promise<void> = Promise.resolve();

  constructor(private recursos: RecursosComparacao) {}

  estado(): EstadoComparacao { return structuredClone(this.estadoAtual); }
  emExecucao(): boolean { return this.estadoAtual.situacao === 'executando'; }
  cancelar(): void { if (this.emExecucao()) this.cancelada = true; }
  limpar(): void {
    if (this.emExecucao()) throw new ErroAplicacao(409, 'Cancele a comparação e aguarde seu término.');
    this.estadoAtual = { situacao: 'ociosa', resultados: [] };
  }

  iniciar(configuracao: ConfiguracaoComparacao): void {
    if (this.emExecucao()) throw new ErroAplicacao(409, 'Já existe uma comparação em execução.');
    this.cancelada = false;
    this.inicio = performance.now();
    this.estadoAtual = { situacao: 'executando', configuracao, resultados: [] };
    this.tarefa = this.executar(configuracao).then(() => {
      this.verificarLimites();
      this.estadoAtual.situacao = 'concluida';
    }).catch((erro: unknown) => {
      this.estadoAtual.situacao = this.cancelada ? 'cancelada' : 'interrompida';
      this.estadoAtual.motivo = erro instanceof ErroAplicacao ? erro.message : 'Falha de infraestrutura ou operação. Verifique os serviços antes de repetir a comparação.';
      if (!(erro instanceof ErroAplicacao)) console.error('[Comparação] Operação interrompida:', erro);
    });
  }

  private verificarLimites(): void {
    if (this.cancelada) throw new ErroAplicacao(409, 'Comparação cancelada pelo usuário.');
    if (performance.now() - this.inicio > 120000) throw new ErroAplicacao(409, 'Limite de dois minutos excedido.');
    if (process.memoryUsage().rss > 1024 * 1048576) throw new ErroAplicacao(409, 'Limite de memória do processo excedido (1 GiB).');
  }

  private async executar(configuracao: ConfiguracaoComparacao): Promise<void> {
    await this.recursos.preparar();
    for (let rodada = 1; rodada <= 3; rodada++) {
      const modos: Modo[] = rodada % 2 ? ['postgres', 'redis'] : ['redis', 'postgres'];
      for (const modo of modos) {
        this.verificarLimites();
        this.estadoAtual.progresso = { modo, rodada, fase: 'aquecimento', finalizadas: 0 };
        const aquecimento = await this.recursos.isolar(fila => this.medir(fila, modo, rodada,
          { ...configuracao, quantidade: Math.min(configuracao.quantidade, 100) }, true));
        if (!aquecimento.valido) throw new ErroAplicacao(409, 'O aquecimento falhou na verificação de integridade.');
        const resultado = await this.recursos.isolar(fila => this.medir(fila, modo, rodada, configuracao));
        this.estadoAtual.resultados.push(resultado);
        if (!resultado.valido) throw new ErroAplicacao(409, 'Rodada inválida: verifique erros, duplicações e contagens.');
      }
    }
  }

  private async medir(fila: OperacoesFila, modo: Modo, rodada: number, configuracao: ConfiguracaoComparacao, aquecimento = false): Promise<ResultadoRodada> {
    const { quantidade, atendentes } = configuracao;
    this.verificarLimites();
    if (!aquecimento) this.estadoAtual.progresso = { modo, rodada, fase: 'criacao', finalizadas: 0 };
    const inicio = performance.now();
    const criadas = (await fila.emitir(modo, quantidade)).length;
    const tempoCriacaoMs = performance.now() - inicio;
    this.verificarLimites();
    if (!aquecimento) this.estadoAtual.progresso!.fase = 'atendimento';
    const inicioAtendimento = performance.now();
    const duracoes: number[] = [];
    const vistos = new Set<string>();
    const numeros = new Set<number>();
    let chamadas = 0, finalizadas = 0, erros = 0, duplicacoes = 0;
    let interromper = false;
    const consumidores = Array.from({ length: atendentes }, async (_, indice) => {
      const guiche = `comparacao-${indice + 1}`;
      while (!interromper) {
        try {
          this.verificarLimites();
          const antes = performance.now();
          const senha = await fila.chamar(modo, guiche);
          if (!senha) return;
          chamadas++;
          if (vistos.has(senha.id) || numeros.has(senha.numero) || senha.numero < 1 || senha.numero > quantidade) duplicacoes++;
          vistos.add(senha.id);
          numeros.add(senha.numero);
          const concluida = await fila.finalizar(modo, guiche);
          if (!concluida || concluida.id !== senha.id) throw new ErroAplicacao(409, 'Finalização divergente da senha chamada.');
          finalizadas++;
          duracoes.push(performance.now() - antes);
          if (!aquecimento) this.estadoAtual.progresso!.finalizadas = finalizadas;
        } catch (erro) {
          interromper = true;
          erros++;
          if (this.cancelada) throw erro;
          // Não repetir operações cujo resultado persistido é incerto.
          throw erro;
        }
      }
    });
    // Sempre aguardar todos os ciclos antes de liberar os recursos isolados.
    const encerramentos = await Promise.allSettled(consumidores);
    this.verificarLimites();
    const tempoAtendimentoMs = performance.now() - inicioAtendimento;
    const tempoTotalMs = tempoCriacaoMs + tempoAtendimentoMs;
    if (!aquecimento) this.estadoAtual.progresso!.fase = 'auditoria';
    const auditoria = await fila.auditar(modo);
    const latencias = estatisticas(duracoes);
    return {
      modo, rodada, quantidade, atendentes, criadas, chamadas, finalizadas, erros, duplicacoes,
      tempoCriacaoMs, tempoAtendimentoMs, tempoTotalMs,
      atendimentosPorSegundo: finalizadas / Math.max(tempoAtendimentoMs / 1000, 0.000001),
      mediaMs: latencias.media, p95Ms: latencias.p95,
      valido: encerramentos.every(resultado => resultado.status === 'fulfilled') && erros === 0 && duplicacoes === 0 &&
        criadas === quantidade && chamadas === quantidade && finalizadas === quantidade &&
        auditoria.total === quantidade && auditoria.concluidas === quantidade,
    };
  }
}
