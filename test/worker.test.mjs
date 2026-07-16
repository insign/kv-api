import assert from "node:assert/strict";
import test from "node:test";

import worker, { ApiError, setJsonValue } from "../src/worker.js";

const MAX_JSON_BYTES = 1_900_000;
const MAX_D1_VALUE_BYTES = 2_000_000;

function sqlitePathSegments(path) {
  const segments = [];
  let offset = 1;

  while (offset < path.length) {
    if (path[offset] === ".") {
      offset += 1;
      const start = offset;
      let escaped = false;
      offset += 1;
      while (offset < path.length) {
        const character = path[offset];
        if (!escaped && character === '"') break;
        escaped = !escaped && character === "\\";
        if (character !== "\\") escaped = false;
        offset += 1;
      }
      segments.push({ type: "key", value: JSON.parse(path.slice(start, offset + 1)) });
      offset += 1;
      continue;
    }

    const end = path.indexOf("]", offset);
    segments.push({ type: "index", value: Number(path.slice(offset + 1, end)) });
    offset = end + 1;
  }

  return segments;
}

function applyJsonSet(rawJson, path, replacementJson) {
  const root = JSON.parse(rawJson);
  const replacement = JSON.parse(replacementJson);
  const segments = sqlitePathSegments(path);
  let current = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isFinal = index === segments.length - 1;

    if (segment.type === "key") {
      if (isFinal) {
        current[segment.value] = replacement;
      } else {
        if (!Object.hasOwn(current, segment.value)) current[segment.value] = {};
        current = current[segment.value];
      }
      continue;
    }

    if (isFinal) {
      if (segment.value === current.length) current.push(replacement);
      else current[segment.value] = replacement;
    } else {
      if (segment.value === current.length) current.push({});
      current = current[segment.value];
    }
  }

  return JSON.stringify(root);
}

const utf8Bytes = (value) => new TextEncoder().encode(value).byteLength;

function materializeJsonSet(rawJson, path, replacementJson) {
  const result = applyJsonSet(rawJson, path, replacementJson);
  if (utf8Bytes(result) > MAX_D1_VALUE_BYTES) {
    throw new Error("string or blob too big");
  }
  return result;
}

function jsonSetResultBytes(rawJson, path, replacementJson) {
  const withNull = materializeJsonSet(rawJson, path, "null");
  const canonicalReplacement = JSON.stringify(JSON.parse(replacementJson));
  return utf8Bytes(withNull) - utf8Bytes("null") + utf8Bytes(canonicalReplacement);
}

