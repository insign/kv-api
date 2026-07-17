# Plano autoritativo — aliases de mutação via GET com JSON em base64url

## Status

**Ready.** O desenho funcional está fechado e a implementação pode começar sem decisões adicionais. Não há blocker técnico conhecido. A publicação em produção e o smoke test destrutivo sobre um ID descartável exigem apenas a confirmação operacional obrigatória imediatamente antes de `npm run deploy`; essa confirmação não reabre decisões de produto.

## Problema

A API pública `https://kv.helio.me` aceita hoje leitura por `GET`, substituição completa por `PUT`, alteração de um valor por JSON Pointer por `PUT` e exclusão por `DELETE`. Alguns clientes só conseguem emitir `GET`. Adicione aliases de compatibilidade que transportem o comando e o JSON pela query string, mantendo todos os métodos canônicos e todos os invariantes atuais.

Implemente exatamente este contrato:

```text
# Leitura atual e alias explícito
GET /meu-id
GET /meu-id?method=GET

# Substituição completa
GET /meu-id?method=PUT&data=eyJub21lIjoiQW5hIn0

# Alteração por JSON Pointer
GET /meu-id/value?method=PUT&path=%2Fnome&data=IkJpYSI

# Exclusão
GET /meu-id?method=DELETE

# Versão, sempre somente leitura
GET /meu-id/version
```

`data` contém um valor JSON completo codificado em UTF-8 e depois em base64url canônico sem padding. Em Node.js, a produção correta do parâmetro é:

```js
Buffer.from(JSON.stringify(valor), "utf8").toString("base64url")
```

O JSON `{"nome":"Ana"}` resulta em `eyJub21lIjoiQW5hIn0`; o JSON string `"Bia"` resulta em `IkJpYSI`.

## Objetivo

Ao concluir o plano:

- clientes limitados a `GET` poderão ler, substituir, alterar por caminho e excluir itens;
- `PUT /:id`, `PUT /:id/value`, `DELETE /:id`, `GET /:id` e `GET /:id/version` continuarão com o contrato atual;
- aliases e métodos canônicos usarão as mesmas funções de persistência, versionamento, timestamps, CAS, serialização e erros de armazenamento;
- `data` aceitará no máximo `10.000` bytes após decodificação base64url;
- aliases mutantes aceitarão no máximo `15.000` bytes na URL absoluta recebida pelo Worker;
- JSON bruto válido continuará preservando literais como `9007199254740993` e `1e400` sem parse e reserialização pelo JavaScript antes de chegar ao D1;
- cada repetição da mesma URL mutante executará uma nova mutação e incrementará `version` quando aplicável;
- respostas continuarão com `Cache-Control: no-store` e também receberão `Referrer-Policy: no-referrer`;
- documentação, testes e produção refletirão o mesmo contrato.

## Contexto e restrições

- Projeto: Cloudflare Worker JavaScript com D1/SQLite.
- Worker: `kv`; endpoint oficial: `https://kv.helio.me`.
- Binding D1: `env.tasks`; banco `tasks`.
- Implementação HTTP completa: `src/worker.js`.
- Parser e planejamento RFC 6901/JSON1: `src/json-path.js`.
- Documentação HTML pública: `src/docs.js`, servida por `GET /`.
- Testes HTTP e mock D1: `test/worker.test.mjs`.
- Testes JSON Pointer: `test/json-path.test.mjs`.
- Documentação resumida: `README.md`.
- Contrato operacional normativo: `AGENTS.md`.
- Configuração de produção: `wrangler.jsonc`.
- Comandos: `npm test`, `npx wrangler deploy --dry-run` e `npm run deploy`.
- Limite atual do corpo canônico e do resultado por caminho: `1.900.000` bytes.
- Limite atual do Cloudflare Workers para URL: `16 KB`; o limite interno de `15.000` bytes é margem preventiva.
- A API permanece pública, sem autenticação e com CORS aberto. Não introduza autenticação.
- Não altere migrations, schema D1, binding, rota, WAF, observabilidade, `workers_dev`, preview URLs ou hostname.
- Não adicione pacote ou dependência. Use somente Web APIs disponíveis no Worker (`URL`, `URLSearchParams`, `TextEncoder`, `TextDecoder`, `atob`, `btoa`).
- Não registre a URL, `data`, os bytes decodificados ou o JSON em `console`.
- GET com efeito colateral contraria a semântica HTTP segura e pode ser repetido por prefetch, crawlers, previews, retries, caches intermediários e ferramentas de inspeção. O risco é aceito como requisito de compatibilidade e deve ser documentado, não ocultado.
- Base64url é codificação, não criptografia. Dados na URL podem aparecer em histórico, logs, analytics, proxies e referers.

