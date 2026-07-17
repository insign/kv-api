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
    .table-wrap { margin-top: 16px; overflow-x: auto; }
    .table-wrap table { min-width: 820px; }

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
         <a href="#compatibilidade-get">Compatibilidade via GET</a>
         <a href="#atualizar-valor">Atualizar por caminho</a>
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
        <p>Crie ou substitua o documento completo com <code>PUT /:id</code>. Para alterar somente um valor, use <code>PUT /:id/value?path=...</code>. O corpo pode ser objeto, array, string, número, booleano ou <code>null</code>. Estes métodos canônicos são a opção recomendada; aliases via GET existem somente para clientes com limitação de método HTTP.</p>

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
          <div class="endpoint-head"><span class="method">PUT</span><code>/:id/value?path=&lt;JSON Pointer&gt;</code></div>
          <div class="endpoint-body"><p>Cria ou substitui um único valor no caminho indicado. Cria objetos ancestrais ausentes, trata arrays com índices explícitos e retorna o item completo atualizado.</p></div>
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

      <section id="compatibilidade-get">
        <div class="eyebrow">Restricted-client compatibility</div>
        <h2>Compatibilidade via GET</h2>
        <p>Clientes que só conseguem emitir <code>GET</code> podem transportar o comando em <code>method</code> e o valor JSON em <code>data</code>. Continue preferindo <code>PUT</code> e <code>DELETE</code> reais sempre que possível.</p>

        <div class="notice">
          <strong>GET com efeito colateral é perigoso.</strong> Prefetch, crawlers, previews, retries, caches e ferramentas de inspeção podem executar uma URL mutante sem intenção. Repetir a mesma URL executa uma nova mutação. Confirme a gravação por <code>version</code>, não pelo timestamp.
        </div>

        <h3>Contrato completo</h3>
        <pre><code># Leitura atual e alias explícito
GET /meu-id
GET /meu-id?method=GET

# Substituição completa
GET /meu-id?method=PUT&amp;data=eyJub21lIjoiQW5hIn0

# Alteração por JSON Pointer
GET /meu-id/value?method=PUT&amp;path=%2Fnome&amp;data=IkJpYSI

# Exclusão
GET /meu-id?method=DELETE

# Versão, sempre somente leitura
GET /meu-id/version</code></pre>
        <p><code>data</code> contém um valor JSON completo codificado em UTF-8 e depois em base64url canônico sem padding. <code>eyJub21lIjoiQW5hIn0</code> representa <code>{"nome":"Ana"}</code>; <code>IkJpYSI</code> representa a string JSON <code>"Bia"</code>.</p>

        <h3>Gerar data no Node.js</h3>
        <pre><code>const valor = { nome: "Ana" };
const data = Buffer.from(JSON.stringify(valor), "utf8").toString("base64url");