class MockD1 {
  constructor(items = []) {
    this.items = new Map(items.map((item) => [item.id, { ...item }]));
    this.clock = Date.parse("2026-07-12T20:00:00.000Z");
    this.beforeBatch = null;
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        sql,
        args,
        first: () => this.executeFirst(sql, args),
      }),
    };
  }

  async batch(statements) {
    if (this.beforeBatch) await this.beforeBatch(this);

    const results = [];
    for (const statement of statements) {
      const row = await this.executeFirst(statement.sql, statement.args);
      results.push({ success: true, results: row ? [row] : [] });
    }
    return results;
  }

  async executeFirst(sql, args) {
    if (sql.startsWith("SELECT version")) {
      const item = this.items.get(args[0]);
      return item ? { version: item.version } : null;
    }

    if (sql.includes("json_valid(json) AS is_valid_json")) {
      const item = this.items.get(args[0]);
      if (!item) return null;

      let isValid = 1;
      try {
        JSON.parse(item.json);
      } catch {
        isValid = 0;
      }
      return {
        ...item,
        is_valid_json: item.is_valid_json ?? isValid,
        has_duplicate_keys: item.has_duplicate_keys ?? 0,
      };
    }

    if (sql.startsWith("SELECT id, version")) {
      return this.items.get(args[0]) ?? null;
    }

    if (sql.includes("json_set('{}', ?, json('null'))") && sql.startsWith("SELECT")) {
      const [path, replacementJson] = args;
      return { result_bytes: jsonSetResultBytes("{}", path, replacementJson) };
    }

    if (sql.startsWith("SELECT\n  version,") && sql.includes("json_set(json")) {
      if (!sql.includes("json_set(json, ?, json('null'))")) {
        throw new Error("consulta de tamanho materializa o resultado completo");
      }
      const [path, replacementJson, id, version, expectedJson] = args;
      const item = this.items.get(id);
      if (!item || item.version !== version || item.json !== expectedJson) return null;
      return {
        version,
        result_bytes: jsonSetResultBytes(item.json, path, replacementJson),
      };
    }

    if (sql.startsWith("UPDATE items")) {
      if (!sql.includes("json_set(json, ?, json('null'))")) {
        throw new Error("UPDATE não usa a medição sentinela");
      }
      const [path, replacementJson, id, version, expectedJson] = args;
      const current = this.items.get(id);
      if (!current || current.version !== version || current.json !== expectedJson) return null;

      if (jsonSetResultBytes(current.json, path, replacementJson) > MAX_JSON_BYTES) return null;
      const json = materializeJsonSet(current.json, path, replacementJson);

      const item = {
        ...current,
        version: current.version + 1,
        json,
        updated_at: new Date(this.clock++).toISOString(),
      };
      this.items.set(id, item);
      return { ...item };
    }

    if (sql.startsWith("INSERT INTO items") && sql.includes("DO NOTHING")) {
      if (!sql.includes("json_set('{}', ?, json('null'))")) {
        throw new Error("INSERT não usa a medição sentinela");
      }
      const [id, path, replacementJson] = args;
      if (this.items.has(id)) return null;

      if (jsonSetResultBytes("{}", path, replacementJson) > MAX_JSON_BYTES) return null;
      const json = materializeJsonSet("{}", path, replacementJson);

      const now = new Date(this.clock++).toISOString();
      const item = {
        id,
        version: 1,
        json,
        created_at: now,
        updated_at: now,
      };
      this.items.set(id, item);
      return { ...item };
    }

    if (sql.startsWith("INSERT INTO items")) {
      const [id, json] = args;
      const current = this.items.get(id);
      const now = new Date(this.clock++).toISOString();
      const item = current
        ? { ...current, version: current.version + 1, json, updated_at: now }
        : {
            id,
            version: 1,
            json,
            created_at: now,
            updated_at: now,
          };
      this.items.set(id, item);
      return { ...item };
    }

    if (sql.startsWith("DELETE FROM items")) {
      const id = args[0];
      if (!this.items.has(id)) return null;
      this.items.delete(id);
      return { id };
    }

    throw new Error(`SQL não reconhecido no mock: ${sql}`);
  }
}

const call = (db, path, init = {}) =>
  worker.fetch(new Request(`https://kv.helio.me${path}`, init), { tasks: db });

async function assertError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.error, "string");
  assert.equal(typeof body.retryable, "boolean");
  assert.equal(typeof body.hint, "string");
  return body;
}

