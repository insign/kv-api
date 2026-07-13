export const DOCS_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="Documentação da API pública de armazenamento JSON kv.helio.me">
  <title>KV.helio API</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0c0b;
      --panel: #111512;
      --panel-2: #171c18;
      --line: #2a322c;
      --text: #eef5ef;
      --muted: #a4afa6;
      --accent: #b7f34a;
      --accent-dim: #263817;
      --warning: #ffca57;
      --danger: #ff7f72;
      --code: #080a09;
      --radius: 14px;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background:
        radial-gradient(circle at 90% 4%, rgba(183, 243, 74, 0.08), transparent 27rem),
        var(--bg);
      color: var(--text);
      font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 3px; }
    code, pre, .method, .eyebrow, .brand {
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    }

    .shell {
      display: grid;
      grid-template-columns: 250px minmax(0, 1fr);
      max-width: 1280px;
      margin: 0 auto;
      min-height: 100vh;
    }

    aside {
      position: sticky;
      top: 0;
      height: 100vh;
      padding: 32px 24px;
      border-right: 1px solid var(--line);
      background: rgba(10, 12, 11, 0.88);
    }

    .brand { font-size: 18px; font-weight: 800; letter-spacing: -0.04em; }
    .brand span { color: var(--accent); }
    .version { margin-top: 8px; color: var(--muted); font-size: 12px; }
    nav { margin-top: 40px; }
    nav a {
      display: block;
      padding: 7px 0;
      color: var(--muted);
      font-size: 14px;
      text-decoration: none;
    }
    nav a:hover { color: var(--text); }

    main { width: min(100%, 920px); padding: 72px 56px 120px; }
    section { margin-top: 72px; scroll-margin-top: 28px; }
    h1, h2, h3 { line-height: 1.18; letter-spacing: -0.035em; }
    h1 { max-width: 760px; margin: 10px 0 20px; font-size: clamp(42px, 7vw, 76px); }
    h2 { margin: 0 0 22px; font-size: clamp(28px, 4vw, 40px); }
    h3 { margin: 30px 0 12px; font-size: 20px; }
    p { max-width: 760px; color: var(--muted); }

    .eyebrow {
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 0.15em;
      text-transform: uppercase;
    }

    .lead { max-width: 730px; font-size: 19px; }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      margin-top: 18px;
      padding: 8px 12px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: var(--muted);
      font-size: 13px;
    }
    .status::before {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 14px var(--accent);
      content: "";
    }

    .base-url {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-top: 34px;
      padding: 18px 20px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      overflow-x: auto;
    }
    .base-url small { color: var(--muted); white-space: nowrap; }
    .base-url code { color: var(--accent); font-size: 15px; white-space: nowrap; }

    .notice {
      margin: 28px 0;
      padding: 18px 20px;
      border: 1px solid #5b491f;
      border-left: 4px solid var(--warning);
      border-radius: var(--radius);
      background: #1d190f;
      color: #f5dfad;
    }
    .notice strong { color: var(--warning); }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .card {
      padding: 20px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
    }
    .card strong { display: block; margin-bottom: 5px; color: var(--text); }
    .card p { margin: 0; font-size: 14px; }

    .endpoint {
      margin: 18px 0;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--panel);
      overflow: hidden;
    }
    .endpoint-head {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 14px 18px;
      border-bottom: 1px solid var(--line);
      background: var(--panel-2);
    }
    .method {
      min-width: 62px;
      padding: 4px 8px;
      border-radius: 6px;
      background: var(--accent-dim);
      color: var(--accent);
      font-size: 12px;
      font-weight: 800;
      text-align: center;
    }
    .method.delete { background: #3a1d1a; color: var(--danger); }
    .endpoint-head code { color: var(--text); font-size: 14px; }
    .endpoint-body { padding: 14px 18px 18px; }
    .endpoint-body p { margin: 0; font-size: 14px; }

    pre {
      margin: 14px 0 22px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: var(--radius);
      background: var(--code);
      color: #dce6de;
      font-size: 13px;
      line-height: 1.65;
      overflow-x: auto;
      tab-size: 2;
    }
    :not(pre) > code {
      padding: 2px 5px;
      border: 1px solid var(--line);
      border-radius: 5px;
      background: var(--panel-2);
      color: #dce6de;
      font-size: 0.9em;
    }

    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 13px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; letter-spacing: 0.06em; text-transform: uppercase; }
    td:first-child { color: var(--accent); font-family: "SFMono-Regular", Consolas, monospace; }

    ul { padding-left: 22px; color: var(--muted); }
    li { margin: 7px 0; }
    footer { margin-top: 90px; padding-top: 24px; border-top: 1px solid var(--line); color: var(--muted); font-size: 13px; }

    @media (max-width: 800px) {
      .shell { display: block; }
      aside { position: static; width: 100%; height: auto; padding: 20px; border-right: 0; border-bottom: 1px solid var(--line); }
      nav { display: none; }
      main { padding: 50px 20px 80px; }
      section { margin-top: 58px; }
      .grid { grid-template-columns: 1fr; }
      .endpoint-head { align-items: flex-start; flex-wrap: wrap; }
      table { display: block; overflow-x: auto; }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand"><span>KV</span>.helio</div>
      <div class="version">API pública · v1</div>
      <nav aria-label="Navegação da documentação">
        <a href="#inicio">Visão geral</a>
        <a href="#primeiros-passos">Primeiros passos</a>
        <a href="#endpoints">Endpoints</a>
        <a href="#respostas">Respostas</a>
        <a href="#javascript">JavaScript</a>
        <a href="#regras">Regras e limites</a>
        <a href="#erros">Erros</a>
      </nav>
    </aside>

    <main>
      <header id="inicio">
        <div class="eyebrow">JSON storage at the edge</div>
        <h1>Uma API mínima para guardar qualquer JSON.</h1>
        <p class="lead">Use um identificador como chave, envie um valor JSON e recupere-o de qualquer cliente HTTP. Cada alteração recebe uma versão e timestamps automáticos.</p>
        <div class="status">Serviço disponível</div>
        <div class="base-url">
          <small>Base URL</small>
          <code>https://kv.helio.me</code>
        </div>
      </header>

      <div class="notice">
        <strong>API pública e sem autenticação.</strong> Quem conhecer um ID poderá ler, substituir ou apagar seu conteúdo. Não armazene senhas, tokens, dados pessoais ou qualquer informação confidencial.
      </div>

      <section id="primeiros-passos">
        <div class="eyebrow">Quick start</div>
        <h2>Primeiros passos</h2>
        <p>Crie ou substitua um valor com <code>PUT</code>. O corpo pode ser objeto, array, string, número, booleano ou <code>null</code>.</p>

        <h3>1. Salvar</h3>
        <pre><code>curl -X PUT https://kv.helio.me/minha_tarefa \\
  -H "Content-Type: application/json" \\
  -d '{"titulo":"Comprar café","feito":false}'</code></pre>

        <h3>2. Consultar</h3>
        <pre><code>curl https://kv.helio.me/minha_tarefa</code></pre>

        <h3>3. Apagar</h3>
        <pre><code>curl -X DELETE https://kv.helio.me/minha_tarefa</code></pre>
      </section>

      <section id="endpoints">
        <div class="eyebrow">HTTP reference</div>
        <h2>Endpoints</h2>

        <article class="endpoint">
          <div class="endpoint-head"><span class="method">GET</span><code>/:id</code></div>
          <div class="endpoint-body"><p>Retorna o valor atual, sua versão e os timestamps. Responde <code>404</code> quando o ID não existe.</p></div>
        </article>

        <article class="endpoint">
          <div class="endpoint-head"><span class="method">GET</span><code>/:id/version</code></div>
          <div class="endpoint-body"><p>Retorna somente <code>id</code> e <code>version</code>. Útil para verificar mudanças sem baixar o valor completo.</p></div>
        </article>

        <article class="endpoint">
          <div class="endpoint-head"><span class="method">PUT</span><code>/:id</code></div>
          <div class="endpoint-body"><p>Cria o ID com versão 1 ou substitui completamente o valor existente e incrementa a versão. Não faz merge de objetos.</p></div>
        </article>

        <article class="endpoint">
          <div class="endpoint-head"><span class="method delete">DELETE</span><code>/:id</code></div>
          <div class="endpoint-body"><p>Apaga definitivamente o item. Se ele for recriado depois, começará novamente na versão 1.</p></div>
        </article>

        <article class="endpoint">
          <div class="endpoint-head"><span class="method">OPTIONS</span><code>qualquer caminho</code></div>
          <div class="endpoint-body"><p>Responde ao preflight CORS. São permitidos os headers <code>Content-Type</code>, <code>Authorization</code>, <code>If-None-Match</code> e <code>If-Match</code>.</p></div>
        </article>
      </section>

      <section id="respostas">
        <div class="eyebrow">Data model</div>
        <h2>Formato das respostas</h2>
        <p>Uma criação ou consulta retorna o envelope abaixo. O campo <code>json</code> contém exatamente o tipo de valor enviado.</p>
        <pre><code>{
  "id": "minha_tarefa",
  "version": 1,
  "created_at": "2026-07-12T22:32:19.374Z",
  "updated_at": "2026-07-12T22:32:19.374Z",
  "json": {
    "titulo": "Comprar café",
    "feito": false
  }
}</code></pre>

        <div class="grid">
          <div class="card"><strong>version</strong><p>Começa em 1 e aumenta a cada <code>PUT</code> bem-sucedido, mesmo quando o valor enviado é igual.</p></div>
          <div class="card"><strong>created_at</strong><p>Instante UTC da criação. Registros antigos podem retornar <code>null</code>.</p></div>
          <div class="card"><strong>updated_at</strong><p>Instante UTC da última gravação. Na criação, é igual a <code>created_at</code>. Registros antigos ainda não atualizados podem retornar <code>null</code>.</p></div>
          <div class="card"><strong>json</strong><p>Qualquer valor JSON válido, sem campos obrigatórios como <code>feito</code>.</p></div>
        </div>

        <h3>Consulta de versão</h3>
        <pre><code>{
  "id": "minha_tarefa",
  "version": 1
}</code></pre>

        <h3>Exclusão</h3>
        <pre><code>{
  "ok": true,
  "id": "minha_tarefa"
}</code></pre>
      </section>

      <section id="javascript">
        <div class="eyebrow">Browser & Node.js</div>
        <h2>Uso com JavaScript</h2>
        <p>A API aceita CORS de qualquer origem e pode ser chamada diretamente pelo navegador.</p>

        <h3>Salvar um valor</h3>
        <pre><code>const response = await fetch("https://kv.helio.me/preferencias", {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ tema: "escuro", idioma: "pt-BR" }),
});

