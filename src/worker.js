import { DOCS_HTML } from "./docs.js";
import { JsonPathError, planJsonSetPath, sqliteObjectSegment } from "./json-path.js";

const MAX_JSON_BYTES = 1_900_000;
const VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_WRITE_ATTEMPTS = 3;

const INSPECT_ITEM_SQL = `SELECT
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
LIMIT 1`;

const EXISTING_RESULT_SIZE_SQL = `SELECT
  version,
  length(CAST(json_set(json, ?, json('null')) AS BLOB))
    - 4
    + length(CAST(json(?) AS BLOB)) AS result_bytes
FROM items
WHERE id = ? AND version = ? AND json = ?`;

const UPDATE_VALUE_SQL = `UPDATE items
SET
  json = json_set(json, ?, json(?)),
  version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE id = ?
  AND version = ?
  AND json = ?
  AND length(CAST(json_set(json, ?, json('null')) AS BLOB))
    - 4
    + length(CAST(json(?) AS BLOB)) <= ${MAX_JSON_BYTES}
RETURNING id, version, json, created_at, updated_at`;

const MISSING_RESULT_SIZE_SQL = `SELECT
  length(CAST(json_set('{}', ?, json('null')) AS BLOB))
    - 4
    + length(CAST(json(?) AS BLOB)) AS result_bytes`;

const INSERT_VALUE_SQL = `INSERT INTO items (id, version, json, created_at, updated_at)
SELECT
  ?,
  1,
  json_set('{}', ?, json(?)),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE length(CAST(json_set('{}', ?, json('null')) AS BLOB))
  - 4
  + length(CAST(json(?) AS BLOB)) <= ${MAX_JSON_BYTES}
ON CONFLICT(id) DO NOTHING
RETURNING id, version, json, created_at, updated_at`;

export class ApiError extends Error {
  constructor(code, message, hint, details = {}, retryable = false) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.retryable = retryable;
  }
}

const ERROR_STATUS = {
  INVALID_ID: 400,
  INVALID_ROUTE: 404,
  ITEM_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  INVALID_JSON: 400,
  INVALID_UTF8: 400,
  PAYLOAD_TOO_LARGE: 413,
  MISSING_PATH_PARAMETER: 400,
  DUPLICATE_PATH_PARAMETER: 400,
  INVALID_JSON_POINTER: 400,
  ROOT_PATH_NOT_ALLOWED: 400,
  PATH_TOO_LONG: 414,
  PATH_TOO_DEEP: 400,
  PATH_TYPE_CONFLICT: 409,
  INVALID_ARRAY_INDEX: 409,
  ARRAY_INDEX_OUT_OF_BOUNDS: 409,
  AMBIGUOUS_PATH: 409,
  STORED_JSON_INVALID: 409,
  WRITE_CONFLICT: 409,
  RESULT_TOO_LARGE: 422,
  STORE_FAILED: 500,
};

function resultTooLarge(resultBytes) {
  return new ApiError(
    "RESULT_TOO_LARGE",
    "O documento resultante excede o limite de 1,9 MB.",
    "Reduza o valor ou substitua o documento completo por uma versão menor usando PUT /:id.",
    { result_bytes: resultBytes, max_bytes: MAX_JSON_BYTES },
  );
}

function storeFailed() {
  return new ApiError(
    "STORE_FAILED",
    "Não foi possível salvar o item.",
    "Consulte GET /:id antes de tentar novamente, pois o estado da gravação pode ser incerto.",
  );
}