## Decisões resolvidas

1. **Aliases são aditivos.** Não remova nem altere os métodos HTTP canônicos.
2. **`method` só tem significado quando o método HTTP real é `GET`.** Em requisições reais `PUT` e `DELETE`, queries chamadas `method` ou `data` continuam sem reinterpretar o método.
3. **Os valores de `method` são case-sensitive e canônicos:** aceite somente `GET`, `PUT` e `DELETE` em maiúsculas. Rejeite `put`, `delete`, string vazia e valores desconhecidos.
4. **O nome do parâmetro também é case-sensitive.** Somente `method` ativa o alias. Uma leitura sem esse nome exato conserva a tolerância atual a queries alheias.
5. **Leituras sem `method` permanecem compatíveis.** `GET /:id?qualquer=valor` continua sendo leitura e não entra na gramática estrita de alias.
6. **Quando `method` está presente em `GET /:id`, a query é estrita:**
   - `method=GET`: somente `method`;
   - `method=PUT`: somente `method` e `data`, uma ocorrência de cada;
   - `method=DELETE`: somente `method`.
7. **Em `GET /:id/value`, somente `method=PUT` ativa alias.** A query deve conter exatamente uma ocorrência de `method`, `path` e `data`, sem parâmetros adicionais. `GET /:id/value` sem `method` continua retornando `405 METHOD_NOT_ALLOWED` com `Allow: PUT, OPTIONS`.
8. **`GET /:id/version` é sempre somente leitura.** Não execute alias nessa rota; preserve seu comportamento atual.
9. **A URL absoluta é medida em bytes UTF-8:** `new TextEncoder().encode(request.url).byteLength`. Aplique o máximo de `15.000` bytes somente a aliases mutantes reconhecidos (`method=PUT` ou `method=DELETE`).
10. **`data` usa base64url canônico sem padding.** Aceite somente `A-Z`, `a-z`, `0-9`, `-` e `_`; rejeite `=`, `+`, `/`, whitespace, comprimento com resto `1` por `4` e encodings com bits finais não canônicos.
11. **O máximo codificado correspondente a 10.000 bytes é 13.334 caracteres.** Faça essa pré-verificação depois da validação estrutural e antes de alocar o resultado de `atob`; confirme novamente o tamanho real depois da decodificação.
12. **`data=` vazio está presente, mas é JSON inválido.** Retorne `INVALID_JSON`, não `MISSING_DATA_PARAMETER`.
13. **Preserve o texto JSON decodificado.** Use `JSON.parse` apenas para validar; passe o texto original para substituição completa e para `json(?)` no fluxo por caminho.
14. **Reexecução não é deduplicada.** Não implemente nonce, `request_id`, `If-Match`, cache de comando ou idempotency key. A mesma URL PUT executada duas vezes incrementa `version` duas vezes. DELETE bem-sucedido seguido da mesma URL retorna `ITEM_NOT_FOUND` na segunda execução.
15. **Use `version` como indicador de repetição.** `updated_at` pode permanecer igual entre gravações no mesmo milissegundo.
16. **Mantenha `Cache-Control: no-store`.** Não use Cache API e não acrescente cache manual. Adicione `Referrer-Policy: no-referrer` aos headers comuns como mitigação limitada; documente que isso não elimina histórico e logs.
17. **Não ecoe `data`.** Erros podem retornar contagens, limites, motivos estáveis e nomes de parâmetros inesperados, mas nunca o valor codificado, bytes decodificados ou JSON.

## Contrato de erros novo

Adicione estes códigos a `ERROR_STATUS` em `src/worker.js` e use exatamente os status, mensagens, hints e detalhes abaixo:

| Status | Code | Mensagem e hint | Detalhes permitidos |
| --- | --- | --- | --- |
| 400 | `DUPLICATE_METHOD_PARAMETER` | `O parâmetro method foi enviado mais de uma vez.` / `Envie exatamente um parâmetro method.` | `method_count` |
| 400 | `INVALID_METHOD_PARAMETER` | `O parâmetro method não é válido para esta rota.` / `Use somente os valores method documentados para esta rota.` | `accepted_methods` |
| 400 | `UNEXPECTED_QUERY_PARAMETER` | `A query contém parâmetros não permitidos para este comando.` / `Envie somente os parâmetros documentados para o método selecionado.` | `parameters`, lista ordenada e sem valores |
| 400 | `MISSING_DATA_PARAMETER` | `O parâmetro data é obrigatório.` / `Envie exatamente um parâmetro data contendo JSON UTF-8 em base64url sem padding.` | nenhum |
| 400 | `DUPLICATE_DATA_PARAMETER` | `O parâmetro data foi enviado mais de uma vez.` / `Envie exatamente um parâmetro data.` | `data_count` |
| 400 | `INVALID_DATA_ENCODING` | `O parâmetro data não contém base64url canônico sem padding.` / `Use apenas A-Z, a-z, 0-9, - e _, sem =, espaços ou alfabeto base64 padrão.` | `reason` entre `invalid_alphabet_or_padding`, `invalid_length`, `decode_failed` e `non_canonical` |
| 413 | `QUERY_DATA_TOO_LARGE` | `O JSON decodificado de data excede o limite de 10.000 bytes.` / `Reduza data para no máximo 10.000 bytes após a decodificação base64url.` | `max_bytes: 10000` e `received_bytes` somente quando conhecido |
| 414 | `URI_TOO_LONG` | `A URL excede o limite preventivo de 15.000 bytes.` / `Reduza data, path ou o tamanho total da URL.` | `uri_bytes`, `max_uri_bytes: 15000` |

Reutilize `INVALID_UTF8` e `INVALID_JSON` para corpo e query. Torne as mensagens desses dois erros independentes do transporte, por exemplo `O valor JSON não está codificado em UTF-8 válido.` e `O valor recebido não contém JSON válido.`, mantendo os códigos e status atuais. Reutilize sem mudanças todos os erros de JSON Pointer e persistência.

## Ordem determinística de validação

Implemente esta precedência para evitar respostas variáveis:

1. Resolva rota e valide ID.
2. Em uma rota elegível e com método HTTP real `GET`, leia todas as ocorrências do nome exato `method`.
3. Rejeite `method` duplicado.
4. Rejeite valor de `method` inválido para a rota.
5. Para `PUT` ou `DELETE` reconhecido, valide o limite de 15.000 bytes da URL.
6. Rejeite nomes de parâmetros não permitidos para o comando.
7. Em `/:id/value`, execute `parseJsonPointer(url.searchParams)` antes de validar ou decodificar `data`, preservando a precedência atual dos erros de caminho.
8. Rejeite ausência ou duplicação de `data`.
9. Valide estrutura, tamanho, decodificação canônica, UTF-8 e JSON de `data`, nessa ordem.
10. Execute a operação compartilhada.

## Visão geral da implementação

Adicione helpers pequenos e internos a `src/worker.js`, extraia as operações de substituição completa e exclusão atualmente inline e direcione tanto os métodos canônicos quanto os aliases a essas mesmas operações. Não altere `src/json-path.js`: `parseJsonPointer`, `planJsonSetPath` e `setJsonValue` já fornecem o contrato necessário. Expanda os testes antes de concluir o código, atualize as três superfícies documentais, execute a revisão independente e só então publique.

## Etapas de execução

### 1. Inicialize a execução durável pelo protocolo de commits ancorados

- **Arquivos:** `final_plan.md`; nenhum arquivo de código nesta etapa.
- **Ações:**
  1. Execute `git status --short --branch` e inspecione mudanças preexistentes. Não inclua mudanças do usuário em commits do plano.
  2. Localize o último plano com `git log --grep="AGENT_PLAN_ANCHOR" -n 1 --pretty=format:%H`. Se houver execução ativa e incompatível, pare e informe o conflito; não misture planos.
  3. Crie um commit `plan: add GET mutation aliases` contendo `AGENT_PLAN_ANCHOR` e um corpo autossuficiente que reproduza problema, objetivo, decisões, etapas, riscos, testes, deploy e smoke test deste arquivo. Inclua `final_plan.md` nesse commit e não o altere depois do início da implementação.
  4. Guarde o hash em `PLAN_HASH`. Todos os commits de progresso devem conter `PLAN_REF: <PLAN_HASH>` e `PREVIOUS_STEP`.