console.log(data); // eyJub21lIjoiQW5hIn0</code></pre>

        <h3>Gerar data no navegador</h3>
        <pre><code>function base64urlJson(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

const data = base64urlJson({ nome: "Ana" });</code></pre>

        <h3>Gramática estrita</h3>
        <ul>
          <li><code>method</code>, <code>data</code> e seus valores são case-sensitive. Aceite somente <code>GET</code>, <code>PUT</code> e <code>DELETE</code> em maiúsculas nas rotas documentadas.</li>
          <li>Em <code>GET /:id</code>, <code>method=GET</code> aceita somente <code>method</code>; <code>method=PUT</code> exige exatamente um <code>data</code>; <code>method=DELETE</code> aceita somente <code>method</code>.</li>
          <li>Em <code>GET /:id/value</code>, somente <code>method=PUT</code> é válido, com exatamente um <code>method</code>, um <code>path</code> e um <code>data</code>.</li>
          <li>Parâmetros duplicados ou não documentados são rejeitados. <code>GET /:id</code> sem o nome exato <code>method</code> continua sendo leitura e tolera queries alheias.</li>
          <li><code>method</code> só altera uma requisição cujo método HTTP real é GET. Queries com esses nomes não reinterpretam um PUT ou DELETE real.</li>
          <li><code>GET /:id/version</code> é sempre somente leitura. <code>GET /:id/value</code> sem <code>method</code> continua respondendo <code>405</code>.</li>
        </ul>

        <h3>Limites e exposição</h3>
        <ul>
          <li>O JSON decodificado de <code>data</code> aceita no máximo 10.000 bytes UTF-8; a forma codificada aceita no máximo 13.334 caracteres.</li>
          <li>A URL absoluta de um alias mutante aceita no máximo 15.000 bytes. Host, ID, nomes de parâmetros, <code>path</code> percent-encoded e <code>data</code> compartilham esse orçamento; um caminho maior deixa menos espaço para <code>data</code>.</li>
          <li>A plataforma Cloudflare aceita URLs de até 16 KB. Acima desse limite, a borda pode rejeitar a requisição antes do erro estruturado da API.</li>
          <li>PUTs canônicos continuam aceitando corpos de até 1.900.000 bytes. O limite menor existe apenas para JSON transportado na URL.</li>
          <li>Base64url é codificação, não criptografia. A URL pode aparecer em histórico, logs, analytics, proxies e referers. Não use aliases mutantes para senhas, tokens, dados pessoais ou qualquer segredo.</li>
          <li><code>Cache-Control: no-store</code> e <code>Referrer-Policy: no-referrer</code> reduzem alguns riscos, mas não impedem execução automática, histórico ou logs intermediários.</li>
        </ul>
      </section>

      <section id="atualizar-valor">
        <div class="eyebrow">Set by JSON Pointer</div>
        <h2>Atualizar um valor por caminho</h2>
        <p>Envie um único valor JSON bruto para <code>PUT /:id/value</code> e informe o endereço no parâmetro <code>path</code>. Esta operação não é JSON Patch nem JSON Merge Patch: ela cria ou substitui exatamente um valor.</p>

        <h3>Alterar uma folha existente</h3>
        <pre><code>curl -X PUT \\
  "https://kv.helio.me/config/value?path=%2Finterface%2Ftema" \\
  -H "Content-Type: application/json" \\
  -d '"escuro"'</code></pre>

        <h3>Criar ancestrais ausentes</h3>
        <pre><code>curl -X PUT \\
  "https://kv.helio.me/config/value?path=%2Fpreferencias%2Fnotificacoes%2Femail" \\
  -H "Content-Type: application/json" \\
  -d 'true'</code></pre>

        <p>Se o ID não existir, ele começa como <code>{}</code>. Objetos ausentes são criados recursivamente. Assim, <code>/items/0/name</code> em um item ausente cria chaves de objeto chamadas <code>items</code>, <code>0</code> e <code>name</code>; a API nunca infere um array a partir de um token numérico.</p>

        <h3>Objetos e arrays</h3>
        <table>
          <thead><tr><th>Situação</th><th>Comportamento</th></tr></thead>
          <tbody>
            <tr><td>Objeto</td><td>Todo token é uma chave literal, inclusive <code>0</code>, <code>-</code> e a chave vazia.</td></tr>
            <tr><td>Array existente</td><td>Use <code>0</code> ou um inteiro positivo sem zeros à esquerda. Índices existentes são substituídos.</td></tr>
            <tr><td>Índice = tamanho</td><td>Adiciona um elemento ao final. Repetir o mesmo índice substitui esse elemento, sem adicionar outro.</td></tr>
            <tr><td>Índice &gt; tamanho</td><td>Retorna <code>ARRAY_INDEX_OUT_OF_BOUNDS</code>; lacunas não são criadas.</td></tr>
            <tr><td><code>/-</code> em array</td><td>Retorna <code>INVALID_ARRAY_INDEX</code>. Append por hífen não é suportado.</td></tr>
            <tr><td>Folha escalar ou <code>null</code></td><td>Pode ser substituída normalmente.</td></tr>
            <tr><td>Ancestral escalar ou <code>null</code></td><td>Retorna <code>PATH_TYPE_CONFLICT</code>; a API não sobrescreve o bloqueador.</td></tr>
          </tbody>
        </table>

        <h3>Escaping e codificação</h3>
        <p>O caminho usa JSON Pointer. Dentro de um segmento, escreva <code>~0</code> para a chave <code>~</code> e <code>~1</code> para a chave <code>/</code>. Primeiro monte o JSON Pointer e depois codifique-o como parâmetro de URL. <code>path=</code> é proibido porque apontaria para o documento completo; <code>path=/</code> é válido e aponta para uma chave vazia.</p>
        <pre><code>const query = new URLSearchParams({ path: "/a~1b/tema" });
const response = await fetch(
  "https://kv.helio.me/config/value?" + query,
  {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify("escuro"),
  },
);</code></pre>

        <h3>Semântica e limites</h3>
        <ul>
          <li>Cada gravação aceita incrementa <code>version</code>, mesmo quando o valor final não muda.</li>
          <li>A resposta contém o item completo com timestamps e o novo valor.</li>
          <li>O caminho decodificado aceita até 4.096 bytes UTF-8 e 64 segmentos.</li>
          <li>O corpo e o documento final têm limite de 1.900.000 bytes UTF-8.</li>
          <li>O documento final aceita até 1.000 níveis aninhados de objetos e arrays, limite do parser JSON1 usado pela operação.</li>
          <li><code>PUT /:id</code> pode armazenar JSON mais profundo, mas ele precisa ser substituído por um documento de até 1.000 níveis antes de aceitar atualizações por caminho.</li>
          <li>Uma atualização por caminho pode normalizar espaços insignificantes, mas preserva literais numéricos não alterados, como <code>9007199254740993</code> e <code>1e400</code>.</li>
          <li><code>PUT /:id</code> continua preservando o texto JSON bruto e substituindo o documento completo.</li>
          <li>Não há remoção por caminho, múltiplas mutações, inserção no meio de arrays, JSON Patch, JSON Merge Patch ou precondições <code>If-Match</code>.</li>
        </ul>
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
          <div class="card"><strong>version</strong><p>Começa em 1 e aumenta a cada gravação bem-sucedida, inclusive aliases PUT via GET e valores que não mudam o resultado.</p></div>
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

        <h3>Atualizar só um valor</h3>
        <pre><code>const query = new URLSearchParams({ path: "/interface/tema" });
const updated = await fetch(
  "https://kv.helio.me/preferencias/value?" + query,
  {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify("claro"),
  },
).then((response) =&gt; response.json());</code></pre>
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
             <tr><td>Data via GET</td><td>Máximo de 10.000 bytes UTF-8 após decodificar base64url; máximo codificado de 13.334 caracteres.</td></tr>
             <tr><td>URL mutante via GET</td><td>Máximo preventivo de 15.000 bytes na URL absoluta, abaixo do limite de 16 KB da plataforma.</td></tr>
            <tr><td>Resultado</td><td>Uma mutação por caminho também deve resultar em no máximo 1.900.000 bytes UTF-8.</td></tr>
            <tr><td>JSON Pointer</td><td>Máximo de 4.096 bytes UTF-8 após decodificar a URL e 64 segmentos; o caminho raiz é proibido.</td></tr>
            <tr><td>Aninhamento por caminho</td><td>O resultado aceita no máximo 1.000 níveis de objetos e arrays, conforme o limite do JSON1.</td></tr>
            <tr><td>Atualização</td><td><code>PUT /:id</code> substitui tudo; <code>PUT /:id/value</code> cria ou substitui exatamente um valor.</td></tr>
            <tr><td>Rate limit</td><td>30 requisições por IP a cada 10 segundos.</td></tr>
             <tr><td>Cache</td><td>Respostas da API usam <code>Cache-Control: no-store</code>.</td></tr>
             <tr><td>Referer</td><td>Respostas usam <code>Referrer-Policy: no-referrer</code> como mitigação parcial para dados na URL.</td></tr>
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
        <h2>Contrato de erros</h2>
        <p>Falhas da API retornam JSON estruturado. <code>code</code> é estável para automação, <code>retryable</code> informa se repetir pode resolver o problema e <code>hint</code> sugere a próxima ação. Campos de contexto variam por código e nunca incluem o documento armazenado, <code>data</code>, seus bytes decodificados ou o JSON recebido.</p>
        <pre><code>{
  "error": "O caminho atravessa um valor que não é objeto nem array.",
  "code": "PATH_TYPE_CONFLICT",
  "retryable": false,
  "hint": "Substitua primeiro o valor bloqueador por um objeto ou use PUT /:id para substituir o documento completo.",
  "path": "/perfil/tema",
  "blocked_at": "/perfil",
  "actual_type": "string",
  "required_type": "object_or_array"
}</code></pre>

        <div class="table-wrap">
          <table>
            <thead><tr><th>Status</th><th><code>code</code></th><th>Contexto adicional</th><th>Próxima ação</th></tr></thead>
            <tbody>
              <tr><td><code>400</code></td><td><code>INVALID_ID</code></td><td><code>id</code>, <code>regra</code></td><td>Use de 1 a 100 letras ASCII, números, hífens ou sublinhados.</td></tr>
              <tr><td><code>404</code></td><td><code>INVALID_ROUTE</code></td><td><code>path</code></td><td>Consulte <code>GET /</code> e corrija a rota.</td></tr>
              <tr><td><code>404</code></td><td><code>ITEM_NOT_FOUND</code></td><td><code>id</code></td><td>Confira o ID ou crie o item com <code>PUT /:id</code>.</td></tr>
              <tr><td><code>405</code></td><td><code>METHOD_NOT_ALLOWED</code></td><td>Cabeçalho <code>Allow</code></td><td>Use um dos métodos listados em <code>Allow</code>.</td></tr>
               <tr><td><code>400</code></td><td><code>INVALID_JSON</code></td><td>Nenhum</td><td>Envie exatamente um valor JSON válido.</td></tr>
               <tr><td><code>400</code></td><td><code>INVALID_UTF8</code></td><td>Nenhum</td><td>Codifique o valor JSON como UTF-8 válido.</td></tr>
               <tr><td><code>413</code></td><td><code>PAYLOAD_TOO_LARGE</code></td><td><code>max_bytes</code> e, quando conhecido, <code>received_bytes</code></td><td>Reduza o corpo para no máximo 1.900.000 bytes.</td></tr>
               <tr><td><code>400</code></td><td><code>DUPLICATE_METHOD_PARAMETER</code></td><td><code>method_count</code></td><td>Envie exatamente um parâmetro <code>method</code>.</td></tr>
               <tr><td><code>400</code></td><td><code>INVALID_METHOD_PARAMETER</code></td><td><code>accepted_methods</code></td><td>Use somente o valor <code>method</code> documentado para a rota.</td></tr>
               <tr><td><code>400</code></td><td><code>UNEXPECTED_QUERY_PARAMETER</code></td><td><code>parameters</code>, sem valores</td><td>Remova todos os parâmetros não documentados para o comando.</td></tr>
               <tr><td><code>400</code></td><td><code>MISSING_DATA_PARAMETER</code></td><td>Nenhum</td><td>Envie exatamente um <code>data</code> com JSON UTF-8 em base64url sem padding.</td></tr>
               <tr><td><code>400</code></td><td><code>DUPLICATE_DATA_PARAMETER</code></td><td><code>data_count</code></td><td>Remova os parâmetros <code>data</code> extras.</td></tr>
               <tr><td><code>400</code></td><td><code>INVALID_DATA_ENCODING</code></td><td><code>reason</code></td><td>Use base64url canônico sem padding, whitespace ou alfabeto base64 padrão.</td></tr>
               <tr><td><code>413</code></td><td><code>QUERY_DATA_TOO_LARGE</code></td><td><code>max_bytes</code> e, quando conhecido, <code>received_bytes</code></td><td>Reduza o JSON decodificado de <code>data</code> para até 10.000 bytes.</td></tr>
               <tr><td><code>414</code></td><td><code>URI_TOO_LONG</code></td><td><code>uri_bytes</code>, <code>max_uri_bytes</code></td><td>Reduza <code>data</code>, <code>path</code> ou o tamanho total da URL.</td></tr>
              <tr><td><code>400</code></td><td><code>MISSING_PATH_PARAMETER</code></td><td>Nenhum</td><td>Envie exatamente um parâmetro <code>path</code>.</td></tr>
              <tr><td><code>400</code></td><td><code>DUPLICATE_PATH_PARAMETER</code></td><td><code>path_count</code></td><td>Remova os parâmetros <code>path</code> extras.</td></tr>
              <tr><td><code>400</code></td><td><code>INVALID_JSON_POINTER</code></td><td><code>path</code>, <code>reason</code></td><td>Comece com <code>/</code> e use somente os escapes <code>~0</code> e <code>~1</code>.</td></tr>
              <tr><td><code>400</code></td><td><code>ROOT_PATH_NOT_ALLOWED</code></td><td>Nenhum</td><td>Use <code>PUT /:id</code> para substituir o documento completo.</td></tr>
              <tr><td><code>414</code></td><td><code>PATH_TOO_LONG</code></td><td><code>path_bytes</code>, <code>max_path_bytes</code></td><td>Reduza o caminho decodificado para até 4.096 bytes UTF-8.</td></tr>
              <tr><td><code>400</code></td><td><code>PATH_TOO_DEEP</code></td><td><code>segments</code>, <code>max_segments</code></td><td>Reduza o caminho para até 64 segmentos.</td></tr>
              <tr><td><code>409</code></td><td><code>PATH_TYPE_CONFLICT</code></td><td><code>path</code>, <code>blocked_at</code>, <code>actual_type</code>, <code>required_type</code></td><td>Troque o ancestral bloqueador por objeto ou array antes da mutação.</td></tr>
              <tr><td><code>409</code></td><td><code>INVALID_ARRAY_INDEX</code></td><td><code>path</code>, <code>token</code> e regra ou limite aceito</td><td>Use índice canônico entre zero e o tamanho atual do array.</td></tr>
              <tr><td><code>409</code></td><td><code>ARRAY_INDEX_OUT_OF_BOUNDS</code></td><td><code>path</code>, <code>index</code>, <code>array_length</code></td><td>Use um índice existente ou o tamanho atual para adicionar ao final.</td></tr>
              <tr><td><code>409</code></td><td><code>AMBIGUOUS_PATH</code></td><td>Nenhum</td><td>Normalize chaves duplicadas com substituição completa.</td></tr>
              <tr><td><code>409</code></td><td><code>STORED_JSON_INVALID</code></td><td>Nenhum</td><td>Substitua o documento completo por JSON válido.</td></tr>
              <tr><td><code>409</code></td><td><code>STORED_JSON_TOO_DEEP</code></td><td><code>document_depth</code>, <code>max_depth</code></td><td>Substitua o documento completo por JSON com até 1.000 níveis.</td></tr>
              <tr><td><code>409</code></td><td><code>WRITE_CONFLICT</code></td><td><code>retryable: true</code></td><td>Leia a versão atual e tente novamente.</td></tr>
              <tr><td><code>422</code></td><td><code>RESULT_TOO_LARGE</code></td><td><code>result_bytes</code>, <code>max_bytes</code></td><td>Reduza o valor ou substitua o documento por uma versão menor.</td></tr>
              <tr><td><code>422</code></td><td><code>RESULT_TOO_DEEP</code></td><td><code>result_depth</code>, <code>max_depth</code></td><td>Reduza o resultado para até 1.000 níveis de objetos e arrays.</td></tr>
              <tr><td><code>500</code></td><td><code>STORE_FAILED</code></td><td>Nenhum</td><td>Consulte o item antes de repetir; o estado da gravação pode ser incerto.</td></tr>
            </tbody>
          </table>
        </div>

        <p>O WAF pode retornar <code>429</code> antes de a requisição chegar à API. Nesse caso, aguarde o período de bloqueio e tente novamente; o corpo não segue necessariamente o contrato estruturado acima.</p>
      </section>

      <footer>
        <strong>kv.helio.me</strong> · Cloudflare Worker + D1 · API pública, simples e sem garantias de confidencialidade.
      </footer>
    </main>
  </div>
</body>
</html>`;
