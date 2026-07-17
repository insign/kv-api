import { DOCS_HTML } from "./docs.js";
import {
  JsonPathError,
  parseJsonPointer,
  planJsonSetPath,
  sqliteObjectSegment,
} from "./json-path.js";

const MAX_JSON_BYTES = 1_900_000;
const MAX_JSON_NESTING_DEPTH = 1000;
const MAX_GET_DATA_BYTES = 10_000;
const MAX_GET_URI_BYTES = 15_000;
const MAX_GET_DATA_CHARACTERS = 13_334;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;
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
  DUPLICATE_METHOD_PARAMETER: 400,
  INVALID_METHOD_PARAMETER: 400,
  UNEXPECTED_QUERY_PARAMETER: 400,
  MISSING_DATA_PARAMETER: 400,
  DUPLICATE_DATA_PARAMETER: 400,
  INVALID_DATA_ENCODING: 400,
  QUERY_DATA_TOO_LARGE: 413,
  URI_TOO_LONG: 414,
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
  RESULT_TOO_DEEP: 422,
  STORED_JSON_TOO_DEEP: 409,
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

function resultTooDeep(resultDepth) {
  return new ApiError(
    "RESULT_TOO_DEEP",
    "O documento resultante excede o limite de aninhamento do D1.",
    `Reduza o resultado para no máximo ${MAX_JSON_NESTING_DEPTH} níveis de objetos e arrays.`,
    { result_depth: resultDepth, max_depth: MAX_JSON_NESTING_DEPTH },
  );
}

function storeFailed() {
  return new ApiError(
    "STORE_FAILED",
    "Não foi possível salvar o item.",
    "Consulte GET /:id antes de tentar novamente, pois o estado da gravação pode ser incerto.",
  );
}

function invalidDataEncoding(reason) {
  return new ApiError(
    "INVALID_DATA_ENCODING",
    "O parâmetro data não contém base64url canônico sem padding.",
    "Use apenas A-Z, a-z, 0-9, - e _, sem =, espaços ou alfabeto base64 padrão.",
    { reason },
  );
}

function queryDataTooLarge(receivedBytes) {
  const details = { max_bytes: MAX_GET_DATA_BYTES };
  if (receivedBytes !== undefined) details.received_bytes = receivedBytes;
  return new ApiError(
    "QUERY_DATA_TOO_LARGE",
    "O JSON decodificado de data excede o limite de 10.000 bytes.",
    "Reduza data para no máximo 10.000 bytes após a decodificação base64url.",
    details,
  );
}

function readAliasMethod(searchParams, acceptedMethods) {
  const methods = searchParams.getAll("method");
  if (methods.length === 0) return null;
  if (methods.length > 1) {
    throw new ApiError(
      "DUPLICATE_METHOD_PARAMETER",
      "O parâmetro method foi enviado mais de uma vez.",
      "Envie exatamente um parâmetro method.",
      { method_count: methods.length },
    );
  }
  if (!acceptedMethods.includes(methods[0])) {
    throw new ApiError(
      "INVALID_METHOD_PARAMETER",
      "O parâmetro method não é válido para esta rota.",
      "Use somente os valores method documentados para esta rota.",
      { accepted_methods: acceptedMethods },
    );
  }
  return methods[0];
}

function rejectUnexpectedQueryParameters(searchParams, allowedParameters) {
  const parameters = [...new Set(searchParams.keys())]
    .filter((parameter) => !allowedParameters.includes(parameter))
    .sort();
  if (parameters.length === 0) return;
  throw new ApiError(
    "UNEXPECTED_QUERY_PARAMETER",
    "A query contém parâmetros não permitidos para este comando.",
    "Envie somente os parâmetros documentados para o método selecionado.",
    { parameters },
  );
}

function readQueryData(searchParams) {
  const values = searchParams.getAll("data");
  if (values.length === 0) {
    throw new ApiError(
      "MISSING_DATA_PARAMETER",
      "O parâmetro data é obrigatório.",
      "Envie exatamente um parâmetro data contendo JSON UTF-8 em base64url sem padding.",
    );
  }
  if (values.length > 1) {
    throw new ApiError(
      "DUPLICATE_DATA_PARAMETER",
      "O parâmetro data foi enviado mais de uma vez.",
      "Envie exatamente um parâmetro data.",
      { data_count: values.length },
    );
  }
  return values[0];
}

