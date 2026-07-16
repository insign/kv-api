# Authoritative Execution Plan — Set a JSON Value by Path

## Status

**Ready.** Execute the mandatory D1 characterization gate in Step 1 before changing application behavior. If any required D1 invariant fails, stop without exposing the endpoint and report the failed query as a blocker; do not weaken numeric preservation, path correctness, or atomicity to continue.

## Problem

The API currently supports only complete JSON replacement through `PUT /:id`. Clients that need to create or change one nested value must read the complete document, modify it, and send the entire document back. That is inefficient and can overwrite unrelated concurrent changes.

Add one focused operation that creates or replaces a single value addressed by JSON Pointer while retaining the existing full-replacement operation. The new operation must create missing object ancestors like `mkdir -p`, create an absent item from `{}`, remain safe for arrays, preserve the API's lossless handling of numeric literals such as `9007199254740993` and `1e400`, update versions and timestamps correctly, and return errors detailed enough for an LLM agent to correct its request without guessing.

## Objective

Deliver this contract:

```http
PUT /:id/value?path=<JSON Pointer>
Content-Type: application/json

<one raw JSON value>
```

The operation must:

- preserve `PUT /:id` as create-or-replace-the-complete-document;
- set exactly one JSON value at the supplied pointer;
- create a missing item from `{}` and create missing object ancestors;
- replace an existing target leaf, including a scalar or `null`;
- reject traversal through an incompatible scalar or `null`;
- address existing arrays with explicit canonical numeric indices without creating gaps;
- commit each successful mutation with one atomic compare-and-swap database write;
- enforce a maximum final stored JSON size of exactly `1,900,000` UTF-8 bytes;
- preserve untouched large numeric literals exactly;
- return the complete updated item envelope;
- expose stable machine-readable error codes, actionable hints, and relevant correction context;
- document the complete behavior in the HTML documentation served by `GET /`.

## Current Project Context

- Runtime: Cloudflare Worker.
- Persistence: Cloudflare D1/SQLite through binding `env.tasks`.
- Production endpoint: `https://kv.helio.me`.
- The API is intentionally public and unauthenticated. Do not add authentication.
- Worker implementation: `src/worker.js`.
- HTML documentation served by `GET /`: `src/docs.js`.
- Unit tests and JavaScript D1 mock: `test/worker.test.mjs`.
- Public repository documentation: `README.md`.
- Project contract and operational guidance: `AGENTS.md`.
- Worker/D1 configuration: `wrangler.jsonc`.
- Existing schema:

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0,
  json TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);
