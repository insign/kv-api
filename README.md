# KV API

API pública para armazenar qualquer valor JSON usando um identificador como chave.

- Endpoint: [https://kv.helio.me](https://kv.helio.me)
- Documentação completa: [https://kv.helio.me/](https://kv.helio.me/)
- Infraestrutura: Cloudflare Worker + D1 (SQLite)
- Autenticação: nenhuma

> A API é pública. Qualquer pessoa que conheça um identificador pode ler, substituir ou apagar seu conteúdo. Não armazene senhas, tokens, dados pessoais ou informações confidenciais.

Prefira os métodos canônicos `PUT` e `DELETE`. Aliases mutantes via GET existem somente para clientes que não conseguem selecionar o método HTTP.

## Uso rápido

### Salvar ou substituir

```bash
curl -X PUT "https://kv.helio.me/minha_tarefa" \
  -H "Content-Type: application/json" \
  -d '{"titulo":"Comprar café","feito":false}'
```

### Consultar

```bash
curl "https://kv.helio.me/minha_tarefa"
```

### Consultar a versão

```bash
curl "https://kv.helio.me/minha_tarefa/version"
```

### Atualizar um valor por caminho

```bash
curl -X PUT \
  "https://kv.helio.me/minha_tarefa/value?path=%2Ffeito" \
  -H "Content-Type: application/json" \
  -d 'true'
```

O parâmetro `path` usa [JSON Pointer (RFC 6901)](https://www.rfc-editor.org/rfc/rfc6901). A rota cria ou substitui exatamente um valor e retorna o item completo. Ela cria objetos ancestrais ausentes; em arrays existentes, aceita índices canônicos e permite adicionar no final usando o tamanho atual do array. Não há remoção por caminho, acréscimo com `/-`, criação de lacunas, JSON Patch ou JSON Merge Patch.

Para chaves que contêm `~` ou `/`, use `~0` ou `~1` dentro do segmento e depois codifique o caminho como parâmetro de URL. `path=` não é aceito porque representa a raiz; use `PUT /:id` para substituir o documento completo. `path=/` é válido e representa uma chave vazia.

### Apagar

```bash
curl -X DELETE "https://kv.helio.me/minha_tarefa"
```

## Compatibilidade via GET

Clientes restritos a requisições GET reais podem transportar um comando no parâmetro exato e case-sensitive `method` e um valor JSON em `data`. Os aliases usam as mesmas operações canônicas e preservam comportamento de armazenamento, versões, timestamps, JSON Pointer, conflitos, respostas e erros.

```text
# Leitura atual e alias explícito
GET /meu-id
GET /meu-id?method=GET

# Substituição completa: {"nome":"Ana"}
GET /meu-id?method=PUT&data=eyJub21lIjoiQW5hIn0

# Atualização por JSON Pointer: "Bia" em /nome
GET /meu-id/value?method=PUT&path=%2Fnome&data=IkJpYSI

# Exclusão
GET /meu-id?method=DELETE

# Versão, sempre somente leitura
GET /meu-id/version
```

`data` é exatamente um valor JSON codificado em UTF-8 e depois em base64url canônico sem padding. Gere-o no Node.js assim:

```js
const valor = { nome: "Ana" };
const data = Buffer.from(JSON.stringify(valor), "utf8").toString("base64url");
```

A gramática é deliberadamente estrita:

- Somente os valores maiúsculos `GET`, `PUT` ou `DELETE` documentados para cada rota são aceitos.
- `GET /:id?method=GET` permite somente um `method`; `method=PUT` exige um `method` e um `data`; `method=DELETE` permite somente um `method`.
- `GET /:id/value` aceita apenas `method=PUT`, com exatamente um `method`, um `path` e um `data`.
- Parâmetros duplicados ou inesperados são rejeitados. Um `GET /:id` sem o nome exato `method` continua sendo leitura e ignora queries alheias.
- Queries nunca reinterpretam um PUT ou DELETE real. `GET /:id/version` é sempre somente leitura e `GET /:id/value` sem `method=PUT` continua respondendo `405`.
- Repetir uma URL mutante executa outra mutação e incrementa `version`, inclusive quando o JSON resultante não muda.

Limites exclusivos dos aliases:

- `data` decodificado: no máximo `10.000` bytes UTF-8.
- `data` codificado: no máximo `13.334` caracteres base64url.
- URL absoluta mutante: no máximo `15.000` bytes, incluindo esquema, host, ID, nomes de parâmetros, separadores, `path` percent-encoded e `data`.
- A plataforma Cloudflare aceita URLs de até 16 KB. A borda pode rejeitar URLs maiores antes de a API produzir um erro estruturado.
- Corpos PUT canônicos mantêm o limite de `1.900.000` bytes.

GET com efeito colateral é inerentemente arriscado: prefetchers, crawlers, previews, retries, caches e ferramentas de inspeção podem executar uma URL sem intenção. Base64url não é criptografia; URLs podem permanecer em histórico, logs, analytics, proxies e infraestrutura fora do Worker. Nunca coloque senhas, tokens, dados pessoais ou segredos em um alias mutante e não publique aliases mutantes como links clicáveis. `Cache-Control: no-store` e `Referrer-Policy: no-referrer` são mitigações, não controles de confidencialidade ou execução.

A validação adiciona os códigos estáveis `DUPLICATE_METHOD_PARAMETER`, `INVALID_METHOD_PARAMETER`, `UNEXPECTED_QUERY_PARAMETER`, `MISSING_DATA_PARAMETER`, `DUPLICATE_DATA_PARAMETER`, `INVALID_DATA_ENCODING`, `QUERY_DATA_TOO_LARGE` e `URI_TOO_LONG`. Erros nunca ecoam `data`, bytes decodificados ou JSON recebido.

## Resposta

```json
{
  "id": "minha_tarefa",
  "version": 1,
  "created_at": "2026-07-12T22:32:19.374Z",
  "updated_at": "2026-07-12T22:32:19.374Z",
  "json": {
    "titulo": "Comprar café",
    "feito": false
  }
}
```

O corpo pode ser qualquer JSON válido: objeto, array, string, número, booleano ou `null`. `PUT /:id` substitui completamente o valor anterior. `PUT /:id/value` altera um único valor. Operações canônicas e aliases incrementam `version` em toda gravação aceita, mesmo quando o resultado não muda.

## Rotas

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Documentação HTML |
| `GET` | `/:id` | Consulta um item |
| `GET` | `/:id?method=GET` | Alias explícito de leitura |
| `GET` | `/:id?method=PUT&data=<JSON base64url>` | Cria ou substitui por alias de compatibilidade |
| `GET` | `/:id/value?method=PUT&path=<JSON Pointer>&data=<JSON base64url>` | Altera um valor por alias de compatibilidade |
| `GET` | `/:id?method=DELETE` | Apaga por alias de compatibilidade |
| `GET` | `/:id/version` | Consulta somente a versão |
| `PUT` | `/:id` | Cria ou substitui um item |
| `PUT` | `/:id/value?path=<JSON Pointer>` | Cria ou substitui um valor por caminho |
| `DELETE` | `/:id` | Apaga um item |

## Limites

- IDs: 1 a 100 letras ASCII, números, hífens ou sublinhados.
- Expressão válida: `^[A-Za-z0-9_-]{1,100}$`.
- Corpo máximo: `1.900.000` bytes em UTF-8.
- `data` via GET: `10.000` bytes UTF-8 decodificados, `13.334` caracteres codificados e URL absoluta mutante de `15.000` bytes.
- Resultado máximo de uma mutação por caminho: `1.900.000` bytes em UTF-8.
- JSON Pointer: até `4.096` bytes UTF-8 após decodificar a URL e `64` segmentos.
- Resultado de uma mutação por caminho: até `1.000` níveis aninhados de objetos e arrays, limite do JSON1. Um JSON mais profundo salvo por `PUT /:id` precisa ser substituído por um documento mais raso antes de aceitar atualizações por caminho.
- Rate limit: 30 requisições por IP a cada 10 segundos.
- Não há listagem, busca, expiração, histórico, remoção por caminho ou mutações múltiplas.

Erros da API incluem `error`, um `code` estável, `retryable`, `hint` e, quando útil, contexto limitado como `path`, `blocked_at`, `array_length` ou limites em bytes. Eles nunca incluem o documento armazenado, `data`, seus bytes decodificados ou o JSON recebido. Respostas usam `Cache-Control: no-store` quando aplicável e `Referrer-Policy: no-referrer`. Consulte a [documentação completa](https://kv.helio.me/) para a tabela normativa de códigos e próximas ações.

## Desenvolvimento

```bash
npm install
npm test
npm run dev
```

Para validar o bundle sem publicar:

```bash
npx wrangler deploy --dry-run
```

Para aplicar migrations e publicar:

```bash
npm run deploy
```
