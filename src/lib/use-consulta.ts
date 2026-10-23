'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { requisicaoApi } from './requisicao-api';

export function useConsulta<T>(caminho: string, intervalo = 5000, eventos = false) {
  const [dados, definirDados] = useState<T | null>(null);
  const [erro, definirErro] = useState('');
  const [conectado, definirConectado] = useState(false);
  const atualizarReferencia = useRef<() => void>(() => {});

  useEffect(() => {
    const controlador = new AbortController();
    let consultando = false;
    let repetir = false;
    async function consultar() {
      if (controlador.signal.aborted) return;
      if (consultando) { repetir = true; return; }
      consultando = true;
      try {
        const resposta = await requisicaoApi<T>(caminho, { signal: controlador.signal });
        if (!controlador.signal.aborted) { definirDados(resposta); definirErro(''); }
      } catch (erro) {
        if (!controlador.signal.aborted) definirErro(erro instanceof Error ? erro.message : 'Não foi possível atualizar os dados.');
      } finally {
        consultando = false;
        if (repetir && !controlador.signal.aborted) { repetir = false; void consultar(); }
      }
    }
    atualizarReferencia.current = () => { void consultar(); };
    void consultar();
    const temporizador = setInterval(() => { void consultar(); }, intervalo);
    const fonte = eventos ? new EventSource('/api/eventos') : undefined;
    fonte?.addEventListener('conectado', () => { definirConectado(true); void consultar(); });
    fonte?.addEventListener('alteracao', () => { void consultar(); });
    fonte?.addEventListener('error', () => { definirConectado(false); });
    return () => {
      controlador.abort(); clearInterval(temporizador); fonte?.close();
      atualizarReferencia.current = () => {};
    };
  }, [caminho, intervalo, eventos]);

  const atualizar = useCallback(() => atualizarReferencia.current(), []);
  return { dados, erro, conectado, atualizar };
}