- **Risco:** médio; um commit mal preparado pode capturar alterações alheias. Mitigue revisando `git status` e staging antes de cada commit.
- **Validação:** `git show "$PLAN_HASH"` deve exibir `AGENT_PLAN_ANCHOR` e o plano completo.

### 2. Implemente os helpers, o roteamento e os testes de contrato

- **Arquivos:** `src/worker.js`, `test/worker.test.mjs`.
- **Ações em `src/worker.js`:**
  1. Adicione `MAX_GET_DATA_BYTES = 10_000`, `MAX_GET_URI_BYTES = 15_000`, `MAX_GET_DATA_CHARACTERS = 13_334` e regex base64url canônica junto aos limites existentes.
  2. Extraia a decodificação UTF-8 fatal e a validação `JSON.parse` de `readJsonRequestBody` para um helper comum que receba `Uint8Array` e devolva o texto original. Faça `readJsonRequestBody` conservar todos os limites, cancelamento de stream e `PAYLOAD_TOO_LARGE`, chamando o helper comum somente após ler os bytes.
  3. Crie um construtor de erro para encoding inválido que nunca receba nem armazene `data`.
  4. Crie `decodeQueryData(encoded)` com a sequência exata: regex; resto por quatro; máximo de 13.334 caracteres; tradução `-`→`+` e `_`→`/`; padding interno; `atob`; cópia para `Uint8Array`; máximo real de 10.000 bytes; recodificação por `btoa` para base64url sem padding; comparação exata com a entrada; helper UTF-8/JSON comum. `data=` deve chegar ao helper JSON e falhar como `INVALID_JSON`.
  5. Crie helper para medir `request.url` com `TextEncoder` e lançar `URI_TOO_LONG` sem incluir a URL nos detalhes.
  6. Crie helper para coletar ocorrências com `URLSearchParams.getAll`, detectar duplicatas e listar nomes inesperados de forma única e ordenada.
  7. Extraia o SQL de `PUT /:id` para `replaceItem(db, id, jsonText)`. Preserve exatamente `INSERT ... ON CONFLICT ... RETURNING`, incremento atômico, `created_at`, `updated_at`, tratamento de `STORE_FAILED` e retorno da row.
  8. Extraia o SQL de `DELETE /:id` para `deleteItem(db, id)`. Preserve `DELETE ... RETURNING`, `ITEM_NOT_FOUND`, `STORE_FAILED` e resposta `{ ok: true, id }`.
  9. Adicione `Referrer-Policy: no-referrer` a `corsHeaders`, fazendo-o aparecer em JSON, HTML e `OPTIONS`, sem adicionar `Cache-Control` ao `204 OPTIONS`.
  10. Na rota `/:id/value`, preserve o fluxo atual para `PUT`. Para método HTTP real `GET`, ative apenas `method=PUT`, aplique a gramática/ordem definida, obtenha `replacementJson` de `data` e chame o mesmo `setJsonValue`. Preserve a inserção de `path` nos detalhes de conflitos existentes.
  11. Na rota `/:id`, para `GET` sem `method`, execute a leitura atual. Para `method=GET`, rejeite qualquer parâmetro além de `method` e execute a mesma leitura. Para `method=PUT`, valide/decode `data` e chame `replaceItem`. Para `method=DELETE`, chame `deleteItem`. Não interprete aliases em métodos HTTP reais diferentes de `GET`.
  12. Preserve integralmente `/`, `/:id/version`, CORS, IDs, envelopes, status, `Allow` e serialização lexical por `itemJson`.