```

- No schema migration is required.
- IDs must continue matching `^[A-Za-z0-9_-]{1,100}$`.
- The existing body limit is exactly `1,900,000` UTF-8 bytes.
- New items start at version `1` with equal `created_at` and `updated_at` values.
- Existing-item writes increment `version`, preserve `created_at`, and update `updated_at` from SQLite time.
- Legacy rows may retain `created_at = NULL`.
- Every API JSON response uses `Cache-Control: no-store`.
- CORS intentionally permits all origins.
- `workers_dev` and preview URLs must remain disabled.
- The only production hostname is `kv.helio.me`; never restore `tasks-api.helio.me`.
- The current Worker validates JSON syntax but stores the original JSON text rather than serializing a JavaScript value. This preserves numeric literals outside JavaScript's safe range.
- Local read-only SQLite 3.53.1 characterization established these expected behaviors, which must still be verified against the actual D1 runtime:
  - `json_set('{}', '$."a"."b"', json('1'))` produces `{"a":{"b":1}}`.
  - Traversing through a scalar leaves the document unchanged rather than replacing the scalar.
  - Updating another member preserved `9007199254740993` and `1e400` exactly.
  - Setting array index equal to array length appended the value.
  - Setting an index greater than array length left the array unchanged.
  - Quoted SQLite JSON-path labels handled empty keys, Unicode, dots, brackets, slashes, tildes, quotes, and backslashes.
  - Duplicate object members remained ambiguous; SQLite updated only one matching occurrence. Path writes must therefore reject duplicate-member documents.

## Decisions Resolved

1. **Keep two visibly separate operations.** Use `PUT /:id` for complete replacement and `PUT /:id/value?path=...` for one-value set/upsert. Do not overload `PUT /:id` based on the presence of a query parameter.
2. **Use JSON Pointer for the public path syntax.** Do not expose SQLite's private `$...` path syntax.
3. **Use a raw JSON body.** Do not wrap the value in `{ "path": ..., "value": ... }`; this avoids unnecessary parsing and preserves raw numeric literals.
4. **Create absent items from an object.** A missing ID starts from `{}`. Missing ancestors are always objects; never infer an array from a numeric-looking token.
5. **Preserve object semantics.** Under an object, every decoded pointer token is a property name, including `"0"`, `"-"`, and the empty string.
6. **Use explicit idempotent array indices.** Under an existing array of length `N`, indices `0..N-1` address existing elements and index `N` appends. Reject index greater than `N`. Accept only `0` or `[1-9][0-9]*` as an array index.
7. **Do not support `/-` append semantics.** A retry of append-by-`-` would duplicate data and violate `PUT` idempotence. Under an array, `-` is invalid. Under an object, `-` remains an ordinary property name.
8. **Disallow only the root pointer.** An empty decoded pointer (`path=`) targets the complete document and must return `ROOT_PATH_NOT_ALLOWED`. The pointer `/` is valid and addresses an object member whose name is the empty string.
9. **Do not overwrite blockers.** If a non-final ancestor is a scalar or `null`, return `409 PATH_TYPE_CONFLICT`. A scalar or `null` at the final target may be replaced normally.
10. **Reject ambiguous documents for path writes.** If the stored document contains duplicate object member names anywhere, return `409 AMBIGUOUS_PATH` and direct the client to normalize the document through full `PUT /:id`.
11. **Preserve numeric literals, not whitespace.** A path write may minify insignificant whitespace, but it must preserve the exact text of untouched numeric literals, including `9007199254740993` and `1e400`. Full `PUT /:id` must continue preserving the original request text.
12. **Use optimistic compare-and-swap.** Read the current row and version, compute the path against that representation, and perform the update only with `WHERE id = ? AND version = ?`. Retry the complete read/plan/write cycle at most three times when another write wins the race.
13. **Keep last-write-wins at the public API level.** Do not add ETags or `If-Match` in this delivery. The server-side version compare-and-swap exists to make its own path mutation safe, not to expose client preconditions.
14. **Increment versions for accepted no-ops.** Every successful write increments `version`, even when the resulting JSON value is semantically unchanged, matching current `PUT` behavior.
15. **Return the complete item.** Do not add `Prefer: return=minimal` or a second response mode in this delivery.
16. **Apply structured errors API-wide.** Preserve the existing top-level human-readable `error` string and add `code`, `retryable`, `hint`, and relevant context to existing and new errors. Adding fields is backward-compatible for JSON clients.
17. **Use separate size errors.** Return `413 PAYLOAD_TOO_LARGE` when the request body exceeds the input limit and `422 RESULT_TOO_LARGE` when the computed complete document exceeds the storage limit.
18. **Do not deploy automatically.** Implementation, tests, documentation, and dry-run validation are in scope. Production deployment requires separate explicit confirmation immediately before `npm run deploy`.

## Why This Plan

- It preserves the minimal character of the API: one endpoint replaces everything and one endpoint sets one value.
- It avoids the recursive merge, deletion-by-`null`, and whole-array replacement surprises of JSON Merge Patch.
- It avoids the multi-operation complexity of JSON Patch.
- Explicit numeric array indices retain `PUT` idempotence while still permitting append at the known current length.
- JSON Pointer provides a recognizable path notation without exposing D1 implementation details.
- D1 performs the actual JSON mutation, preserving numeric lexemes and avoiding JavaScript reserialization of the stored document.
- Compare-and-swap prevents a read/modify/write race from silently overwriting a newer row.
- Structured errors turn every deterministic failure into a concrete correction path for both humans and automated agents.

## Execution Plan (Synthesized)

### Step 0 — Initialize durable execution state

- **Files:** `final_plan.md`, Git history only.
- **Actions:**
  1. Read `AGENTS.md` and this file before editing.
  2. Inspect `git status`, the recent log, and the latest `AGENT_PLAN_ANCHOR`.
  3. If this plan is being executed, create the mandatory immutable `plan:` commit containing `AGENT_PLAN_ANCHOR` and the complete execution sequence before changing application code.
  4. Execute each major step as its own `chore(agent): [Step X/Y] ...` progress commit with `PLAN_REF` and `PREVIOUS_STEP`, following `AGENTS.md`.
  5. Do not commit secrets, `.env`, `.dev.vars`, Wrangler credentials, or temporary D1 files.
- **Risk:** Low.
- **Validation:** `git show <PLAN_HASH>` must be sufficient for a new executor to recover the complete plan.

### Step 1 — Prove actual D1 JSON behavior before implementation

- **Files:** No project file changes.
- **Actions:**
  1. Retrieve the current official Cloudflare D1 JSON-function, Worker binding, batch, and limits documentation before running Wrangler commands:
     - `https://developers.cloudflare.com/llms.txt`
     - `https://developers.cloudflare.com/d1/sql-api/query-json/`
     - `https://developers.cloudflare.com/d1/worker-api/d1-database/`
     - `https://developers.cloudflare.com/d1/platform/limits/`
  2. Run read-only `SELECT` statements against the actual D1 runtime with `npx wrangler d1 execute tasks --remote --command "<SELECT statements>"`. Do not mutate tables or production rows.
  3. Verify all of the following exact expressions and expectations:

