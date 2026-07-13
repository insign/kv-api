import assert from "node:assert/strict";
import test from "node:test";

import worker from "../src/worker.js";

const MAX_JSON_BYTES = 1_900_000;

class MockD1 {
  constructor(items = []) {
    this.items = new Map(items.map((item) => [item.id, { ...item }]));
    this.clock = Date.parse("2026-07-12T20:00:00.000Z");
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        first: async () => {
          if (sql.startsWith("SELECT version")) {
            const item = this.items.get(args[0]);
            return item ? { version: item.version } : null;
          }

          if (sql.startsWith("SELECT id, version")) {
            return this.items.get(args[0]) ?? null;
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
        },
      }),
    };
  }
}

const call = (db, path, init = {}) =>
  worker.fetch(new Request(`https://kv.helio.me${path}`, init), { tasks: db });

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

  assert.equal(root.status, 405);
  assert.equal(root.headers.get("Allow"), "GET, OPTIONS");
  assert.equal(version.status, 405);
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
  assert.equal((await call(db, "/tarefa_1", { method: "DELETE" })).status, 404);
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
  assert.equal((await call(db, "/id.invalido")).status, 400);
  assert.equal((await call(db, "/invalido", { method: "PUT", body: "{" })).status, 400);

  const invalidUtf8 = new Uint8Array([0x22, 0xff, 0x22]);
  assert.equal(
    (await call(db, "/utf8", { method: "PUT", body: invalidUtf8 })).status,
    400
  );
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
});

test("mantém preflight e informa métodos aceitos", async () => {
  const db = new MockD1();
  const options = await call(db, "/qualquer/rota", { method: "OPTIONS" });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("Access-Control-Max-Age"), "86400");
  assert.equal(options.headers.get("Cache-Control"), null);

  const patch = await call(db, "/item", { method: "PATCH" });
  assert.equal(patch.status, 405);
  assert.equal(patch.headers.get("Allow"), "GET, PUT, DELETE, OPTIONS");
});