- **Ações em `test/worker.test.mjs`:**
  1. Adicione `MAX_GET_DATA_BYTES`, `MAX_GET_URI_BYTES` e helper Node `Buffer.from(text, "utf8").toString("base64url")`.
  2. Teste `GET /:id?method=GET` e leitura sem `method`, incluindo query alheia sem ativação de alias.
  3. Teste criação e substituição por `GET /:id?method=PUT&data=...`, comparando envelope, versão, timestamps e JSON com `PUT /:id`.
  4. Teste `GET /:id/value?method=PUT&path=...&data=...` para criação, folha, ancestrais, arrays e todos os conflitos já cobertos no método canônico.
  5. Teste `GET /:id?method=DELETE`, sucesso seguido de `404` na repetição.
  6. Execute exatamente a mesma URL PUT duas vezes e confirme versões `1` e `2`; faça o mesmo com uma atualização por caminho e confirme incremento em toda execução, inclusive no-op.
  7. Teste objeto, array, string, número, booleano e `null`, além de Unicode, `9007199254740993` e `1e400`. Use `RecordingD1` para provar que o texto extremo chega sem reserialização aos bindings `json(?)`.
  8. Teste todos os novos erros: método duplicado, método desconhecido ou lowercase, parâmetro inesperado, `data` ausente e duplicado, alfabeto padrão, padding, whitespace, comprimento inválido, forma não canônica, UTF-8 inválido, JSON inválido e `data=` vazio.
  9. Teste que nenhum corpo de erro contém o valor original de `data` nem o JSON decodificado.
  10. Teste 10.000 bytes decodificados com `JSON.stringify("a".repeat(9_998))` e 10.001 bytes com `JSON.stringify("a".repeat(9_999))`.
  11. Construa dinamicamente uma URL de alias por caminho com `data` válido e um segmento `path` de preenchimento para obter exatamente 15.000 bytes em `request.url`; confirme sucesso. Acrescente um caractere para 15.001 bytes e confirme `414 URI_TOO_LONG` antes da mutação.
  12. Teste a precedência: `/:id/value?method=PUT` retorna `MISSING_PATH_PARAMETER` antes de `MISSING_DATA_PARAMETER`; path válido sem data retorna `MISSING_DATA_PARAMETER`; URI excessiva retorna `URI_TOO_LONG` antes de decodificar data.
  13. Teste que `GET /:id/value` sem `method` continua `405` com `Allow: PUT, OPTIONS` e que `method=GET` nessa rota retorna `INVALID_METHOD_PARAMETER`.
  14. Teste que `PUT /:id?method=DELETE` continua executando PUT com o corpo, que `DELETE /:id?method=PUT&data=...` continua excluindo e que `GET /:id/version?method=DELETE` continua somente leitura.
  15. Teste `Cache-Control: no-store` e `Referrer-Policy: no-referrer` em sucesso, erro e HTML; preserve a ausência de `Cache-Control` em `OPTIONS`.
- **Risco:** alto; a maior ameaça é divergência entre alias e método canônico ou mutação acidental por query ambígua. Mitigue compartilhando operações e cobrindo a matriz completa.
- **Validação:** execute `npm test`; todos os testes antigos e novos devem passar. Rode o Reviewer Loop completo sobre o diff de código e testes: até três reviewers independentes, payload idêntico, foco em roteamento, vazamento, cache, encoding, preservação lexical, concorrência e regressões. Corrija achados críticos e warnings válidos, repita `npm test` e refaça a revisão até não restar correção aprovada.
- **Commit:** após testes e revisão verdes, crie `chore(agent): [Step 1/2] implement GET mutation aliases` com `PLAN_REF` e `PREVIOUS_STEP`.

### 3. Sincronize toda a documentação pública e normativa

- **Arquivos:** `src/docs.js`, `README.md`, `AGENTS.md`, e os asserts documentais em `test/worker.test.mjs`.
- **Ações em `src/docs.js`:**
  1. Preserve o design responsivo e a ausência de scripts, fontes, estilos ou assets externos.
  2. Mantenha os métodos canônicos como recomendação principal e adicione uma seção clara “Compatibilidade via GET”.
  3. Documente os cinco exemplos exatos do contrato, incluindo os valores conhecidos `eyJub21lIjoiQW5hIn0` e `IkJpYSI`.
  4. Inclua exemplos Node.js e navegador para produzir base64url UTF-8 sem padding. No navegador, use `TextEncoder`, converta bytes para string binária, aplique `btoa`, troque `+`/`/` por `-`/`_` e remova `=` finais.
  5. Explique a gramática estrita, case sensitivity, duplicatas, parâmetros proibidos e a regra de que `method` só atua em GET real.
  6. Explique os limites de 10.000 bytes decodificados, 13.334 caracteres codificados, 15.000 bytes de URL e 16 KB da plataforma. Diga explicitamente que um `path` maior reduz o espaço disponível para `data`.
  7. Preserve o limite de 1.900.000 bytes dos PUTs canônicos e deixe clara a assimetria.
  8. Adicione todos os novos códigos à tabela de erros com status, contexto e ação.
  9. Adicione aviso destacado: mutações via GET podem ser disparadas por prefetch, crawlers, previews e retries; URLs podem aparecer em histórico, logs, analytics, proxies e referers; base64url não protege confidencialidade; não use para segredos.
  10. Documente que repetir a mesma URL executa novamente e que `version`, não timestamp, confirma a nova gravação.
