import Link from 'next/link';

export default function PaginaNaoEncontrada() {
  return <main className="pagina-retorno"><span className="sobretitulo">REDISFLOW · 404</span><h1>Página não encontrada</h1><p>O endereço solicitado não existe nesta aplicação.</p><Link className="botao primario" href="/">Voltar ao painel</Link></main>;
}