```sql
SELECT sqlite_version() AS sqlite_version;

SELECT json_set('{}', '$."a"."b"', json('1')) AS value;
-- Expected: {"a":{"b":1}}

SELECT json_set('{"a":"x"}', '$."a"."b"', json('1')) AS value;
-- Expected: {"a":"x"}; the scalar must not be silently replaced.

SELECT json_set(
  '{"n":9007199254740993,"e":1e400,"x":1}',
  '$."x"',
  json('2')
) AS value;
-- Expected exact numeric text: {"n":9007199254740993,"e":1e400,"x":2}

SELECT json_set('[1]', '$[1]', json('2')) AS value;
-- Expected: [1,2]

SELECT json_set('[1]', '$[3]', json('2')) AS value;
-- Expected: [1]

SELECT json_set('{}', '$."a.b"."a/b"."a~b"."a\"b"', json('1')) AS value;
-- Expected nested keys preserving every decoded property name.

SELECT length(CAST(json_set('{}', '$."é"', json('1')) AS BLOB)) AS utf8_bytes;
-- Confirm BLOB length counts UTF-8 bytes for the final JSON text.
```

  4. Confirm current D1 `batch()` transaction behavior and the result shape of `UPDATE ... RETURNING` from official docs and a disposable local/temporary test before relying on it.
  5. Record the results in the Step 1 progress commit, not in a new persistent status file.
- **Blocking rule:** If numeric literals change, quoted labels fail, final bytes cannot be measured, or transactional batch/`RETURNING` behavior is unavailable, stop. Do not expose the endpoint and do not fall back to `JSON.parse()`/`JSON.stringify()`. Report the exact failed invariant and redesign around a lossless JSON token editor plus conditional D1 writes in a new approved plan.
- **Risk:** Critical; this gate protects stored data correctness.
- **Validation:** Every expected output above matches exactly in the actual D1 runtime.

### Step 2 — Add pure JSON Pointer parsing and path-planning logic

- **Files:** Create `src/json-path.js`; create `test/json-path.test.mjs`.
- **Actions:**
  1. Export these constants from `src/json-path.js`:

```js
export const MAX_POINTER_BYTES = 4096;
export const MAX_POINTER_SEGMENTS = 64;
```

  2. Add a small typed-by-convention error class or result object carrying `code`, `message`, `hint`, and `details`; do not construct HTTP responses in this module.
  3. Implement `parseJsonPointer(searchParams)` with these exact rules:
     - call `searchParams.getAll("path")`;
     - zero values → `MISSING_PATH_PARAMETER`;
     - more than one value → `DUPLICATE_PATH_PARAMETER`;
     - an empty value → `ROOT_PATH_NOT_ALLOWED`;
     - require the decoded pointer to start with `/`, otherwise `INVALID_JSON_POINTER`;
     - measure `new TextEncoder().encode(pointer).byteLength`; more than `4096` → `PATH_TOO_LONG`;
     - split on `/` after removing the first `/`;
     - more than `64` tokens → `PATH_TOO_DEEP`;
     - reject any `~` not followed by `0` or `1`;
     - decode each token by replacing `~1` with `/` and then `~0` with `~`;
     - preserve empty tokens, Unicode, `-`, numeric-looking strings, dots, brackets, quotes, and backslashes exactly.
  4. Implement `sqliteObjectSegment(token)` as `.${JSON.stringify(token)}`. Never concatenate an unquoted token into SQLite JSON-path syntax.
  5. Implement `planJsonSetPath(currentValue, tokens)` without mutating `currentValue`:
     - if the current root is `null` or a scalar, return `PATH_TYPE_CONFLICT` at the root;
     - when the parent is an object, treat the token as a literal property name;
     - use `Object.hasOwn(parent, token)`, never prototype-chain lookup;
     - if an object member is missing, append that quoted object segment and append all remaining tokens as quoted object segments; report that the path will create an object chain;
     - if an existing non-final child is an object or array, continue;
     - if an existing non-final child is scalar or `null`, return `PATH_TYPE_CONFLICT` with `blocked_at`, `actual_type`, and `required_type`;
     - if the parent is an array, require `^(0|[1-9][0-9]*)$`; otherwise return `INVALID_ARRAY_INDEX`;
     - reject indices larger than `Number.MAX_SAFE_INTEGER` before conversion;
     - index `< length` addresses the existing element;
     - index `=== length` appends; if more tokens remain, append a new object and treat every remaining token as an object key;
     - index `> length` returns `ARRAY_INDEX_OUT_OF_BOUNDS` with `index` and `array_length`;
     - never assign special append meaning to `-` under arrays.
  6. Return the fully quoted SQLite JSON path plus any structured conflict information. Do not return an interpolated SQL statement.
  7. Cover the parser and planner with unit tests for:
     - `/perfil/tema`;
     - `/` as an empty property key;
     - `path=` as forbidden root;
     - `~0`, `~1`, and malformed `~2`;
     - Unicode and keys containing `.`, `[`, `]`, `/`, `~`, quotes, and backslashes;
     - duplicate query parameters;
     - pointer byte/depth limits;
     - missing object chains;
     - numeric-looking object keys;
     - existing arrays, index equal to length, gaps, leading zeros, negative indices, huge indices, and `-`;
     - scalar/null blockers versus scalar/null final targets.