- **Ações em `README.md`:** replique o contrato resumido, exemplos, geração Node, limites, riscos, repetição, códigos principais e recomendação pelos métodos canônicos.
- **Ações em `AGENTS.md`:** acrescente os aliases à tabela do contrato, uma seção normativa sobre base64url/query/limites, os novos códigos estáveis, os testes de produção e a regra de não tratar CORS, base64url ou `no-store` como proteção contra execução indevida ou exposição.
- **Ações nos testes:** amplie o teste da home para exigir aliases, limites, avisos e todos os novos códigos; continue proibindo assets externos e hostnames não autorizados.
- **Risco:** médio; documentação divergente vira contrato incorreto. Mitigue copiando valores e exemplos diretamente dos testes de contrato.
- **Validação:** execute `npm test` e confirme que o HTML continua responsivo, autocontido e contém apenas `https://kv.helio.me` como endpoint da API.
- **Commit:** crie `chore(agent): [Step 2/2] document GET compatibility aliases` com `PLAN_REF` e `PREVIOUS_STEP`.

### 4. Execute os gates finais e publique

- **Arquivos:** nenhum novo arquivo; não altere configuração ou migration.
- **Ações locais:**
  1. Execute `npm test` e exija zero falhas.
  2. Execute `npx wrangler deploy --dry-run` e exija bundle válido para o Worker `kv`.
  3. Revise `git status --short --branch`, `git diff`, os commits do plano e `wrangler.jsonc`; confirme que a única rota continua `kv.helio.me`, `workers_dev` e previews continuam desabilitados e nenhuma migration foi adicionada.
  4. Não execute probe D1 local adicional: o SQL e a semântica JSON1 não mudam; a produção reutiliza as operações já validadas. Se o diff tiver alterado SQL apesar desta proibição, pare, reverta esse desvio de escopo e reexecute os gates.
- **Confirmação operacional obrigatória:** imediatamente antes da mudança externa, apresente ao usuário o alvo “conta Hélio, Worker `kv`, rota `https://kv.helio.me`”, o comando `npm run deploy`, o fato de que ele executa migrations remotas pendentes antes do deploy, o smoke test mutante descrito abaixo e a recuperação por redeploy do último commit conhecido. Só prossiga após confirmação explícita desse escopo exato.
- **Deploy:** execute `npm run deploy`. Não inverta a ordem migration→deploy, embora nenhuma migration nova deva existir.
- **Smoke test:** use um ID único no formato válido `kvgetsmoke-<timestamp>-<sufixo>` e limite o teste a menos de 30 requisições em 10 segundos:
  1. Confirme `404` inicial com `GET /:id`.
  2. Gere base64url de `{"nome":"Ana","valores":[1]}` e chame `GET /:id?method=PUT&data=...`; exija versão `1` e timestamps iguais.
  3. Repita a URL idêntica; exija versão `2` e `created_at` preservado.
  4. Gere base64url de `"Bia"` e chame `GET /:id/value?method=PUT&path=%2Fnome&data=...`; exija versão `3` e `json.nome === "Bia"`.
  5. Gere base64url de `2` e chame `GET /:id/value?method=PUT&path=%2Fvalores%2F1&data=...`; exija versão `4` e array `[1,2]`.
  6. Chame uma URL segura inválida, como `GET /:id/value?method=PUT&path=&data=MQ`; exija erro estruturado `ROOT_PATH_NOT_ALLOWED` e nenhuma mudança de versão.
  7. Consulte `GET /:id/version`; exija `{ id, version: 4 }`.
  8. Exclua com `GET /:id?method=DELETE`; exija `{ ok: true, id }`.
  9. Confirme `404` posterior.
  10. Em qualquer falha intermediária, tente limpar somente o mesmo ID descartável; nunca leia, sobrescreva ou apague IDs desconhecidos.
