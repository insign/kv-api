# KV API

## Purpose

This project is a public JSON key-value API implemented as a Cloudflare Worker backed by Cloudflare D1 (SQLite). Despite the KV-style interface, it does not use a Cloudflare KV namespace.

The API intentionally has no authentication. Anyone who knows an ID can read, overwrite, or delete it. Do not add authentication unless explicitly requested.

## Production

- Official endpoint: `https://kv.helio.me`
- Do not use or restore `tasks-api.helio.me`; it is no longer attached to this Worker.
- `workers_dev` is disabled to prevent bypassing zone-level controls through a `workers.dev` hostname.
- Preview URLs are disabled.
- Worker name: `kv`.
- Cloudflare account: `Hélio` (`792cdd8dd982975da04155cf8b4d9403`).

The production route is declared in `wrangler.jsonc`, which is the source of truth. Route changes must be deployed through Wrangler and verified against both the new and removed hostnames.

## Project Layout

- `src/worker.js`: complete Worker request handler and API implementation.
- `src/json-path.js`: strict RFC 6901 parsing and set-by-path planning for SQLite JSON1.
- `src/docs.js`: static, responsive HTML documentation served by `GET /`.
- `migrations/`: ordered D1 migrations applied by Wrangler.
- `migrations/0001_add_timestamps.sql`: adds nullable `created_at` and `updated_at` metadata columns without backfilling existing rows.
- `test/worker.test.mjs`: Node test suite with a D1 mock.
- `test/json-path.test.mjs`: unit tests for JSON Pointer parsing, object paths, and array semantics.
- `wrangler.jsonc`: Worker route, D1 binding, account, compatibility date, and observability configuration.
- `package.json`: test, development, migration, and deployment commands.

## D1 Database

- Binding: `env.tasks`
- Database name: `tasks`
- Database ID: `1376a89a-924a-4ad9-8d42-683f4515baa1`
- Production region reported by D1: `ENAM`