- **Risk:** High; incorrect conversion can update the wrong property.
- **Validation:** `node --test test/json-path.test.mjs` passes and every generated SQLite path is bound as data, not interpolated into SQL.

### Step 3 — Add an API-wide structured error contract

- **Files:** `src/worker.js`, `test/worker.test.mjs`.
- **Actions:**
  1. Add one response helper that always returns this additive shape:

```json
{
  "error": "Mensagem humana específica em português.",
  "code": "STABLE_UPPERCASE_CODE",
  "retryable": false,
  "hint": "Ação concreta para corrigir ou verificar a requisição."
}
```

  2. Merge only bounded, non-secret context fields into the response. Never echo the full request body or stored JSON.
  3. Convert existing deterministic errors to these codes while retaining their current statuses:
     - `INVALID_ID` → `400`;
     - `INVALID_ROUTE` → `404`;
     - `ITEM_NOT_FOUND` → `404`;
     - `METHOD_NOT_ALLOWED` → `405` and preserve the correct `Allow` header;
     - `INVALID_JSON` → `400`;
     - `INVALID_UTF8` → `400`;
     - `PAYLOAD_TOO_LARGE` → `413` with `max_bytes: 1900000`;
     - `STORE_FAILED` → `500` with `retryable: false` and a hint to `GET /:id` before retrying because commit state may be uncertain.
  4. Add the new-route codes and exact statuses:
     - `MISSING_PATH_PARAMETER` → `400`;
     - `DUPLICATE_PATH_PARAMETER` → `400`;
     - `INVALID_JSON_POINTER` → `400`;
     - `ROOT_PATH_NOT_ALLOWED` → `400`;
     - `PATH_TOO_LONG` → `414`;
     - `PATH_TOO_DEEP` → `400`;
     - `PATH_TYPE_CONFLICT` → `409`;
     - `INVALID_ARRAY_INDEX` → `409`;
     - `ARRAY_INDEX_OUT_OF_BOUNDS` → `409`;
     - `AMBIGUOUS_PATH` → `409`;
     - `STORED_JSON_INVALID` → `409`;
     - `WRITE_CONFLICT` → `409`, only after three internal compare-and-swap retries, with `retryable: true`;
     - `RESULT_TOO_LARGE` → `422` with `result_bytes` and `max_bytes: 1900000`.
  5. Distinguish UTF-8 decoding from JSON syntax validation so `INVALID_UTF8` and `INVALID_JSON` cannot collapse into one catch block.
  6. Add tests asserting `error`, `code`, `retryable`, `hint`, status, contextual fields, cache headers, and `Allow` headers.
- **Risk:** Medium; clients may inspect current human-readable messages. Preserve current message meaning while adding stable fields.
- **Validation:** Every intentional API error returns the documented structure and no response contains request-body content.

### Step 4 — Implement safe row inspection, ambiguity rejection, and compare-and-swap persistence

- **Files:** `src/worker.js`, `test/worker.test.mjs`.
- **Actions:**
  1. Add a row-inspection query that returns the item metadata and raw JSON while determining validity and duplicate object members:

```sql
SELECT
  id,
  version,
  json,
  created_at,
  updated_at,
  json_valid(json) AS is_valid_json,
  CASE
    WHEN json_valid(json) THEN EXISTS (
      SELECT 1
      FROM json_tree(items.json) AS node
      WHERE typeof(node.key) = 'text'
      GROUP BY node.parent, node.key
      HAVING COUNT(*) > 1
    )
    ELSE 0
  END AS has_duplicate_keys
FROM items
WHERE id = ?
LIMIT 1
```

  2. Verify this exact query against D1 during Step 1. If D1 requires a syntactic adjustment, preserve the same semantics and record the verified query in the progress commit.
  3. For an existing row:
     - return `STORED_JSON_INVALID` if `is_valid_json` is false;
     - return `AMBIGUOUS_PATH` if `has_duplicate_keys` is true;
     - call `JSON.parse(row.json)` only to inspect container types and property existence;
     - never serialize that parsed object or use it as the value written to D1;
     - create the SQLite path with `planJsonSetPath`.
  4. Compute the candidate and write it with a compare-and-swap condition. Use `env.tasks.batch()` so candidate byte measurement and update execute in one D1 transaction. Bind the SQLite path and raw replacement JSON as parameters.
  5. The candidate-size statement must use:

```sql
SELECT
  version,
  length(CAST(json_set(json, ?, json(?)) AS BLOB)) AS result_bytes
FROM items
WHERE id = ? AND version = ?
```

  6. The update statement must use the same path, replacement, ID, and expected version:

