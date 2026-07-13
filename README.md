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

O corpo pode ser qualquer JSON válido: objeto, array, string, número, booleano ou `null`. Um `PUT` substitui completamente o valor anterior e incrementa `version`.

## Rotas

| Método | Rota | Descrição |
| --- | --- | --- |
| `GET` | `/` | Documentação HTML |
| `GET` | `/:id` | Consulta um item |
| `GET` | `/:id/version` | Consulta somente a versão |
| `PUT` | `/:id` | Cria ou substitui um item |
| `DELETE` | `/:id` | Apaga um item |

## Limites

- IDs: 1 a 100 letras ASCII, números, hífens ou sublinhados.
- Expressão válida: `^[A-Za-z0-9_-]{1,100}$`.
- Payload máximo: `1.900.000` bytes em UTF-8.
- Rate limit: 30 requisições por IP a cada 10 segundos.
- Não há listagem, busca, expiração, histórico ou merge parcial.

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
