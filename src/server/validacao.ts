import { z } from 'zod';

export const esquemaModo = z.enum(['postgres', 'redis'], { error: 'Selecione PostgreSQL ou Redis.' });
export const esquemaEmissao = z.object({ modo: esquemaModo, quantidade: z.union([z.literal(1), z.literal(10)]) });
export const esquemaGuiche = z.object({ modo: esquemaModo, guiche: z.enum(['01', '02', '03'], { error: 'Guichê inválido.' }) });
export const esquemaLimpeza = z.object({ modo: esquemaModo, confirmacao: z.literal('LIMPAR FILA') });
export const esquemaReinicio = z.object({ confirmacao: z.literal('REINICIAR SISTEMA') });
export const esquemaComparacao = z.object({
  quantidade: z.union([z.literal(10), z.literal(100), z.literal(500), z.literal(1000)], { error: 'Escolha 10, 100, 500 ou 1.000 senhas.' }),
  atendentes: z.union([z.literal(3), z.literal(5), z.literal(10), z.literal(20)], { error: 'Escolha 3, 5, 10 ou 20 atendentes.' }),
});