```sql
UPDATE items
SET
  json = json_set(json, ?, json(?)),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?
  AND version = ?
  AND length(CAST(json_set(json, ?, json(?)) AS BLOB)) <= 1900000
RETURNING id, version, json, created_at, updated_at
```

  7. Interpret the batch atomically:
     - no candidate row means the version changed; restart from row inspection;
     - `result_bytes > 1900000` means return `422 RESULT_TOO_LARGE` without modifying the row;
     - a returned update row means success;
     - candidate within limit but no update row inside the same transaction means `STORE_FAILED`.
  8. For an absent row:
     - treat every pointer token as an object key;
     - build the SQLite path from quoted object segments only;
     - compute `length(CAST(json_set('{}', ?, json(?)) AS BLOB))`;
     - return `RESULT_TOO_LARGE` if it exceeds `1900000`;
     - insert with version `1`, equal timestamps, and `ON CONFLICT(id) DO NOTHING RETURNING ...`;
     - if another request created the ID first, restart from row inspection.
  9. Retry the complete operation at most three times. Return `WRITE_CONFLICT` after the third compare-and-swap conflict.
  10. Ensure failed pointer validation, type conflict, ambiguity, size rejection, and compare-and-swap conflicts never increment version or change timestamps.
  11. Preserve legacy `created_at = NULL` on updates.
  12. Update the D1 mock to model row inspection, item creation, compare-and-swap updates, candidate-size rejection, version conflicts, and `batch()` result shapes. Use ordinary JSON values in mock-only mutation tests; rely on the real D1 characterization for numeric-lexeme guarantees.
- **Risk:** Critical; persistence bugs can corrupt public data or lose concurrent updates.
- **Validation:** Unit tests prove version/timestamp behavior and synthetic concurrency conflicts; actual D1 tests prove SQL behavior and numeric preservation.

### Step 5 — Add the route without changing full `PUT`

- **Files:** `src/worker.js`.
- **Actions:**
  1. Import the pointer parser and path planner from `src/json-path.js`.
  2. Add an explicit two-segment route for `parts.length === 2 && parts[1] === "value"`.
  3. Validate `parts[0]` with the existing ID grammar.
  4. Accept only `PUT` and `OPTIONS` for this route. Other methods return `405 METHOD_NOT_ALLOWED` with `Allow: PUT, OPTIONS`.
  5. Parse and validate the `path` query parameter before reading the body.
  6. Reuse the existing streaming body limit but decode UTF-8 and validate JSON in separate error branches.
  7. Pass the original decoded body text, not the parsed JavaScript value, to D1 as the replacement.
  8. Return the existing complete item envelope via `itemJson` after creation or update.
  9. Preserve `Cache-Control: no-store`, CORS, CSP, and all existing routes.
  10. Keep the global CORS allowed methods as `GET, PUT, DELETE, OPTIONS`; no new HTTP method is introduced.
  11. Ensure `GET /:id/value`, `DELETE /:id/value`, and unsupported methods produce a known-route `405`, not a generic `404`.
- **Risk:** Medium; route ordering can shadow `/:id/version` or generic routes.
- **Validation:** Existing route tests remain green and new route/method tests pass.

### Step 6 — Cover the complete behavioral contract

- **Files:** `test/worker.test.mjs`, `test/json-path.test.mjs`.
- **Actions:** Add tests for all of the following:
  1. Existing `PUT /:id` still stores and returns complete objects, arrays, scalars, booleans, `null`, `9007199254740993`, and `1e400` unchanged.
  2. A missing ID plus `/preferencias/notificacoes/email` creates nested objects, version `1`, and equal timestamps.
  3. A missing numeric-looking path `/items/0/name` creates object keys, not an inferred array.
  4. An existing object leaf is replaced and unrelated members remain unchanged.
  5. A missing object leaf and multiple missing ancestors are created.
  6. A final scalar or `null` is replaceable.
  7. An intermediate scalar or `null` returns `PATH_TYPE_CONFLICT` with `blocked_at`, `actual_type`, and an actionable hint.
  8. Existing array index replacement works without shifting elements.
  9. Index equal to array length appends once; repeating the same request replaces that same index rather than appending again.
  10. Array gaps, negative indices, leading-zero indices, unsafe huge indices, and `-` return the correct array errors.
  11. `/` sets an empty object-member name while `path=` returns `ROOT_PATH_NOT_ALLOWED`.
  12. `~0`, `~1`, Unicode, quotes, backslashes, dots, brackets, `#`, `%`, and `+` reach the intended property after correct URL encoding.
  13. Missing, duplicate, malformed, overlong, and over-deep pointers return the exact documented errors.
  14. Invalid UTF-8 and invalid JSON remain distinct.
  15. Duplicate object member documents return `AMBIGUOUS_PATH` without mutation.
  16. Invalid legacy JSON returns `STORED_JSON_INVALID` without mutation.
  17. A request body at `1,900,000` bytes remains accepted when the final result fits.
  18. A body over the limit returns `PAYLOAD_TOO_LARGE` and cancels stream consumption.
  19. A small body that would make the final document exceed `1,900,000` bytes returns `RESULT_TOO_LARGE` with exact byte counts and leaves version/timestamps unchanged.
  20. Successful no-op writes increment version.
  21. Compare-and-swap conflict retries use the latest row, preserve unrelated concurrent changes, and increment the version exactly once for the successful mutation.
  22. Three consecutive conflicts return `WRITE_CONFLICT`.
  23. Legacy null `created_at` remains null after path update.
  24. CORS, `Allow`, `Cache-Control`, CSP, root docs, and all prior CRUD behavior remain unchanged except for additive error fields.