if (!response.ok) throw new Error("Falha ao salvar");
const item = await response.json();
console.log(item.version);</code></pre>

        <h3>Consultar um valor</h3>
        <pre><code>const response = await fetch("https://kv.helio.me/preferencias");

if (response.status === 404) {
  console.log("O ID ainda não existe");
} else if (response.ok) {
  const item = await response.json();
  console.log(item.json);
}</code></pre>
      </section>

      <section id="regras">
        <div class="eyebrow">Constraints</div>
        <h2>Regras e limites</h2>
        <table>
          <thead><tr><th>Regra</th><th>Valor</th></tr></thead>
          <tbody>
            <tr><td>ID</td><td>De 1 a 100 caracteres: letras ASCII, números, hífen e sublinhado.</td></tr>
            <tr><td>Expressão</td><td><code>^[A-Za-z0-9_-]{1,100}$</code></td></tr>
            <tr><td>Payload</td><td>Máximo de 1.900.000 bytes em UTF-8.</td></tr>
            <tr><td>Rate limit</td><td>30 requisições por IP a cada 10 segundos.</td></tr>
            <tr><td>Cache</td><td>Respostas da API usam <code>Cache-Control: no-store</code>.</td></tr>
            <tr><td>CORS</td><td>Qualquer origem pode chamar a API; <code>OPTIONS</code> responde ao preflight.</td></tr>
            <tr><td>Autenticação</td><td>Nenhuma.</td></tr>
          </tbody>
        </table>

        <h3>Exemplos de IDs válidos</h3>
        <pre><code>tarefa_1
