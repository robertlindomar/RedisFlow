export function formatarNumero(numero: number, casas = 0): string {
  return numero.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
export function formatarSenha(numero: number): string { return String(numero).padStart(3, '0'); }
export function nomeModo(modo: 'postgres' | 'redis'): string { return modo === 'postgres' ? 'PostgreSQL' : 'Redis'; }
