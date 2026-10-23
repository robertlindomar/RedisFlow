export class ErroAplicacao extends Error {
  constructor(public readonly codigo: number, mensagem: string) {
    super(mensagem);
    this.name = 'ErroAplicacao';
  }
}

export function codigoDoErro(erro: unknown): string | undefined {
  if (typeof erro === 'object' && erro !== null && 'code' in erro) return String(erro.code);
}
