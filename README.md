# KV API

API pública para armazenar qualquer valor JSON usando um identificador como chave.

- Endpoint: [https://kv.helio.me](https://kv.helio.me)
- Documentação completa: [https://kv.helio.me/](https://kv.helio.me/)
- Infraestrutura: Cloudflare Worker + D1 (SQLite)
- Autenticação: nenhuma

> A API é pública. Qualquer pessoa que conheça um identificador pode ler, substituir ou apagar seu conteúdo. Não armazene senhas, tokens, dados pessoais ou informações confidenciais.

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

O corpo pode ser qualquer JSON válido: objeto, array, string, número, booleano ou `null`. `PUT /:id` substitui completamente o valor anterior. `PUT /:id/value` altera um único valor. Ambos incrementam `version` em toda gravação aceita, mesmo quando o resultado não muda.

## Rotas

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Documentação HTML |
| `GET` | `/:id` | Consulta um item |
| `GET` | `/:id/version` | Consulta somente a versão |
| `PUT` | `/:id` | Cria ou substitui um item |
| `PUT` | `/:id/value?path=<JSON Pointer>` | Cria ou substitui um valor por caminho |
| `DELETE` | `/:id` | Apaga um item |

## Limites

- IDs: 1 a 100 letras ASCII, números, hífens ou sublinhados.
- Expressão válida: `^[A-Za-z0-9_-]{1,100}$`.
- Corpo máximo: `1.900.000` bytes em UTF-8.
- Resultado máximo de uma mutação por caminho: `1.900.000` bytes em UTF-8.
- JSON Pointer: até `4.096` bytes UTF-8 após decodificar a URL e `64` segmentos.
- Rate limit: 30 requisições por IP a cada 10 segundos.
- Não há listagem, busca, expiração, histórico, remoção por caminho ou mutações múltiplas.

Erros da API incluem `error`, um `code` estável, `retryable`, `hint` e, quando útil, contexto limitado como `path`, `blocked_at`, `array_length` ou limites em bytes. Consulte a [documentação completa](https://kv.helio.me/) para a tabela normativa de códigos e próximas ações.

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