test("serve documentação completa na raiz", async () => {
  const response = await call(new MockD1(), "/");
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("Content-Type"), /^text\/html/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(
    response.headers.get("Content-Security-Policy"),
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
  );
  assert.match(html, /https:\/\/kv\.helio\.me/);
  assert.match(html, /API pública e sem autenticação/);
  assert.match(html, /GET<\/span><code>\/:id\/version/);
  assert.match(html, /1\.900\.000 bytes/);
  assert.doesNotMatch(html, /<script|<link[^>]+rel="stylesheet"|<img[^>]+src="https?:/i);
  assert.doesNotMatch(html, /tasks-api\.helio\.me/);
});

test("retorna 405 para métodos não suportados em rotas conhecidas", async () => {
  const db = new MockD1();
  const root = await call(db, "/", { method: "POST" });
  const version = await call(db, "/item/version", { method: "PUT", body: "{}" });

  await assertError(root, 405, "METHOD_NOT_ALLOWED");
  assert.equal(root.headers.get("Allow"), "GET, OPTIONS");
  await assertError(version, 405, "METHOD_NOT_ALLOWED");
  assert.equal(version.headers.get("Allow"), "GET, OPTIONS");
});

test("cria, consulta, atualiza, versiona e exclui um item", async () => {
  const db = new MockD1();
  const createdResponse = await call(db, "/tarefa_1", {
    method: "PUT",
    body: JSON.stringify({ titulo: "Teste", feito: false }),
  });
  const created = await createdResponse.json();

  assert.equal(created.version, 1);
  assert.equal(created.created_at, created.updated_at);
  assert.deepEqual(created.json, { titulo: "Teste", feito: false });

  const updatedResponse = await call(db, "/tarefa_1", {
    method: "PUT",
    body: "[1,2,3]",
  });
  const updated = await updatedResponse.json();

  assert.equal(updated.version, 2);
  assert.equal(updated.created_at, created.created_at);
  assert.ok(updated.updated_at > created.updated_at);
  assert.deepEqual(updated.json, [1, 2, 3]);

  const version = await (await call(db, "/tarefa_1/version")).json();
  assert.deepEqual(version, { id: "tarefa_1", version: 2 });

  const fetchedResponse = await call(db, "/tarefa_1");
  assert.equal(fetchedResponse.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await fetchedResponse.json(), updated);

  assert.deepEqual(await (await call(db, "/tarefa_1", { method: "DELETE" })).json(), {
    ok: true,
    id: "tarefa_1",
  });
  await assertError(
    await call(db, "/tarefa_1", { method: "DELETE" }),
    404,
    "ITEM_NOT_FOUND",
  );
});

test("preserva created_at nulo de registros legados", async () => {
  const db = new MockD1([
    {
      id: "antigo",
      version: 7,
      json: "{}",
      created_at: null,
      updated_at: null,
    },
  ]);

  const legacy = await (await call(db, "/antigo")).json();
  assert.equal(legacy.created_at, null);
  assert.equal(legacy.updated_at, null);

  const response = await call(db, "/antigo", { method: "PUT", body: "true" });
  const item = await response.json();

  assert.equal(item.created_at, null);
  assert.ok(item.updated_at);
  assert.equal(item.version, 8);
  assert.equal(item.json, true);
});

test("valida id, JSON e UTF-8", async () => {
  const db = new MockD1();
  const invalidId = await assertError(await call(db, "/id.invalido"), 400, "INVALID_ID");
  assert.equal(invalidId.regra, "^[A-Za-z0-9_-]{1,100}$");
  await assertError(
    await call(db, "/invalido", { method: "PUT", body: "{" }),
    400,
    "INVALID_JSON",
  );

  const invalidUtf8 = new Uint8Array([0x22, 0xff, 0x22]);
  await assertError(
    await call(db, "/utf8", { method: "PUT", body: invalidUtf8 }),
    400,
    "INVALID_UTF8",
  );
});

test("retorna erros estruturados para rotas e itens ausentes", async () => {
  const db = new MockD1();
  const route = await assertError(await call(db, "/a/b/c"), 404, "INVALID_ROUTE");
  assert.equal(route.path, "/a/b/c");

  const item = await assertError(await call(db, "/ausente"), 404, "ITEM_NOT_FOUND");
  assert.equal(item.id, "ausente");

  const version = await assertError(
    await call(db, "/ausente/version"),
    404,
    "ITEM_NOT_FOUND",
  );
  assert.equal(version.id, "ausente");
});

test("preserva números JSON maiores que a precisão do JavaScript", async () => {
  const db = new MockD1();

  for (const [id, value] of [
    ["inteiro", "9007199254740993"],
    ["expoente", "1e400"],
  ]) {
    const response = await call(db, `/${id}`, { method: "PUT", body: value });
    assert.equal(response.status, 200);
    assert.equal(db.items.get(id).json, value);
    assert.match(await response.text(), new RegExp(`"json":${value}}`));
  }
});

test("aceita o limite e interrompe streams maiores que 1,9 MB", async () => {
  const db = new MockD1();
  const bodyAtLimit = JSON.stringify("a".repeat(MAX_JSON_BYTES - 2));
  assert.equal(new TextEncoder().encode(bodyAtLimit).byteLength, MAX_JSON_BYTES);
  assert.equal((await call(db, "/limite", { method: "PUT", body: bodyAtLimit })).status, 200);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_JSON_BYTES));
      controller.enqueue(new Uint8Array([0x20]));
      controller.close();
    },
  });
  assert.equal(
    (
      await call(db, "/excesso", {
        method: "PUT",
        body: stream,
        duplex: "half",
      })
    ).status,
    413
  );
});