- **Recuperação:** se houver regressão, restaure o último commit conhecido como bom, execute `npm test`, `npx wrangler deploy --dry-run` e publique novamente com `npm run deploy`; confirme o comportamento canônico e remova o ID descartável.
- **Push:** não faça push Git remoto sem uma autorização separada e explícita. Os commits locais ancorados são obrigatórios; o push não faz parte deste escopo.
- **Validação final:** registre versão do Worker publicada, resultado dos comandos, resultado de cada smoke check, confirmação de limpeza e qualquer check deliberadamente omitido.

## Estratégia de testes consolidada

O conjunto final deve provar, no mínimo:

- todas as rotas canônicas continuam passando;
- todos os aliases retornam o mesmo envelope e efeitos das operações compartilhadas;
- leitura sem `method` mantém compatibilidade de query;
- aliases só são interpretados para método HTTP real GET e nas rotas autorizadas;
- gramática e precedência de erros são determinísticas;
- base64url é canônico, UTF-8 é fatal e JSON bruto é preservado;
- limites inclusivos são exatamente 10.000 e 15.000 bytes;
- `path` consome o orçamento total da URL;
- duplicatas não são silenciosamente aceitas;
- repetições executam e versionam novamente;
- dados sensíveis não aparecem em erros ou logs adicionados pela aplicação;
- `no-store` e `no-referrer` estão presentes;
- nenhuma regra de JSON Pointer, concorrência, limite de resultado, timestamp legado, CORS ou método permitido regrediu;
- bundle e configuração Wrangler permanecem válidos;
- smoke test produtivo comprova execução repetida, mutação por caminho, versão e cleanup.

## Riscos e mitigações

### Crítico — GET mutante pode ser disparado sem intenção

- **Risco:** crawlers, prefetch, previews, retries e automações podem executar a URL.
- **Mitigação:** manter aviso destacado, recomendar métodos canônicos, usar `no-store`, não gerar links clicáveis de mutação e aceitar explicitamente que não há deduplicação.

### Alto — conteúdo da query pode vazar

- **Risco:** histórico, logs, analytics, proxies e referers podem armazenar `data`.
- **Mitigação:** limite pequeno, `Referrer-Policy: no-referrer`, nenhum log próprio, nenhum eco em erros e documentação proibindo segredos. Não alegar confidencialidade.

### Alto — divergência entre aliases e métodos canônicos

- **Risco:** SQL, versões, timestamps ou erros podem evoluir de forma diferente.
- **Mitigação:** uma única função por operação e testes de paridade. Nunca copie SQL para uma branch exclusiva do alias.

### Alto — base64 permissivo aceita entradas ambíguas

- **Risco:** `atob` pode aceitar padding ou bits finais não canônicos.
- **Mitigação:** regex, comprimento, recodificação e igualdade byte/carácter exata.

### Médio — o edge rejeita URL antes do Worker

- **Risco:** acima do limite da plataforma, a resposta pode não seguir o contrato JSON.
- **Mitigação:** limite preventivo de 15.000 bytes e documentação explícita de que o erro estruturado só é garantido para requisições que chegam ao Worker.

### Médio — cache intermediário ignora `no-store`

- **Risco:** uma infraestrutura não conforme pode repetir ou servir resposta antiga.
- **Mitigação:** `Cache-Control: no-store`, nenhum uso de Cache API, teste da URL idêntica duas vezes e documentação de que o cliente deve conferir `version`.

### Baixo — timestamps iguais em gravações rápidas

- **Risco:** smoke ou clientes inferem que não houve nova escrita.
- **Mitigação:** validar monotonicidade por `version`; não exigir `updated_at` estritamente crescente no mesmo milissegundo.

## Suposições a validar

1. **`atob` e `btoa` existem no runtime configurado.**
   - Validação: `npm test` e `npx wrangler deploy --dry-run` executam/bundlam os helpers sem polyfill.
   - Se falso: use a API Web padrão de encoding disponível no runtime documentado; não adicione dependência sem nova decisão.
