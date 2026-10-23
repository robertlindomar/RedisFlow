'use client';

export default function ErroDaPagina({ reset: tentarNovamente }: { reset: () => void }) {
  return <main className="pagina-retorno"><span className="sobretitulo">REDISFLOW</span><h1>Não foi possível carregar a página</h1><p>Tente novamente para recuperar o painel.</p><button className="botao primario" onClick={tentarNovamente}>Tentar novamente</button></main>;
}
