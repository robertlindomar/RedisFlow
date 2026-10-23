import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './estilos-globais.css';

export const metadata: Metadata = {
  title: 'RedisFlow · Laboratório de filas',
  description: 'Comparação didática de filas de atendimento com PostgreSQL e Redis.',
};

export default function LayoutRaiz({ children: conteudo }: { children: ReactNode }) {
  return <html lang="pt-BR"><body><a className="pular-conteudo" href="#conteudo">Pular para o conteúdo</a>{conteudo}</body></html>;
}