function isByteCount(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isJsonText(value) {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function isItemRow(row, id, version) {
  return (
    row !== null &&
    typeof row === "object" &&
    row.id === id &&
    row.version === version &&
    Number.isSafeInteger(row.version) &&
    typeof row.json === "string" &&
    (row.created_at === null || typeof row.created_at === "string") &&
    (row.updated_at === null || typeof row.updated_at === "string")
  );
}

function isInsertedItemRow(row, id, resultBytes) {
  return (
    isItemRow(row, id, 1) &&
    typeof row.created_at === "string" &&
    row.updated_at === row.created_at &&
    isJsonText(row.json) &&
    new TextEncoder().encode(row.json).byteLength === resultBytes
  );
}

function isUpdatedItemRow(row, id, version, resultBytes) {
  return (
    isItemRow(row, id, version) &&
    typeof row.updated_at === "string" &&
    isJsonText(row.json) &&
    new TextEncoder().encode(row.json).byteLength === resultBytes
  );
}

function parseStoredJson(row) {
  if (!row.is_valid_json) {
    throw new ApiError(
      "STORED_JSON_INVALID",
      "O item armazenado contém JSON inválido.",
      "Substitua o documento completo por JSON válido usando PUT /:id.",
    );
  }
  if (row.has_duplicate_keys) {
    throw new ApiError(
      "AMBIGUOUS_PATH",
      "O item armazenado contém chaves de objeto duplicadas.",
      "Normalize as chaves duplicadas substituindo o documento completo com PUT /:id.",
    );
  }

  try {
    return JSON.parse(row.json);
  } catch {
    throw new ApiError(
      "STORED_JSON_INVALID",
      "O item armazenado contém JSON inválido.",
      "Substitua o documento completo por JSON válido usando PUT /:id.",
    );
  }
}

export async function setJsonValue(db, id, tokens, replacementJson) {
  try {
    if (tokens.length === 0) {
      throw new ApiError(
        "ROOT_PATH_NOT_ALLOWED",
        "O caminho raiz não pode ser alterado por esta rota.",
        "Use PUT /:id para substituir o documento completo.",
      );
    }

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const row = await db.prepare(INSPECT_ITEM_SQL).bind(id).first();

      if (!row) {
        const sqlitePath = `$${tokens.map(sqliteObjectSegment).join("")}`;
        const candidate = await db
          .prepare(MISSING_RESULT_SIZE_SQL)
          .bind(sqlitePath, replacementJson)
          .first();

        if (!candidate || !isByteCount(candidate.result_bytes)) throw storeFailed();
        if (candidate.result_bytes > MAX_JSON_BYTES) {
          throw resultTooLarge(candidate.result_bytes);
        }

        const inserted = await db
          .prepare(INSERT_VALUE_SQL)
          .bind(id, sqlitePath, replacementJson, sqlitePath, replacementJson)
          .first();
        if (inserted) {
          if (!isInsertedItemRow(inserted, id, candidate.result_bytes)) throw storeFailed();
          return inserted;
        }
        continue;
      }

      if (
        !isItemRow(row, id, row.version) ||
        ![0, 1].includes(row.is_valid_json) ||
        ![0, 1].includes(row.has_duplicate_keys)
      ) {
        throw storeFailed();
      }
      const currentValue = parseStoredJson(row);
      const { sqlitePath } = planJsonSetPath(currentValue, tokens);
      const batchResults = await db.batch([
        db
          .prepare(EXISTING_RESULT_SIZE_SQL)
          .bind(sqlitePath, replacementJson, id, row.version, row.json),
        db
          .prepare(UPDATE_VALUE_SQL)
          .bind(
            sqlitePath,
            replacementJson,
            id,
            row.version,
            row.json,
            sqlitePath,
            replacementJson,
          ),
      ]);

      if (!Array.isArray(batchResults) || batchResults.length !== 2) throw storeFailed();
      const [candidateResult, updateResult] = batchResults;
      if (
        candidateResult?.success !== true ||
        updateResult?.success !== true ||
        !Array.isArray(candidateResult.results) ||
        !Array.isArray(updateResult.results)
      ) {
        throw storeFailed();
      }

      if (candidateResult.results.length === 0) {
        if (updateResult.results.length !== 0) throw storeFailed();
        continue;
      }
      if (candidateResult.results.length !== 1) throw storeFailed();

      const candidate = candidateResult.results[0];
      if (
        candidate === null ||
        typeof candidate !== "object" ||
        candidate.version !== row.version ||
        !isByteCount(candidate.result_bytes)
      ) {
        throw storeFailed();
      }
      if (candidate.result_bytes > MAX_JSON_BYTES) {
        if (updateResult.results.length !== 0) throw storeFailed();
        throw resultTooLarge(candidate.result_bytes);
      }

      if (updateResult.results.length !== 1) throw storeFailed();
      const updated = updateResult.results[0];
      if (
        !isUpdatedItemRow(
          updated,
          id,
          row.version + 1,
          candidate.result_bytes,
        )
      ) {
        throw storeFailed();
      }
      return updated;
    }

    throw new ApiError(
      "WRITE_CONFLICT",
      "O item foi alterado por outra gravação durante a atualização.",
      "Leia a versão atual e tente novamente.",
      {},
      true,
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof JsonPathError) {
      throw new ApiError(error.code, error.message, error.hint, error.details);
    }
    throw storeFailed();
  }
}

async function readBodyWithLimit(request) {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_JSON_BYTES) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

async function readJsonRequestBody(request) {
  const contentLength = request.headers.get("Content-Length");
  const declaredBytes = contentLength === null ? null : Number(contentLength);
  if (Number.isFinite(declaredBytes) && declaredBytes > MAX_JSON_BYTES) {
    await request.body?.cancel().catch(() => {});
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      "O JSON excede o limite de 1,9 MB.",
      `Reduza o corpo para no máximo ${MAX_JSON_BYTES} bytes UTF-8.`,
      { received_bytes: declaredBytes, max_bytes: MAX_JSON_BYTES },
    );
  }

  const body = await readBodyWithLimit(request);
  if (body === null) {
    throw new ApiError(
      "PAYLOAD_TOO_LARGE",
      "O JSON excede o limite de 1,9 MB.",
      `Reduza o corpo para no máximo ${MAX_JSON_BYTES} bytes UTF-8.`,
      { max_bytes: MAX_JSON_BYTES },
    );
  }

  let jsonText;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw new ApiError(
      "INVALID_UTF8",
      "O corpo não está codificado em UTF-8 válido.",
      "Codifique o corpo como UTF-8 e envie um valor JSON válido.",
    );
  }

  try {
    JSON.parse(jsonText);
  } catch {
    throw new ApiError(
      "INVALID_JSON",
      "O corpo não contém JSON válido.",
      "Envie exatamente um valor JSON válido: objeto, array, string, número, booleano ou null.",
    );
  }

  return jsonText;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/+|\/+$/g, "");
    const parts = path ? path.split("/") : [];
    const method = request.method.toUpperCase();

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, If-None-Match, If-Match",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
      "Content-Security-Policy": "default-src 'none'",
    };

    const jsonText = (body, init = {}) =>
      new Response(body, {
        status: init.status ?? 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...corsHeaders,
          ...(init.headers || {}),
        },
      });

    const json = (data, init = {}) => jsonText(JSON.stringify(data), init);

    const errorJson = (problem, init = {}) => {
      const details = Object.fromEntries(
        Object.entries(problem.details || {}).filter(
          ([key]) => !["error", "code", "retryable", "hint"].includes(key),
        ),
      );
      return json(
        {
          error: problem.message,
          code: problem.code,
          retryable: Boolean(problem.retryable),
          hint: problem.hint,
          ...details,
        },
        {
          ...init,
          status: init.status ?? ERROR_STATUS[problem.code] ?? 500,
        },
      );
    };

    const methodNotAllowed = (allow) =>
      errorJson(
        new ApiError(
          "METHOD_NOT_ALLOWED",
          "Método não suportado.",
          `Use um destes métodos nesta rota: ${allow}.`,
        ),
        { headers: { Allow: allow } },
      );

    const itemJson = (row) => {
      let storedJson = row.json;
      try {
        JSON.parse(storedJson);
      } catch {
        storedJson = JSON.stringify(storedJson);
      }

      const metadata = JSON.stringify({
        id: row.id,
        version: row.version,
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
      return jsonText(`${metadata.slice(0, -1)},"json":${storedJson}}`);
    };

    const empty = (status = 204, headers = {}) =>
      new Response(null, {
        status,
        headers: {
          ...corsHeaders,
          ...headers,
        },
      });

    if (method === "OPTIONS") {
      return empty(204);
    }

    if (parts.length === 0) {
      if (method !== "GET") {
        return methodNotAllowed("GET, OPTIONS");
      }

      return new Response(DOCS_HTML, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
      });
    }

    const invalidId = (id) =>
      errorJson(
        new ApiError(
          "INVALID_ID",
          "ID inválido.",
          "Use de 1 a 100 caracteres: letras ASCII, números, hífen ou sublinhado.",
          {
            id: String(id).slice(0, 100),
            regra: "^[A-Za-z0-9_-]{1,100}$",
          },
        ),
      );

    if (parts.length === 2 && parts[1] === "version") {
      const id = parts[0];
      if (!VALID_ID.test(id)) return invalidId(id);
      if (method !== "GET") {
        return methodNotAllowed("GET, OPTIONS");
      }

      const row = await env.tasks
        .prepare("SELECT version FROM items WHERE id = ? LIMIT 1")
        .bind(id)
        .first();

      if (!row) {
        return errorJson(
          new ApiError(
            "ITEM_NOT_FOUND",
            "O ID não existe.",
            "Crie o item com PUT /:id ou confira o identificador informado.",
            { id },
          ),
        );
      }
      return json({ id, version: row.version });
    }

    if (parts.length !== 1 || parts[0] === "") {
      return errorJson(
        new ApiError(
          "INVALID_ROUTE",
          "Rota inválida.",
          "Consulte GET / para ver as rotas disponíveis.",
          { path: url.pathname.slice(0, 512) },
        ),
      );
    }

    const id = parts[0];
    if (!VALID_ID.test(id)) return invalidId(id);

    if (method === "GET") {
      const row = await env.tasks
        .prepare(
          "SELECT id, version, json, created_at, updated_at FROM items WHERE id = ? LIMIT 1"
        )
        .bind(id)
        .first();

      if (!row) {
        return errorJson(
          new ApiError(
            "ITEM_NOT_FOUND",
            "O ID não existe.",
            "Crie o item com PUT /:id ou confira o identificador informado.",
            { id },
          ),
        );
      }
      return itemJson(row);
    }

    if (method === "PUT") {
      let jsonStr;
      try {
        jsonStr = await readJsonRequestBody(request);
      } catch (error) {
        if (error instanceof ApiError) return errorJson(error);
        throw error;
      }

      let updated;
      try {
        updated = await env.tasks
          .prepare(
            `INSERT INTO items (id, version, json, created_at, updated_at)
             VALUES (
               ?,
               1,
               ?,
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             )
             ON CONFLICT(id) DO UPDATE SET
               json = excluded.json,
               version = items.version + 1,
               updated_at = excluded.updated_at
             RETURNING id, version, json, created_at, updated_at`,
          )
          .bind(id, jsonStr)
          .first();
      } catch {
        return errorJson(storeFailed());
      }

      if (!updated) {
        return errorJson(storeFailed());
      }
      return itemJson(updated);
    }

    if (method === "DELETE") {
      let deleted;
      try {
        deleted = await env.tasks
          .prepare("DELETE FROM items WHERE id = ? RETURNING id")
          .bind(id)
          .first();
      } catch {
        return errorJson(storeFailed());
      }

      if (!deleted) {
        return errorJson(
          new ApiError(
            "ITEM_NOT_FOUND",
            "O ID não existe.",
            "Confira o identificador informado; o item pode já ter sido apagado.",
            { id },
          ),
        );
      }
      return json({ ok: true, id: deleted.id });
    }

    return methodNotAllowed("GET, PUT, DELETE, OPTIONS");
  },
};
