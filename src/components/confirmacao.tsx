'use client';

import { useEffect, useRef, useState } from 'react';
import estilos from './confirmacao.module.css';

interface Propriedades {
  titulo: string;
  descricao: string;
  frase: string;
  ocupada: boolean;
  erro: string;
  confirmar: () => void;
  fechar: () => void;
}

export function Confirmacao({ titulo, descricao, frase, ocupada, erro, confirmar, fechar }: Propriedades) {
  const dialogo = useRef<HTMLDialogElement>(null);
  const [texto, definirTexto] = useState('');
  useEffect(() => {
    const elemento = dialogo.current;
    const focoAnterior = document.activeElement;
    elemento?.showModal();
    return () => { elemento?.close(); if (focoAnterior instanceof HTMLElement) focoAnterior.focus(); };
  }, []);

  return <dialog ref={dialogo} className={estilos.dialogo} aria-labelledby="titulo-confirmacao" aria-describedby="descricao-confirmacao"
    onCancel={evento => { evento.preventDefault(); if (!ocupada) fechar(); }}>
    <form onSubmit={evento => { evento.preventDefault(); if (texto === frase && !ocupada) confirmar(); }}>
      <span className="sobretitulo">CONFIRMAÇÃO NECESSÁRIA</span>
      <h2 id="titulo-confirmacao">{titulo}</h2>
      <p id="descricao-confirmacao">{descricao}</p>
      <label htmlFor="frase-confirmacao">Digite <strong>{frase}</strong> para confirmar.</label>
      <input id="frase-confirmacao" autoComplete="off" value={texto} disabled={ocupada} onChange={evento => definirTexto(evento.target.value)} />
      {erro && <p className="erro" role="alert">{erro}</p>}
      <div className={estilos.acoes}>
        <button type="button" className="botao secundario" disabled={ocupada} onClick={fechar}>Cancelar</button>
        <button type="submit" className="botao perigo" disabled={ocupada || texto !== frase}>{ocupada ? 'Aguarde…' : 'Confirmar exclusão'}</button>
      </div>
    </form>
  </dialog>;
}