- **Risk:** Medium; the JavaScript mock cannot prove SQLite behavior.
- **Validation:** `npm test` passes, and Step 1's actual-D1 characterization remains a mandatory independent gate.

### Step 7 — Update the documentation served by `GET /`

- **Files:** `src/docs.js`, `README.md`, `AGENTS.md`, `test/worker.test.mjs`.
- **Actions:**
  1. Add `PUT /:id/value?path=<JSON Pointer>` to the endpoint table in `src/docs.js` and `README.md`.
  2. Add a dedicated “Atualizar um valor por caminho” section to `GET /` with copyable examples:

```bash
curl -X PUT \
  "https://kv.helio.me/config/value?path=%2Finterface%2Ftema" \
  -H "Content-Type: application/json" \
  -d '"escuro"'
```

```bash
curl -X PUT \
  "https://kv.helio.me/config/value?path=%2Fpreferencias%2Fnotificacoes%2Femail" \
  -H "Content-Type: application/json" \
  -d 'true'
```

  3. Explain that a missing item starts from `{}`, missing ancestors become objects, and numeric-looking tokens under missing objects remain object keys.
  4. Explain object keys, arrays, index-equal-length append, gap rejection, no `/-`, final `null` replacement, and intermediate-type conflicts.
  5. Explain JSON Pointer escaping (`~0`, `~1`) and URL encoding order. Recommend `URLSearchParams` in JavaScript clients.
  6. Explain that `path=` is forbidden root while `/` addresses an empty key.
  7. Publish the `409`, `413`, `414`, and `422` behaviors and a normative table containing every stable error code, HTTP status, required context fields, retryability, and corrective action.
  8. Add examples of `PATH_TYPE_CONFLICT`, `ARRAY_INDEX_OUT_OF_BOUNDS`, and `RESULT_TOO_LARGE` responses.
  9. State that path writes may normalize insignificant whitespace but preserve untouched numeric literals; complete `PUT` continues preserving raw JSON text.
  10. State that every successful path write increments version and returns the complete item.
  11. State the path limits: `4096` decoded UTF-8 bytes and `64` segments.
  12. State that path deletion, multi-path mutation, JSON Patch, JSON Merge Patch, insertion in the middle of arrays, and client `If-Match` preconditions are not supported.
  13. Keep the public/no-auth warning prominent and reference only `https://kv.helio.me`.
  14. Keep the HTML self-contained with no external scripts, fonts, stylesheets, images, or assets.
  15. Update `AGENTS.md` route tables, API invariants, concurrency notes, payload/result limits, errors, commands, and verification checklist.
  16. Extend the documentation test to assert the new route, representative example, JSON Pointer rules, structured error codes, and absence of `tasks-api.helio.me`.
- **Risk:** Low.
- **Validation:** Root documentation tests pass and manual desktop/mobile inspection confirms readable responsive output.

### Step 8 — Validate, review, and prepare delivery

- **Files:** All changed files; no unrelated files.
- **Actions:**
  1. Run targeted tests during each implementation step.
  2. Run the complete suite:

```bash
npm test
```

  3. Validate the Worker bundle and configuration without publishing:

```bash
npx wrangler deploy --dry-run
```

  4. Confirm `wrangler.jsonc` still contains only `kv.helio.me`, with `workers_dev: false` and `preview_urls: false`.
  5. Run the mandatory Reviewer Loop from `AGENTS.md` after implementation and tests. Send every reviewer the same objective, complete diff/commits, relevant files, invariants, and test evidence. Apply only technically valid findings, rerun tests, and repeat review until no judge-approved corrections remain.
  6. Run `make precommit` only if a `Makefile` providing it exists at execution time; otherwise record that it is unavailable. Do not invent a replacement command.
  7. Do not deploy without separate explicit confirmation.
  8. If deployment is later authorized, retrieve current Wrangler/D1 documentation, show the exact target and command, obtain the required final Cloudflare confirmation, and run:

```bash
npm run deploy
```

  9. After an authorized deployment, use a unique valid disposable ID and verify:
     - creation through `PUT /:id/value` from a missing ID;
     - recursive object creation;
     - existing-leaf replacement;
     - array index replacement and index-equal-length append;
     - structured conflict and validation errors;
     - version increments and timestamp preservation;
     - `GET /:id/version`;
     - final deletion and subsequent `404`;
     - `tasks-api.helio.me` remains detached.
  10. Never inspect, overwrite, or delete unknown production IDs.
