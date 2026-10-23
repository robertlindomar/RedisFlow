# RedisFlow — Laboratório de filas

## Baixar, abrir e fechar

Com Docker Engine e Docker Compose instalados, baixe o projeto e inicie a aplicação:

```bash
git clone https://github.com/robertlindomar/RedisFlow.git
cd RedisFlow
docker compose up --build -d
```

Abra **http://localhost:3000** no navegador.

Para fechar a aplicação e preservar os dados, execute na pasta do projeto:

```bash
docker compose down
```

Para abrir novamente:

```bash
docker compose up -d
```

## Sobre a aplicação

Aplicação local e didática em **Next.js, React e TypeScript estrito**, com interface, mensagens, contratos e código próprios em português brasileiro.

Compare filas independentes usando PostgreSQL puro e Redis + PostgreSQL. Nos dois modos, **PostgreSQL é a fonte persistente dos dados**. No painel, os dois resultados são chamados **PostgreSQL** e **Redis**, cada um resumindo as três rodadas pela mediana. O nome Redis representa Redis + PostgreSQL; a comparação não representa Redis isolado e não pressupõe um vencedor.

## Executar com Docker

Requer Docker Engine e Docker Compose:

```bash
docker compose up --build -d
docker compose logs -f app
```

Abra **http://localhost:3000**. A porta é publicada apenas em `127.0.0.1`. Se estiver ocupada, altere somente o lado esquerdo do mapeamento em `compose.yaml`, por exemplo `127.0.0.1:3035:3000`.

Para encerrar preservando os dados:

```bash
docker compose down
```

Os volumes PostgreSQL e Redis existentes foram mantidos, assim como as tabelas e as chaves da aplicação anterior. Não execute `down -v` se quiser preservar os dados. A conta SQL precisa de permissão para criar tabelas e schemas exclusivos das comparações.

## Desenvolvimento sem Docker

Requer Node.js 22 ou superior, PostgreSQL 16 e Redis 7:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Ajuste `DATABASE_URL` e `REDIS_URL` em `.env.local`. Não versione credenciais. O Next.js carrega esse arquivo automaticamente.

Para executar a versão otimizada:

```bash
npm run build
npm start
```

O build não exige conexão com os bancos. As conexões e as tabelas são preparadas no primeiro acesso à API; a fila Redis é reconstruída a partir do SQL nessa inicialização. Sem Redis, o modo PostgreSQL continua disponível; para restabelecer o outro modo, use **Reconstruir fila Redis** após recuperar o serviço.

## Demonstração

1. Escolha PostgreSQL e emita uma ou dez senhas.
2. Chame senhas nos três guichês e finalize os atendimentos.
3. Alterne para Redis: a fila desse modo é independente.
4. No laboratório, escolha 10, 100, 500 ou 1.000 senhas e 3, 5, 10 ou 20 atendentes simultâneos.
5. Inicie a comparação e acompanhe as três rodadas por motor, a tabela e o gráfico.

**Limpar este modo** apaga suas senhas e histórico mediante digitação de `LIMPAR FILA`. **Reiniciar sistema** exige `REINICIAR SISTEMA`, apaga ambos os modos e os resultados atuais e reinicia a numeração em 001. Essas ações são irreversíveis. Limpeza e reconstrução aguardam as escritas em andamento e rejeitam novas alterações durante sua execução. Se houver comparação, cancele e aguarde o encerramento antes da manutenção.

## Comparação e interpretação

Cada rodada usa dados exclusivos e as mesmas funções da aplicação. Há aquecimento, alternância da ordem dos motores e auditoria SQL de quantidade e estados finais. O laboratório não limpa as filas normais e não usa `FLUSHDB` ou `FLUSHALL`.

- **Tempo total:** criação + atendimento. Não inclui aquecimento, preparação, auditoria ou limpeza.
- **Atendimentos/s:** finalizações bem-sucedidas divididas pelos segundos de atendimento.
- **Média e p95:** duração de cada ciclo de chamada + finalização, incluindo espera por conexão SQL. p95 usa nearest rank e considera somente ciclos bem-sucedidos; erros permanecem separados.
- **Gráfico:** mediana dos tempos totais das rodadas válidas disponíveis, com escala linear iniciada em zero. Resultados parciais são identificados pelo estado da execução.
- **Conclusão:** exige seis rodadas válidas e completas, sem erros ou duplicações. A redução é `(maior − menor) / maior × 100`. Diferenças inferiores a 1% recebem “Desempenho muito próximo”, sem inferência de significância estatística.

Cada atendente executa um ciclo por vez; há até 20 ciclos simultâneos, com pool SQL exclusivo de 20 conexões. O pool normal também tem máximo 20. O laboratório verifica reserva de conexões e margem de memória Redis antes de iniciar.

O limite de execução é de dois minutos e 1 GiB de RSS do processo Node. Esses limites são verificados entre operações; não são limites rígidos do sistema operacional nem incluem a memória dos bancos. Consultas SQL têm limite de 10 s, espera de conexão de 5 s e limite no cliente de 15 s. Comandos Redis têm limite de 10 s. Cancelamento e falhas aguardam os consumidores em andamento antes de limpar seus recursos.

Há apenas uma comparação atual em memória. Outra execução ou reinicialização substitui seus resultados. Esta versão não inclui estresse progressivo, cargas maiores, exportações dedicadas nem histórico persistente.

Registre versões, CPU/RAM, armazenamento e configurações de persistência ao apresentar medições. Redis no Compose usa AOF. As tecnologias compartilham recursos físicos; evite operar o painel durante o teste. Sob concorrência, FIFO para reserva da próxima senha disponível não significa ordem estrita de conclusão.

## Organização e boas práticas