Expected schema:

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
```

The original table predates tracked migrations and already contained `id`, `version`, and `json`. Migration `0001` only adds the timestamp columns. Existing rows intentionally keep `created_at` and `updated_at` as `NULL`; updating a legacy row sets `updated_at` but preserves its unknown `created_at` as `NULL`.

## API Contract

Supported routes:

| Method | Route | Behavior |
| --- | --- | --- |
| `GET` | `/` | Returns the complete HTML API documentation. |
| `GET` | `/:id` | Returns the item, version, timestamps, and JSON value. |
| `GET` | `/:id/version` | Returns only `{ id, version }`. |
| `PUT` | `/:id` | Creates or fully replaces the JSON value. |
| `PUT` | `/:id/value?path=<JSON Pointer>` | Creates or replaces one value addressed by RFC 6901 JSON Pointer. |
| `DELETE` | `/:id` | Deletes an existing item. |
| `OPTIONS` | Any path | Returns the CORS preflight response. |

Successful item responses have this shape:

```json
{
  "id": "example",
  "version": 2,
  "created_at": "2026-07-12T22:32:19.374Z",
  "updated_at": "2026-07-12T22:32:59.448Z",
  "json": {
    "any": "valid JSON value"
  }
}
```

Rules and invariants:

- IDs must match `^[A-Za-z0-9_-]{1,100}$`.
- The JSON body may be an object, array, string, number, boolean, or `null`.
- `PUT /:id` replaces the complete previous value; it does not merge objects.
- `PUT /:id/value` creates or replaces exactly one value and returns the complete updated item.
- New rows start at `version = 1`.
- Every successful update increments `version` atomically in D1.
- New rows receive equal `created_at` and `updated_at` values in UTC ISO 8601 format.
- Updates preserve `created_at` and set `updated_at` from SQLite's execution time.
- Deleting and recreating an ID resets its version to `1` and creates new timestamps.
- `GET /:id/version` intentionally does not return timestamps.
- Responses containing API JSON use `Cache-Control: no-store`.
- The documentation home also uses `Cache-Control: no-store` so deploys are visible immediately.
- CORS intentionally permits all origins.
- Unsupported methods return `405` with an `Allow` header.

For full replacements, the Worker validates JSON syntax but stores and embeds the original JSON text instead of parsing and reserializing it. This preserves valid numeric literals outside JavaScript's safe integer range, such as `9007199254740993` and `1e400`.

Set-by-path mutations necessarily pass through SQLite JSON1 and may normalize insignificant whitespace. The replacement body is bound to `json(?)` as its original validated text, and untouched extreme numeric literals must remain lexically unchanged.

## Set by JSON Pointer

`PUT /:id/value` requires exactly one `path` query parameter:

- `path` is decoded by `URLSearchParams` and then parsed as strict RFC 6901 JSON Pointer.
- The decoded pointer must start with `/`, use only `~0` and `~1` escapes, fit within `4,096` UTF-8 bytes, and contain at most `64` segments.
- The empty pointer (`path=`) targets the document root and is prohibited. Clients must use `PUT /:id` for full replacement.
- `path=/` is valid and targets an empty-string object key.
- A missing item starts from `{}`. Missing ancestors are always created as objects; numeric-looking tokens do not infer arrays.
- Every token under an object is a literal key, including `0`, `-`, and the empty string.
- Existing arrays accept only canonical non-negative integer tokens: `0` or a positive integer without leading zeros.
- An array index below its length replaces an element. An index equal to its length appends one element. Larger indices are rejected because gaps are forbidden.
- `/-` is rejected for arrays. There is no middle insertion or removal-by-path operation.
- A scalar or `null` leaf may be replaced. A scalar or `null` ancestor causes `PATH_TYPE_CONFLICT` and is never overwritten implicitly.
- Every accepted mutation increments `version`, including no-op values. It preserves `created_at`, updates `updated_at`, and returns the complete item envelope.
- Duplicate object keys make path selection ambiguous and are rejected until the client normalizes the document with `PUT /:id`.
- JSON Patch, JSON Merge Patch, multiple mutations, and `If-Match` preconditions are out of scope.

Structured API errors always include `error`, `code`, `retryable`, and `hint`. Context fields are code-specific and limited to actionable metadata; never include stored JSON in an error. Stable codes are `INVALID_ID`, `INVALID_ROUTE`, `ITEM_NOT_FOUND`, `METHOD_NOT_ALLOWED`, `INVALID_JSON`, `INVALID_UTF8`, `PAYLOAD_TOO_LARGE`, `MISSING_PATH_PARAMETER`, `DUPLICATE_PATH_PARAMETER`, `INVALID_JSON_POINTER`, `ROOT_PATH_NOT_ALLOWED`, `PATH_TOO_LONG`, `PATH_TOO_DEEP`, `PATH_TYPE_CONFLICT`, `INVALID_ARRAY_INDEX`, `ARRAY_INDEX_OUT_OF_BOUNDS`, `AMBIGUOUS_PATH`, `STORED_JSON_INVALID`, `WRITE_CONFLICT`, `RESULT_TOO_LARGE`, and `STORE_FAILED`. Only `WRITE_CONFLICT` is currently marked `retryable: true`.

## Payload Limit

The application limit is exactly `1,900,000` request-body bytes, measured from the UTF-8 stream. Requests over the limit return `413` and the Worker cancels further stream consumption.

The complete JSON result of `PUT /:id/value` has the same `1,900,000`-byte limit. An oversized result returns `422 RESULT_TOO_LARGE`; an oversized request body remains `413 PAYLOAD_TOO_LARGE`.

Do not raise this to 2 MiB or 2,000,000 bytes without changing the storage design. D1's documented maximum for a string, BLOB, or complete row is 2,000,000 bytes. The row also contains the ID, version, timestamps, and SQLite record overhead, so the JSON value needs safety margin. Supporting full 2 MiB payloads would require chunking across rows or moving values to R2.

## Concurrency

- Full-replacement `PUT /:id` uses a single `INSERT ... ON CONFLICT ... RETURNING` statement.
- `version = items.version + 1` is performed atomically by SQLite.
- Set-by-path updates use optimistic compare-and-swap against `id`, `version`, and the original raw `json` text, with at most three attempts.
- D1 `batch()` transactionally couples candidate-size validation and the conditional `UPDATE ... RETURNING`; the write predicate repeats the size check.
- Missing-item creation uses `INSERT ... ON CONFLICT DO NOTHING`, then retries if another writer created the ID first.
- Candidate sizing substitutes a small `json('null')` sentinel before adding the replacement byte length. This avoids creating an intermediate JSON value above D1's 2,000,000-byte per-value limit.
- `DELETE` uses `DELETE ... RETURNING` to avoid a separate existence-check race.
- `updated_at` may be identical for updates executed within the same millisecond. This is acceptable; `version`, not the timestamp, is the monotonic change indicator.

## WAF Rate Limiting

The `helio.me` zone is on the Cloudflare Free plan and has one active rate limiting rule:

- Match: URI path wildcard `/*`.
- Counting characteristic: source IP.
- Threshold: 30 requests per 10 seconds.
- Action: block.
- Mitigation timeout: 10 seconds.
- Default blocked response: HTTP `429`.

The Free plan does not provide the hostname matching needed to isolate this rule to `kv.helio.me`. The rule therefore applies across the entire `helio.me` zone. Do not add another rate limiting rule without checking plan capacity and the impact on existing hosts.

A controlled production check previously produced exactly 30 normal API responses followed by 10 responses with status `429`; requests recovered after the 10-second timeout.

## Commands

| Command | Purpose |
| --- | --- |
| `npm test` | Run the Node test suite. |
| `npm run dev` | Start local development with Wrangler. |
| `npx wrangler deploy --dry-run` | Validate bundling and configuration without publishing. |
| `npm run migrate` | Apply pending migrations to the remote D1 database. |
| `npm run deploy` | Apply remote migrations, then deploy the Worker. |
| `npx wrangler d1 execute tasks --remote --command "PRAGMA table_info(items)"` | Inspect the production schema. |

Always use `npm run deploy` for production. It applies D1 migrations before deploying code that depends on the new schema. Do not reverse this order.

## Verification

Before deployment:

1. Run `npm test`.
2. Run `npx wrangler deploy --dry-run`.
3. If a migration changed, apply it to a local D1 database before production.
4. Review `wrangler.jsonc` and confirm that only `kv.helio.me` is configured.

After deployment:

1. Confirm a missing ID on `https://kv.helio.me/:id` returns the expected JSON `404` with `Cache-Control: no-store`.
2. Create a unique temporary ID with `PUT` and verify version `1` with equal timestamps.
3. Update it and verify version increment, stable `created_at`, and changed `updated_at`.
4. Use `PUT /:id/value` on an object leaf and an array, then verify the complete response, version increments, stable `created_at`, and updated value.
5. Verify one safe structured error, such as a root path rejection, without touching unknown IDs.
6. Read `/:id/version`.
7. Delete the temporary ID and confirm a subsequent read returns `404`.
8. Confirm `tasks-api.helio.me` is not attached to the Worker.

Production smoke tests must use a unique valid ID and delete it at the end. Do not inspect, overwrite, or delete unknown existing IDs.

## Testing Notes

The test suite uses a JavaScript D1 mock. It covers the HTML documentation home, routing, CRUD behavior, set-by-pointer object and array semantics, strict pointer validation, structured conflicts, optimistic concurrency, versioning, legacy timestamps, ID validation, invalid JSON, invalid UTF-8, preservation of large numeric literals, body and result boundaries, CORS preflight, cache headers, and allowed methods.

Keep user-facing API documentation in `src/docs.js` synchronized with behavior changes. It must reference only `https://kv.helio.me`, clearly state that the API is public, and remain usable on desktop and mobile without external scripts, fonts, stylesheets, or assets.

The mock does not execute real SQLite. When SQL or JSON1 behavior changes, validate it with Wrangler's local D1 runtime before production. The set-by-pointer implementation additionally depends on JSON1 path behavior, preservation of extreme numeric literals, transactional `batch()`, and D1's transient value limit; keep the focused local D1 probe coverage aligned with these assumptions. Perform a cleaned-up production smoke test after deployment.

## Cloudflare Documentation

STOP. Cloudflare APIs, Wrangler commands, product limits, and plan features change frequently. Retrieve current official documentation before changing Workers, D1, WAF, bindings, routes, or limits.

- Workers: https://developers.cloudflare.com/workers/
- D1: https://developers.cloudflare.com/d1/
- D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- WAF rate limiting: https://developers.cloudflare.com/waf/rate-limiting-rules/
- Wrangler: https://developers.cloudflare.com/workers/wrangler/
- MCP: `https://docs.mcp.cloudflare.com/mcp`

Run `npx wrangler types` after changing bindings in `wrangler.jsonc`.

## Safety

- Never expose Cloudflare OAuth tokens, API tokens, or account credentials.
- Never commit `.dev.vars`, `.env`, Wrangler auth files, or secret-bearing temporary files.
- Do not mutate production D1 data except for explicit migrations and disposable smoke-test IDs.
- Do not enable `workers_dev` or preview URLs without explicit approval and equivalent protection.
- Do not treat CORS as authentication or access control.
- Do not assume WAF counters are globally exact; Cloudflare rate limiting is distributed and may be eventually consistent.
