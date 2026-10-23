import { ErroAplicacao } from './erros';

/** As limpezas aguardam as escritas e impedem novas operações até o término. */
export class Coordenacao {
  private pendentes = new Set<Promise<void>>();
  private bloqueada = false;

  async executar<T>(operacao: () => Promise<T>): Promise<T> {
    if (this.bloqueada) throw new ErroAplicacao(409, 'Sistema em manutenção. Aguarde.');
    let liberar!: () => void;
    const pendente = new Promise<void>(resolve => { liberar = resolve; });
    this.pendentes.add(pendente);
    try { return await operacao(); }
    finally { this.pendentes.delete(pendente); liberar(); }
  }

  async exclusiva<T>(operacao: () => Promise<T>): Promise<T> {
    if (this.bloqueada) throw new ErroAplicacao(409, 'Sistema em manutenção. Aguarde.');
    this.bloqueada = true;
    try { await Promise.all(this.pendentes); return await operacao(); }
    finally { this.bloqueada = false; }
  }
}

/** Serializa somente operações que compartilham o mesmo guichê ou produtor. */
export class ExclusaoPorChave {
  private caudas = new Map<string, Promise<unknown>>();

  async executar<T>(chave: string, operacao: () => Promise<T>): Promise<T> {
    const anterior = this.caudas.get(chave) ?? Promise.resolve();
    const atual = anterior.catch(() => undefined).then(operacao);
    this.caudas.set(chave, atual);
    try { return await atual; }
    finally { if (this.caudas.get(chave) === atual) this.caudas.delete(chave); }
  }
}