- `src/app`: páginas, layout e rotas HTTP no runtime Node.js.
- `src/features`: componentes por funcionalidade e cálculos de apresentação.
- `src/server`: conexões, regras de fila, coordenação, validação e laboratório.
- `src/components`, `src/lib` e `src/types`: elementos compartilhados, cliente HTTP, formatação e contratos.
- `testes`: cenários unitários e integração com serviços reais.

TypeScript usa `strict`; entradas são validadas com Zod. SQL é parametrizado. Componentes usam CSS Modules e tokens globais, sem estilos estáticos no JSX. A interface oferece navegação por teclado, confirmação em diálogo, foco visível, mensagens acessíveis e adaptação a telas pequenas.

Os nomes físicos SQL e Redis foram preservados por compatibilidade. Nomes exigidos pelo Next.js, bibliotecas e formatos de configuração também são exceções técnicas ao português. O Kardápio Digital foi consultado somente como referência de boas práticas; não é dependência desta aplicação.

## API em português

As respostas desabilitam cache. Erros usam `{ "mensagem": "…" }` e status HTTP correspondente. A API anterior em inglês foi substituída; seus consumidores precisam atualizar rotas e campos.

| Método | Rota | Entrada / finalidade |
|---|---|---|
| GET | `/api/saude` | Conectividade PostgreSQL e disponibilidade Redis |
| GET | `/api/estado?modo=postgres` | Indicadores, aguardando, ativas e recentes |
| GET | `/api/eventos` | SSE com eventos `conectado` e `alteracao` |
| POST | `/api/senhas` | `{ "modo": "redis", "quantidade": 1 }`; quantidade 1 ou 10 |
| POST | `/api/chamar` | `{ "modo": "redis", "guiche": "01" }` |
| POST | `/api/finalizar` | Mesmo contrato; guichês 01, 02 ou 03 |
| POST | `/api/limpar` | `{ "modo": "redis", "confirmacao": "LIMPAR FILA" }` |
| POST | `/api/reconstruir-redis` | `{}`; recupera a fila pelo SQL |
| POST | `/api/reiniciar` | `{ "confirmacao": "REINICIAR SISTEMA" }` |
| POST | `/api/comparacao` | `{ "quantidade": 100, "atendentes": 3 }`; retorna 202 |
| GET | `/api/comparacao` | Situação, progresso e rodadas atuais |
| POST | `/api/comparacao/cancelar` | `{}`; solicita cancelamento cooperativo |

O SSE reconecta automaticamente pelo navegador. Uma consulta periódica a cada cinco segundos mantém o painel atualizado quando o fluxo não estiver disponível. O laboratório consulta progresso a cada 1,5 s.

## Validação

```bash
npm run check
npm test
npm run build
```

Os testes unitários cobrem limites, estatísticas, conclusões incompletas ou inválidas, consumidores simultâneos, cancelamento com drenagem, exclusão por guichê, coordenação de manutenção e validação HTTP.

Para executar a integração em um ambiente Docker descartável e separado:

```bash
docker compose -f compose.testes.yaml up --build --abort-on-container-exit --exit-code-from testes
docker compose -f compose.testes.yaml down
```

Esse ambiente não publica portas e não utiliza os volumes normais. Também é possível fornecer serviços **exclusivos para testes**:

```bash
TESTE_BANCOS_REAIS=1 \
DATABASE_URL_TESTE=postgres://redisflow:redisflow@localhost:5432/redisflow_teste \
REDIS_URL_TESTE=redis://localhost:6379 \
npm run test:integracao
```

Sem a habilitação explícita, os cenários são pulados; isso não comprova integração. Os testes reais cobrem 100 senhas com dez consumidores nos dois modos, emissão concorrente, colisão de guichê, falha Redis após retirada e após atualização SQL, reconstrução com nova instância de serviço e isolamento das seis rodadas.

### Limitações operacionais

A aplicação utiliza **uma única instância Node.js**; não deve ser publicada como função serverless ou replicada. Não tem autenticação e destina-se ao ambiente local.

PostgreSQL e Redis não compartilham transação distribuída. Falhas entre escrita SQL e publicação/confirmação Redis exigem reconstrução da fila. Não repita automaticamente uma emissão de resultado incerto: as senhas podem já estar persistidas.

Após encerramento abrupto, schemas `rfbench_<uuid>` e chaves com o mesmo prefixo podem permanecer. Inspecione e remova apenas os recursos exclusivos abandonados; preserve as tabelas `public` e as chaves `redisflow:*`.

### Verificações desta implementação

- Instalação limpa por `npm ci`: concluída; versões registradas em `package-lock.json`.
- `npm run check`: lint e TypeScript estrito aprovados.
- `npm test`: 16 testes unitários aprovados, incluindo validação de origem no Docker.
- `npm run build`: build de produção aprovado.
- Ambos os arquivos Compose passaram pela validação de configuração.
- Página inicial: resposta HTTP 200 e conteúdo em pt-BR conferidos nos servidores de desenvolvimento e produção.
- Comparação real em Docker: seis rodadas válidas com 1.000 senhas e três atendentes, sem erros ou duplicações e preservando as filas do painel. Origens locais `127.0.0.1` e `localhost` aceitas; origem externa rejeitada com HTTP 403.
- Suíte completa de integração: os oito cenários separados ainda não foram executados; a verificação real acima foi feita diretamente contra a aplicação no Docker.
- Inspeção visual em navegador: pendente; Chromium bloqueado por restrições de sockets do ambiente. Conferir 390 px, 768 px e 1440 px, navegação por teclado, confirmações e comparação real antes da apresentação.

Nenhuma medição de desempenho foi inventada ou usada para preencher o painel.