function assertMutatingAliasUriLength(request) {
  const uriBytes = new TextEncoder().encode(request.url).byteLength;
  if (uriBytes <= MAX_GET_URI_BYTES) return;
  throw new ApiError(
    "URI_TOO_LONG",
    "A URL excede o limite preventivo de 15.000 bytes.",
    "Reduza data, path ou o tamanho total da URL.",
    { uri_bytes: uriBytes, max_uri_bytes: MAX_GET_URI_BYTES },
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

function jsonNestingDepth(jsonText) {
  let depth = 0;
  let maxDepth = 0;
  let inString = false;
  let escaped = false;

  for (const character of jsonText) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{" || character === "[") {
      depth += 1;
      maxDepth = Math.max(maxDepth, depth);
    } else if (character === "}" || character === "]") {
      depth -= 1;
    }
  }

  return maxDepth;
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
  let value;
  try {
    value = JSON.parse(row.json);
  } catch {
    throw new ApiError(
      "STORED_JSON_INVALID",
      "O item armazenado contém JSON inválido.",
      "Substitua o documento completo por JSON válido usando PUT /:id.",
    );
  }

  if (!row.is_valid_json) {
    const documentDepth = jsonNestingDepth(row.json);
    if (documentDepth > MAX_JSON_NESTING_DEPTH) {
      throw new ApiError(
        "STORED_JSON_TOO_DEEP",
        "O item armazenado excede o limite de aninhamento para atualizações por caminho.",
        `Substitua o documento completo por JSON com no máximo ${MAX_JSON_NESTING_DEPTH} níveis antes de usar PUT /:id/value.`,
        { document_depth: documentDepth, max_depth: MAX_JSON_NESTING_DEPTH },
      );
    }
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

  return value;
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

    const replacementDepth = jsonNestingDepth(replacementJson);

    for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
      const row = await db.prepare(INSPECT_ITEM_SQL).bind(id).first();

      if (!row) {
        const resultDepth = tokens.length + replacementDepth;
        if (resultDepth > MAX_JSON_NESTING_DEPTH) throw resultTooDeep(resultDepth);
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
      const resultDepth = tokens.length + replacementDepth;
      if (resultDepth > MAX_JSON_NESTING_DEPTH) throw resultTooDeep(resultDepth);
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

async function replaceItem(db, id, jsonText) {
  let updated;
  try {
    updated = await db
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
      .bind(id, jsonText)
      .first();
  } catch {
    throw storeFailed();
  }

  if (!updated) throw storeFailed();
  return updated;
}

async function deleteItem(db, id) {
  let deleted;
  try {
    deleted = await db
      .prepare("DELETE FROM items WHERE id = ? RETURNING id")
      .bind(id)
      .first();
  } catch {
    throw storeFailed();
  }

  if (!deleted) {
    throw new ApiError(
      "ITEM_NOT_FOUND",
      "O ID não existe.",
      "Confira o identificador informado; o item pode já ter sido apagado.",
      { id },
    );
  }
  return { ok: true, id: deleted.id };
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

function decodeJsonBytes(bytes) {
  let jsonText;
  try {
    jsonText = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ApiError(
      "INVALID_UTF8",
      "O valor JSON não está codificado em UTF-8 válido.",
      "Codifique o valor como UTF-8 e envie um valor JSON válido.",
    );
  }

  try {
    JSON.parse(jsonText);
  } catch {
    throw new ApiError(
      "INVALID_JSON",
      "O valor recebido não contém JSON válido.",
      "Envie exatamente um valor JSON válido: objeto, array, string, número, booleano ou null.",
    );
  }

  return jsonText;
}

function decodeQueryData(encoded) {
  if (!BASE64URL_PATTERN.test(encoded)) {
    throw invalidDataEncoding("invalid_alphabet_or_padding");
  }
  if (encoded.length % 4 === 1) throw invalidDataEncoding("invalid_length");
  if (encoded.length > MAX_GET_DATA_CHARACTERS) throw queryDataTooLarge();

  const base64 = encoded.replaceAll("-", "+").replaceAll("_", "/");
  const paddedBase64 = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  let binary;
  try {
    binary = atob(paddedBase64);
  } catch {
    throw invalidDataEncoding("decode_failed");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  if (bytes.byteLength > MAX_GET_DATA_BYTES) {
    throw queryDataTooLarge(bytes.byteLength);
  }

  const canonical = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  if (canonical !== encoded) throw invalidDataEncoding("non_canonical");
  return decodeJsonBytes(bytes);
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

  return decodeJsonBytes(body);
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
      "Referrer-Policy": "no-referrer",
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

    if (parts.length === 2 && parts[1] === "value") {
      const id = parts[0];
      if (!VALID_ID.test(id)) return invalidId(id);
      if (method !== "PUT" && method !== "GET") {
        return methodNotAllowed("PUT, OPTIONS");
      }

      let pointer;
      let tokens;
      let replacementJson;
      try {
        if (method === "GET") {
          const aliasMethod = readAliasMethod(url.searchParams, ["PUT"]);
          if (aliasMethod === null) return methodNotAllowed("PUT, OPTIONS");
          assertMutatingAliasUriLength(request);
          rejectUnexpectedQueryParameters(url.searchParams, ["method", "path", "data"]);
        }

        ({ pointer, tokens } = parseJsonPointer(url.searchParams));
        replacementJson =
          method === "GET"
            ? decodeQueryData(readQueryData(url.searchParams))
            : await readJsonRequestBody(request);
      } catch (error) {
        if (error instanceof JsonPathError) {
          return errorJson(new ApiError(error.code, error.message, error.hint, error.details));
        }
        if (error instanceof ApiError) return errorJson(error);
        throw error;
      }

      try {
        const updated = await setJsonValue(env.tasks, id, tokens, replacementJson);
        return itemJson(updated);
      } catch (error) {
        if (error instanceof ApiError) {
          const pathDetails = [
            "PATH_TYPE_CONFLICT",
            "INVALID_ARRAY_INDEX",
            "ARRAY_INDEX_OUT_OF_BOUNDS",
          ].includes(error.code)
            ? { path: pointer }
            : {};
          return errorJson(
            new ApiError(error.code, error.message, error.hint, {
              ...pathDetails,
              ...error.details,
            }, error.retryable),
          );
        }
        throw error;
      }
    }

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

    let effectiveMethod = method;
    let aliasJson;
    if (method === "GET") {
      try {
        const aliasMethod = readAliasMethod(url.searchParams, ["GET", "PUT", "DELETE"]);
        if (aliasMethod !== null) {
          effectiveMethod = aliasMethod;
          if (aliasMethod === "PUT" || aliasMethod === "DELETE") {
            assertMutatingAliasUriLength(request);
          }
          const allowedParameters =
            aliasMethod === "PUT" ? ["method", "data"] : ["method"];
          rejectUnexpectedQueryParameters(url.searchParams, allowedParameters);
          if (aliasMethod === "PUT") {
            aliasJson = decodeQueryData(readQueryData(url.searchParams));
          }
        }
      } catch (error) {
        if (error instanceof ApiError) return errorJson(error);
        throw error;
      }
    }

    if (effectiveMethod === "GET") {
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

    if (effectiveMethod === "PUT") {
      let jsonStr;
      try {
        jsonStr = method === "GET" ? aliasJson : await readJsonRequestBody(request);
      } catch (error) {
        if (error instanceof ApiError) return errorJson(error);
        throw error;
      }

      try {
        return itemJson(await replaceItem(env.tasks, id, jsonStr));
      } catch (error) {
        if (error instanceof ApiError) return errorJson(error);
        throw error;
      }
    }

    if (effectiveMethod === "DELETE") {
      try {
        return json(await deleteItem(env.tasks, id));
      } catch (error) {
        if (error instanceof ApiError) return errorJson(error);
        throw error;
      }
    }

    return methodNotAllowed("GET, PUT, DELETE, OPTIONS");
  },
};