- **Risk:** High only if production deployment is authorized; otherwise low.
- **Validation:** Tests pass, dry-run succeeds, reviewers report no accepted unresolved findings, and any authorized production smoke test cleans up its ID.

## Error Contract Reference

Every error must include `error`, `code`, `retryable`, and `hint`. Include only the listed context when relevant.

| Code | HTTP | Retryable | Required context/action |
| --- | ---: | :---: | --- |
| `INVALID_ID` | 400 | false | `id`, allowed ID grammar |
| `MISSING_PATH_PARAMETER` | 400 | false | Tell client to provide exactly one `path` |
| `DUPLICATE_PATH_PARAMETER` | 400 | false | `path_count`; tell client to send one |
| `INVALID_JSON_POINTER` | 400 | false | `path`, reason, valid escaping hint |
| `ROOT_PATH_NOT_ALLOWED` | 400 | false | Tell client to use `PUT /:id` |
| `PATH_TOO_LONG` | 414 | false | `path_bytes`, `max_path_bytes: 4096` |
| `PATH_TOO_DEEP` | 400 | false | `segments`, `max_segments: 64` |
| `INVALID_UTF8` | 400 | false | Tell client to encode body as UTF-8 |
| `INVALID_JSON` | 400 | false | Tell client to send one valid JSON value |
| `PATH_TYPE_CONFLICT` | 409 | false | `path`, `blocked_at`, `actual_type`, `required_type`; tell client to set blocker to an object first or use full PUT |
| `INVALID_ARRAY_INDEX` | 409 | false | `path`, invalid token, accepted grammar |
| `ARRAY_INDEX_OUT_OF_BOUNDS` | 409 | false | `path`, `index`, `array_length`; tell client to use `0..array_length` |
| `AMBIGUOUS_PATH` | 409 | false | Tell client to normalize duplicate keys with full PUT |
| `STORED_JSON_INVALID` | 409 | false | Tell client to replace the complete item with valid JSON |
| `WRITE_CONFLICT` | 409 | true | Tell client to retry after refetching current version |
| `PAYLOAD_TOO_LARGE` | 413 | false | `received_bytes` when known, `max_bytes: 1900000` |
| `RESULT_TOO_LARGE` | 422 | false | `result_bytes`, `max_bytes: 1900000`; tell client to reduce/remove data with full PUT |
| `ITEM_NOT_FOUND` | 404 | false | `id` |
| `INVALID_ROUTE` | 404 | false | Requested path only |
| `METHOD_NOT_ALLOWED` | 405 | false | Correct `Allow` header and allowed methods |
| `STORE_FAILED` | 500 | false | Tell client to `GET /:id` before deciding whether to retry |

## Risks & Mitigations

### Critical — D1 JSON functions alter numeric literals

- **Risk:** A path write could change untouched values such as `1e400` or `9007199254740993`.
- **Mitigation:** Step 1 is a blocking actual-D1 characterization gate. Bind the raw replacement through `json(?)`; never serialize the stored document in JavaScript.

### Critical — Lost updates during read/modify/write

- **Risk:** A row can change after its type/path plan is computed.
- **Mitigation:** Update only with the inspected `version`, use D1 transaction/batch for candidate measurement and update, and retry the entire operation at most three times.

### High — Wrong property from path conversion

- **Risk:** Special characters or numeric-looking keys could be interpreted as SQLite syntax.
- **Mitigation:** Decode RFC 6901 strictly, quote every object token with `JSON.stringify`, bind the complete SQLite path as a SQL parameter, and test all special characters.

### High — Ambiguous duplicate object keys

- **Risk:** SQLite may update only one duplicate member and clients cannot identify which member JSON Pointer means.
- **Mitigation:** Reject path writes for any stored document containing duplicate object keys and direct clients to normalize through full PUT.

### High — Final row exceeds D1 limits

- **Risk:** A small replacement can expand a near-limit document beyond D1's string/row limit.
- **Mitigation:** Measure `length(CAST(candidate AS BLOB))` and enforce `1,900,000` bytes inside the transactional write decision.

### Medium — URL query decoding surprises clients

- **Risk:** `+`, `#`, `%`, `/`, and `~` can be misencoded.
- **Mitigation:** Require one URL decode followed by RFC 6901 decode, document `URLSearchParams`, and return precise pointer errors.

### Medium — Request/response amplification

- **Risk:** A tiny public request may rewrite and return a document near 1.9 MB.
- **Mitigation:** Keep existing WAF limits, bound pointer depth/length, enforce body/result limits, benchmark near-limit documents, and retain one response mode for simplicity.

### Medium — API-wide error additions regress existing behavior