test("cancela o stream quando Content-Length excede o limite", async () => {
  const db = new MockD1();
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
    },
    cancel() {
      cancelled = true;
    },
  });

  const response = await call(db, "/excesso_declarado", {
    method: "PUT",
    headers: { "Content-Length": String(MAX_JSON_BYTES + 1) },
    body: stream,
    duplex: "half",
  });

  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  const body = await response.json();
  assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  assert.equal(body.max_bytes, MAX_JSON_BYTES);
  assert.equal(body.received_bytes, MAX_JSON_BYTES + 1);
});

test("setJsonValue cria objetos ausentes e atualiza por compare-and-swap", async () => {
  const db = new MockD1();
  const created = await setJsonValue(
    db,
    "config",
    ["preferencias", "notificacoes", "email"],
    "true",
  );

  assert.equal(created.version, 1);
  assert.equal(created.created_at, created.updated_at);
  assert.deepEqual(JSON.parse(created.json), {
    preferencias: { notificacoes: { email: true } },
  });

  const updated = await setJsonValue(db, "config", ["preferencias", "tema"], '"escuro"');
  assert.equal(updated.version, 2);
  assert.equal(updated.created_at, created.created_at);
  assert.ok(updated.updated_at > created.updated_at);
  assert.deepEqual(JSON.parse(updated.json), {
    preferencias: { notificacoes: { email: true }, tema: "escuro" },
  });
});

test("setJsonValue preserva mudanças concorrentes ao repetir o plano", async () => {
  const db = new MockD1([
    {
      id: "concorrente",
      version: 1,
      json: '{"original":true}',
      created_at: "2026-07-12T19:00:00.000Z",
      updated_at: "2026-07-12T19:00:00.000Z",
    },
  ]);
  db.beforeBatch = async (currentDb) => {
    const current = currentDb.items.get("concorrente");
    currentDb.items.set("concorrente", {
      ...current,
      version: current.version + 1,
      json: '{"original":true,"outro":"preservado"}',
      updated_at: "2026-07-12T19:30:00.000Z",
    });
    currentDb.beforeBatch = null;
  };

  const updated = await setJsonValue(db, "concorrente", ["meu"], '"valor"');
  assert.equal(updated.version, 3);
  assert.deepEqual(JSON.parse(updated.json), {
    original: true,
    outro: "preservado",
    meu: "valor",
  });
});

test("setJsonValue replana quando um ID é apagado e recriado", async () => {
  const db = new MockD1([
    {
      id: "recriado",
      version: 1,
      json: '{"a":{}}',
      created_at: "2026-07-12T18:00:00.000Z",
      updated_at: "2026-07-12T18:00:00.000Z",
    },
  ]);
  db.beforeBatch = async (currentDb) => {
    currentDb.items.set("recriado", {
      id: "recriado",
      version: 1,
      json: '{"a":null}',
      created_at: "2026-07-12T19:00:00.000Z",
      updated_at: "2026-07-12T19:00:00.000Z",
    });
    currentDb.beforeBatch = null;
  };

  await assert.rejects(
    () => setJsonValue(db, "recriado", ["a", "b"], "1"),
    (error) => {
      assert.equal(error.code, "PATH_TYPE_CONFLICT");
      return true;
    },
  );
  assert.equal(db.items.get("recriado").version, 1);
  assert.equal(db.items.get("recriado").json, '{"a":null}');
});

