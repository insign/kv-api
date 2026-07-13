import { DOCS_HTML } from "./docs.js";

const MAX_JSON_BYTES = 1_900_000;
const VALID_ID = /^[A-Za-z0-9_-]{1,100}$/;

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
        return json(
          { error: "método não suportado" },
          { status: 405, headers: { Allow: "GET, OPTIONS" } }
        );
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
      json(
        {
          error: "id inválido",
          id,
          regra: "use de 1 a 100 caracteres: letras, números, hífen ou sublinhado",
        },
        { status: 400 }
      );

    if (parts.length === 2 && parts[1] === "version") {
      const id = parts[0];
      if (!VALID_ID.test(id)) return invalidId(id);
      if (method !== "GET") {
        return json(
          { error: "método não suportado" },
          { status: 405, headers: { Allow: "GET, OPTIONS" } }
        );
      }

      const row = await env.tasks
        .prepare("SELECT version FROM items WHERE id = ? LIMIT 1")
        .bind(id)
        .first();

      if (!row) return json({ error: "id não existe", id }, { status: 404 });
      return json({ id, version: row.version });
    }

    if (parts.length !== 1 || parts[0] === "") {
      return json({ error: "rota inválida" }, { status: 404 });
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

      if (!row) return json({ error: "id não existe", id }, { status: 404 });
      return itemJson(row);
    }

    if (method === "PUT") {
      const contentLength = request.headers.get("Content-Length");
      if (contentLength !== null && Number(contentLength) > MAX_JSON_BYTES) {
        await request.body?.cancel().catch(() => {});
        return json({ error: "JSON excede o limite de 1,9 MB" }, { status: 413 });
      }

      const body = await readBodyWithLimit(request);
      if (body === null) {
        return json({ error: "JSON excede o limite de 1,9 MB" }, { status: 413 });
      }

      let jsonStr;
      try {
        jsonStr = new TextDecoder("utf-8", { fatal: true }).decode(body);
        JSON.parse(jsonStr);
      } catch {
        return json({ error: "JSON inválido" }, { status: 400 });
      }

      const updated = await env.tasks
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
           RETURNING id, version, json, created_at, updated_at`
        )
        .bind(id, jsonStr)
        .first();

      if (!updated) {
        return json({ error: "não foi possível salvar o item" }, { status: 500 });
      }
      return itemJson(updated);
    }

    if (method === "DELETE") {
      const deleted = await env.tasks
        .prepare("DELETE FROM items WHERE id = ? RETURNING id")
        .bind(id)
        .first();

      if (!deleted) return json({ error: "id não existe", id }, { status: 404 });
      return json({ ok: true, id: deleted.id });
    }

    return json(
      { error: "método não suportado" },
      { status: 405, headers: { Allow: "GET, PUT, DELETE, OPTIONS" } }
    );
  },
};