2. **`request.url` contém a URL absoluta usada pelo Worker.**
   - Validação: teste unitário constrói `Request` absoluta e mede o mesmo campo.
   - Se falso em runtime: bloqueie publicação e confirme a API atual do Workers antes de trocar a métrica; não use contagem de caracteres da query como substituto silencioso.
3. **O SQL atual permanece intocado.**
   - Validação: diff deve mostrar somente extração/movimentação literal das statements de PUT/DELETE, sem mudança textual de semântica.
   - Se falso: remova a alteração SQL e retorne à operação existente antes de continuar.
4. **Não há migration necessária.**
   - Validação: `git diff -- migrations/` vazio e `npm run deploy` reporta ausência de migrations pendentes novas.
   - Se falso: pare; uma migration está fora do escopo deste plano.

## Decisões e nuances

- A presença do nome exato `method` muda a query de leitura para a gramática estrita. Sem ele, preserve a compatibilidade atual.
- `method=GET` é alias explícito de leitura, não uma mutação, e não recebe o limite preventivo de 15.000 bytes da aplicação.
- O orçamento de URL é compartilhado: host, ID, rota, nomes dos parâmetros, `path` percent-encoded e `data` contam juntos.
- A verificação de 13.334 caracteres evita alocação desnecessária, mas o limite normativo continua sendo 10.000 bytes decodificados.
- O parser de JSON valida sintaxe, mas o texto original segue para o D1. Não use `JSON.stringify(JSON.parse(text))` no caminho de persistência.
- Mutação por caminho continuará passando pelo JSON1 e pode normalizar whitespace; literais extremos não tocados devem permanecer lexicalmente estáveis conforme os testes existentes.
- `Referrer-Policy` é mitigação parcial e não justificativa para transportar segredo.
- O WAF pode responder `429` antes do Worker e não precisa seguir o contrato estruturado.
- Não altere `Allow` de `GET /:id/value` sem alias; a compatibilidade GET é um comando ativado por query, não uma mudança no método canônico recomendado.

## Blockers e perguntas abertas

Nenhum blocker de desenho ou implementação. A confirmação operacional antes de deploy/smoke é um gate obrigatório, não uma pergunta de arquitetura.

## Handoff de execução

1. Comece em `/home/ubuntu/MEGA/WORK/kv-api`.
2. Leia `AGENTS.md`, este `final_plan.md`, `src/worker.js`, `src/json-path.js`, `test/worker.test.mjs`, `src/docs.js`, `README.md`, `package.json` e `wrangler.jsonc`.
3. Recupere qualquer `AGENT_PLAN_ANCHOR` existente antes de editar.
4. Crie o Commit Zero descrito na Etapa 1.
5. Implemente primeiro código+testes como uma etapa indivisível e só a comprometa após `npm test` e Reviewer Loop verdes.
6. Atualize documentação como segunda etapa e valide novamente.
7. Execute os gates finais.
8. Solicite a confirmação operacional imediatamente antes de `npm run deploy` e do smoke test.
9. Não prossiga diante de alterações preexistentes conflitantes, teste falhando, review crítico não resolvido, alteração de SQL/schema/rota ou impossibilidade de limpar o ID descartável.

## Fora de escopo

- autenticação ou autorização;
- CORS como mecanismo de segurança;
- nonce, deduplicação, idempotency key ou `request_id`;
- `If-Match` ou controle de versão fornecido pelo cliente;
- JSON Patch, JSON Merge Patch ou múltiplas mutações;
- remoção por JSON Pointer;
- mudança de schema, migration, binding, banco, rota, hostname, WAF ou observabilidade;
- aumento dos limites de 10.000, 15.000 ou 1.900.000 bytes;
- criptografia do conteúdo de `data`;
- garantias contra histórico, logs, referers, caches ou execução automatizada;
- dependências novas;
- push Git remoto sem autorização separada.

## Referências normativas

- Cloudflare Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Wrangler commands: https://developers.cloudflare.com/workers/wrangler/commands/
- HTTP safe methods: https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1
- HTTP caching: https://www.rfc-editor.org/rfc/rfc9111.html
- JSON Pointer: https://www.rfc-editor.org/rfc/rfc6901