test("setJsonValue aceita recriação concorrente com a mesma versão e JSON", async () => {
  const recreatedAt = "2026-07-12T19:00:00.000Z";
  const db = new MockD1([
    {
      id: "recriado_igual",
      version: 1,
      json: '{"a":{}}',
      created_at: "2026-07-12T18:00:00.000Z",
      updated_at: "2026-07-12T18:00:00.000Z",
    },
  ]);
  db.beforeBatch = async (currentDb) => {
    currentDb.items.set("recriado_igual", {
      id: "recriado_igual",
      version: 1,
      json: '{"a":{}}',
      created_at: recreatedAt,
      updated_at: recreatedAt,
    });
    currentDb.beforeBatch = null;
  };

  const updated = await setJsonValue(db, "recriado_igual", ["a", "b"], "1");
  assert.equal(updated.version, 2);
  assert.equal(updated.created_at, recreatedAt);
  assert.deepEqual(JSON.parse(updated.json), { a: { b: 1 } });
});

test("setJsonValue falha após três conflitos consecutivos", async () => {
  const db = new MockD1([
    {
      id: "disputado",
      version: 1,
      json: "{}",
      created_at: null,
      updated_at: null,
    },
  ]);
  let attempts = 0;
  db.beforeBatch = async (currentDb) => {
    attempts += 1;
    currentDb.items.get("disputado").version += 1;
  };

  await assert.rejects(
    () => setJsonValue(db, "disputado", ["valor"], "1"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "WRITE_CONFLICT");
      assert.equal(error.retryable, true);
      return true;
    },
  );
  assert.equal(attempts, 3);
  assert.equal(db.items.get("disputado").json, "{}");
});

test("setJsonValue rejeita caminho raiz e resultados D1 inesperados", async () => {
  await assert.rejects(
    () => setJsonValue(new MockD1(), "raiz", [], "1"),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "ROOT_PATH_NOT_ALLOWED");
      return true;
    },
  );

  for (const batchResult of [
    [],
    [{ success: false, results: [] }, { success: true, results: [] }],
    [
      {
        success: true,
        results: [
          { version: 1, result_bytes: 2 },
          { version: 1, result_bytes: 2 },
        ],
      },
      { success: true, results: [] },
    ],
    [
      { success: true, results: [{ version: 1, result_bytes: 2 }] },
      { success: true, results: [{ id: "forma", version: 99 }] },
    ],
    [
      { success: true, results: [{ version: 1, result_bytes: 11 }] },
      {
        success: true,
        results: [
          {
            id: "forma",
            version: 2,
            json: '{"valor":1}',
            created_at: "2026-07-12T21:00:00.000Z",
            updated_at: null,
          },
        ],
      },
    ],
  ]) {
    const db = new MockD1([
      {
        id: "forma",
        version: 1,
        json: "{}",
        created_at: null,
        updated_at: null,
      },
    ]);
    db.batch = async () => batchResult;

    await assert.rejects(
      () => setJsonValue(db, "forma", ["valor"], "1"),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.code, "STORE_FAILED");
        return true;
      },
    );
    assert.equal(db.items.get("forma").version, 1);
  }
});

test("setJsonValue exige marcadores de inspeção D1 válidos", async () => {
  const db = new MockD1([
    {
      id: "marcadores",
      version: 1,
      json: "{}",
      created_at: null,
      updated_at: null,
      is_valid_json: 2,
    },
  ]);

  await assert.rejects(
    () => setJsonValue(db, "marcadores", ["valor"], "1"),
    (error) => {
      assert.equal(error.code, "STORE_FAILED");
      return true;
    },
  );
});

