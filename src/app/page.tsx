import { PainelAtendimento } from '@/features/atendimento/painel-atendimento';
import { PainelComparacao } from '@/features/comparacao/painel-comparacao';
import estilos from './pagina.module.css';

export default function PaginaInicial() {
  return <div className={estilos.estrutura}>
    <aside className={estilos.lateral}><a className={estilos.marca} href="#conteudo" aria-label="RedisFlow, início"><span className={estilos.simbolo}>R↗</span><span><strong>RedisFlow</strong><small>LABORATÓRIO DE FILAS</small></span></a><span className="sobretitulo">PROJETO INTEGRADOR</span><nav aria-label="Navegação principal"><a href="#atendimento">Painel de atendimento</a><a href="#comparacao">Comparação de desempenho</a></nav><div className={estilos.nota}><strong>Dois motores, uma interface.</strong><p>Explore a mesma fila com PostgreSQL ou Redis.</p></div></aside>
    <div className={estilos.principal}><header className={estilos.barra}><span>VISÃO GERAL / LABORATÓRIO</span><span>Ambiente local demonstrativo</span></header><main id="conteudo" tabIndex={-1} className={estilos.conteudo}><PainelAtendimento /><PainelComparacao /><footer className={estilos.rodape}>RedisFlow · Projeto Integrador · Aprendizagem em NoSQL</footer></main></div>
  </div>;
}