- **Risk:** Existing tests or clients may rely on message/status details.
- **Mitigation:** Preserve statuses and human meaning; add fields rather than removing or nesting the current `error` string.

## Assumptions to Validate

1. **Actual D1 preserves untouched large-number lexemes through `json_set`.**
   - Validation: Run Step 1's exact D1 query.
   - If false: Stop with `Status: Blocked`; do not implement the endpoint until a separate lossless token-editing design is approved.
2. **Actual D1 supports quoted JSON-path object labels for all supported JSON Pointer tokens.**
   - Validation: Run special-key queries for empty, Unicode, dot, brackets, slash, tilde, quote, and backslash labels.
   - If false: Stop with `Status: Blocked`; do not silently restrict keys without explicit product approval.
3. **D1 `batch()` executes candidate measurement and update transactionally and returns `UPDATE ... RETURNING` rows.**
   - Validation: Confirm current official docs and a disposable local D1 test.
   - If false: Stop with `Status: Blocked`; redesign the compare-and-swap write without weakening atomicity.
4. **`length(CAST(text AS BLOB))` measures the stored UTF-8 byte count in D1.**
   - Validation: Test a non-ASCII key such as `é` and confirm its two-byte UTF-8 representation.
   - If false: Stop and select a documented D1 byte-measurement mechanism before writing.
5. **The existing public API accepts additive fields in errors without compatibility breakage.**
   - Validation: Preserve `error` as a string and all current statuses; run the complete existing test suite.
   - If false: Keep existing error fields exactly and add new fields only on the new route, documenting the narrower scope.

## Decisions and Nuances

- `PUT /:id/value` is a custom deterministic set-by-pointer operation. It is not RFC 6902 JSON Patch and not RFC 7396 JSON Merge Patch.
- JSON Pointer supplies only addressing. Array append-by-`-` is not part of this API.
- Index-equal-length append is idempotent because a retry addresses the same numeric index and replaces it.
- A missing `/items/0/name` path produces object keys when `items` does not exist. Clients that need an array must first set `/items` to `[]` or use full PUT.
- A leaf `null` may be replaced. A non-final `null` blocks traversal.
- Object key order and insignificant whitespace are not API semantics. Numeric value text outside JavaScript precision remains protected.
- The operation reads the current row for planning but is safe because the write uses the inspected version as a compare-and-swap condition.
- `retryable` means the same request can reasonably be attempted again. Unknown commit state is not automatically retryable; clients must read current state first.
- Full item responses are retained despite possible response amplification because consistency and agent usability outweigh a second response mode in this delivery.

## Blockers and Open Questions

None before execution. Step 1 is a mandatory executable compatibility gate. Any failed invariant converts the plan to blocked status and must stop implementation rather than trigger an implicit contract change.

## Testing Strategy

- Pure unit tests: `test/json-path.test.mjs` for JSON Pointer parsing, URL-decoded values, token escaping, path planning, object creation, arrays, and conflicts.
- Worker tests: `test/worker.test.mjs` for routing, body handling, errors, versions, timestamps, compare-and-swap retries, result sizes, CORS, cache headers, and docs.
- Real D1 characterization: Step 1's read-only remote queries plus a disposable local D1 batch/`RETURNING` test.
- Full test command: `npm test`.
- Bundle/config validation: `npx wrangler deploy --dry-run`.
- Review: complete Reviewer Loop required by `AGENTS.md` after implementation.
- Production verification: only after separately authorized `npm run deploy`, using a unique disposable ID and deleting it at the end.

## Execution Handoff

1. Begin at Step 0 and create the plan-anchor commit before modifying code.
2. Perform Step 1 before writing the route or persistence logic.
3. Open `src/worker.js`, `test/worker.test.mjs`, `src/docs.js`, `README.md`, `AGENTS.md`, and `wrangler.jsonc` together to preserve existing behavior and constraints.
4. Implement and test `src/json-path.js` before changing D1 writes.
5. Add structured errors before the new route so every subsequent failure path uses one contract.
6. Implement compare-and-swap persistence before exposing routing.
7. Add the route, then complete behavior tests, then update every documentation surface.
8. Run tests, dry-run, and reviewer loops before any delivery commit.
9. Stop before deployment unless the user explicitly authorizes the exact production action.

## Out of Scope

- Authentication, authorization, ownership, secrets, or CORS-based access control.
- Deleting a nested value.
- Multiple path mutations in one request.
- JSON Patch, JSON Merge Patch, or merge semantics.
- `/-` append, array insertion, array deletion, or automatic gap filling.
- Inferring arrays from numeric-looking tokens under missing ancestors.
- Reading only a nested path.
- Minimal-response modes.
- ETags, `If-Match`, or client-visible optimistic concurrency controls.
- Schema migrations, history, listing, search, expiration, or rollback storage.
- Raising the 1,900,000-byte application limit.
- Changing production routes, WAF rules, `workers_dev`, preview URLs, or the no-auth model.
- Production deployment without a separate explicit confirmation.