test("setJsonValue rejeita JSON armazenado inválido, chaves duplicadas e bloqueadores", async () => {
  for (const [item, code] of [
    [
      {
        id: "invalido",
        version: 1,
        json: "{",
        created_at: null,
        updated_at: null,
      },
      "STORED_JSON_INVALID",
    ],
    [
      {
        id: "duplicado",
        version: 1,
        json: '{"a":1,"a":2}',
        created_at: null,
        updated_at: null,
        has_duplicate_keys: 1,
      },
      "AMBIGUOUS_PATH",
    ],
    [
      {
        id: "bloqueado",
        version: 1,
        json: '{"a":null}',
        created_at: null,
        updated_at: null,
      },
      "PATH_TYPE_CONFLICT",
    ],
  ]) {
    const db = new MockD1([item]);
    await assert.rejects(
      () => setJsonValue(db, item.id, ["a", "b"], "1"),
      (error) => {
        assert.equal(error.code, code);
        return true;
      },
    );
    assert.equal(db.items.get(item.id).version, 1);
  }
});

test("setJsonValue rejeita o resultado completo acima do limite", async () => {
  const db = new MockD1();
  const replacement = JSON.stringify("a".repeat(MAX_JSON_BYTES - 2));
  assert.equal(utf8Bytes(replacement), MAX_JSON_BYTES);

  await assert.rejects(
    () => setJsonValue(db, "grande", ["valor"], replacement),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "RESULT_TOO_LARGE");
      assert.ok(error.details.result_bytes > MAX_JSON_BYTES);
      assert.equal(error.details.max_bytes, MAX_JSON_BYTES);
      return true;
    },
  );
  assert.equal(db.items.has("grande"), false);

  const existingDb = new MockD1([
    {
      id: "grande_existente",
      version: 4,
      json: '{"mantido":true}',
      created_at: null,
      updated_at: null,
    },
  ]);
  await assert.rejects(
    () => setJsonValue(existingDb, "grande_existente", ["valor"], replacement),
    (error) => {
      assert.equal(error.code, "RESULT_TOO_LARGE");
      assert.ok(error.details.result_bytes > MAX_JSON_BYTES);
      return true;
    },
  );
  assert.equal(existingDb.items.get("grande_existente").version, 4);
  assert.equal(existingDb.items.get("grande_existente").json, '{"mantido":true}');
});

test("setJsonValue mede resultados acima do limite rígido do D1 sem materializá-los", async () => {
  const originalJson = JSON.stringify({ mantido: "a".repeat(1_100_000) });
  const replacement = JSON.stringify("b".repeat(1_100_000));
  const db = new MockD1([
    {
      id: "intermediario_grande",
      version: 3,
      json: originalJson,
      created_at: "2026-07-12T18:00:00.000Z",
      updated_at: "2026-07-12T18:00:00.000Z",
    },
  ]);

  await assert.rejects(
    () => setJsonValue(db, "intermediario_grande", ["novo"], replacement),
    (error) => {
      assert.equal(error.code, "RESULT_TOO_LARGE");
      assert.ok(error.details.result_bytes > MAX_D1_VALUE_BYTES);
      return true;
    },
  );
  assert.equal(db.items.get("intermediario_grande").version, 3);
  assert.equal(db.items.get("intermediario_grande").json, originalJson);
});

test("mantém preflight e informa métodos aceitos", async () => {
  const db = new MockD1();
  const options = await call(db, "/qualquer/rota", { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Max-Age"), "86400");
  assert.equal(options.headers.get("Cache-Control"), null);

  const patch = await call(db, "/item", { method: "PATCH" });
  await assertError(patch, 405, "METHOD_NOT_ALLOWED");
  assert.equal(patch.headers.get("Allow"), "GET, PUT, DELETE, OPTIONS");
});