config-app
usuario123
01J2Y8N7R6K5M4</code></pre>

        <h3>IDs inválidos</h3>
        <pre><code>minha tarefa   # espaço
perfil.json    # ponto
ação           # caracteres fora de ASCII
pasta/item     # barra cria outro segmento de rota</code></pre>
      </section>

      <section id="erros">
        <div class="eyebrow">Failures</div>
        <h2>Erros</h2>
        <table>
          <thead><tr><th>Status</th><th>Significado</th></tr></thead>
          <tbody>
            <tr><td>400</td><td>ID fora do formato permitido ou corpo JSON inválido.</td></tr>
            <tr><td>404</td><td>Rota inválida ou ID inexistente.</td></tr>
            <tr><td>405</td><td>Método HTTP não suportado.</td></tr>
            <tr><td>413</td><td>Corpo maior que 1.900.000 bytes.</td></tr>
            <tr><td>429</td><td>Limite de requisições excedido; tente novamente após alguns segundos.</td></tr>
            <tr><td>500</td><td>Falha interna ao persistir o item.</td></tr>
          </tbody>
        </table>

        <h3>Exemplo de ID inexistente</h3>
        <pre><code>{
  "error": "id não existe",
  "id": "minha_tarefa"
}</code></pre>
      </section>

      <footer>
        <strong>kv.helio.me</strong> · Cloudflare Worker + D1 · API pública, simples e sem garantias de confidencialidade.
      </footer>
    </main>
  </div>
</body>
</html>`;
