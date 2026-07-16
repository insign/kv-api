export const MAX_POINTER_BYTES = 4096;
export const MAX_POINTER_SEGMENTS = 64;

const ARRAY_INDEX_PATTERN = /^(0|[1-9][0-9]*)$/;
const MAX_SAFE_ARRAY_INDEX = BigInt(Number.MAX_SAFE_INTEGER);

export class JsonPathError extends Error {
  constructor(code, message, hint, details = {}) {
    super(message);
    this.name = "JsonPathError";
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}

function pointerFor(tokens) {
  return tokens
    .map((token) => `/${token.replaceAll("~", "~0").replaceAll("/", "~1")}`)
    .join("");
}

function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value === "object" ? "object" : typeof value;
}

function typeConflict(tokens, value) {
  const blockedAt = pointerFor(tokens);
  return new JsonPathError(
    "PATH_TYPE_CONFLICT",
    "O caminho atravessa um valor que não é objeto nem array.",
    "Substitua primeiro o valor bloqueador por um objeto ou use PUT /:id para substituir o documento completo.",
    {
      blocked_at: blockedAt,
      actual_type: jsonType(value),
      required_type: "object_or_array",
    },
  );
}

export function parseJsonPointer(searchParams) {
  const values = searchParams.getAll("path");

  if (values.length === 0) {
    throw new JsonPathError(
      "MISSING_PATH_PARAMETER",
      "O parâmetro path é obrigatório.",
      "Envie exatamente um parâmetro path contendo um JSON Pointer, por exemplo /perfil/tema.",
    );
  }

  if (values.length > 1) {
    throw new JsonPathError(
      "DUPLICATE_PATH_PARAMETER",
      "O parâmetro path foi enviado mais de uma vez.",
      "Envie exatamente um parâmetro path.",
      { path_count: values.length },
    );
  }

  const pointer = values[0];
  if (pointer === "") {
    throw new JsonPathError(
      "ROOT_PATH_NOT_ALLOWED",
      "O caminho raiz não pode ser alterado por esta rota.",
      "Use PUT /:id para substituir o documento completo.",
    );
  }

  if (!pointer.startsWith("/")) {
    throw new JsonPathError(
      "INVALID_JSON_POINTER",
      "O parâmetro path não é um JSON Pointer válido.",
      "Inicie o caminho com / e escape ~ como ~0 e / como ~1 dentro de cada segmento.",
      { path: pointer, reason: "missing_leading_slash" },
    );
  }

  const pathBytes = new TextEncoder().encode(pointer).byteLength;
  if (pathBytes > MAX_POINTER_BYTES) {
    throw new JsonPathError(
      "PATH_TOO_LONG",
      "O caminho excede o limite de tamanho.",
      `Reduza o caminho para no máximo ${MAX_POINTER_BYTES} bytes UTF-8 após a decodificação da URL.`,
      { path_bytes: pathBytes, max_path_bytes: MAX_POINTER_BYTES },
    );
  }

  const encodedTokens = pointer.slice(1).split("/");
  if (encodedTokens.length > MAX_POINTER_SEGMENTS) {
    throw new JsonPathError(
      "PATH_TOO_DEEP",
      "O caminho excede o limite de segmentos.",
      `Reduza o caminho para no máximo ${MAX_POINTER_SEGMENTS} segmentos.`,
      { segments: encodedTokens.length, max_segments: MAX_POINTER_SEGMENTS },
    );
  }

  const tokens = encodedTokens.map((token) => {
    if (/~(?:[^01]|$)/.test(token)) {
      throw new JsonPathError(
        "INVALID_JSON_POINTER",
        "O parâmetro path contém um escape JSON Pointer inválido.",
        "Use somente ~0 para representar ~ e ~1 para representar / dentro de um segmento.",
        { path: pointer, reason: "invalid_tilde_escape" },
      );
    }

    return token.replaceAll("~1", "/").replaceAll("~0", "~");
  });

  return { pointer, tokens };
}

export function sqliteObjectSegment(token) {
  return `.${JSON.stringify(token)}`;
}

export function planJsonSetPath(currentValue, tokens) {
  if (tokens.length === 0) {
    throw new JsonPathError(
      "ROOT_PATH_NOT_ALLOWED",
      "O caminho raiz não pode ser alterado por esta rota.",
      "Use PUT /:id para substituir o documento completo.",
    );
  }

  if (currentValue === null || typeof currentValue !== "object") {
    throw typeConflict([], currentValue);
  }

  let current = currentValue;
  let sqlitePath = "$";

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const isFinal = index === tokens.length - 1;

    if (!Array.isArray(current)) {
      sqlitePath += sqliteObjectSegment(token);
      if (isFinal) return { sqlitePath, createsObjectChain: false };

      if (!Object.hasOwn(current, token)) {
        for (let rest = index + 1; rest < tokens.length; rest += 1) {
          sqlitePath += sqliteObjectSegment(tokens[rest]);
        }
        return { sqlitePath, createsObjectChain: true };
      }

      const child = current[token];
      if (child === null || typeof child !== "object") {
        throw typeConflict(tokens.slice(0, index + 1), child);
      }
      current = child;
      continue;
    }

    if (!ARRAY_INDEX_PATTERN.test(token)) {
      throw new JsonPathError(
        "INVALID_ARRAY_INDEX",
        "O caminho contém um índice de array inválido.",
        "Use 0 ou um inteiro positivo sem zeros à esquerda; use o tamanho atual do array para adicionar ao final.",
        { token, accepted_index_pattern: "0|[1-9][0-9]*" },
      );
    }

    const bigIndex = BigInt(token);
    if (bigIndex > MAX_SAFE_ARRAY_INDEX) {
      throw new JsonPathError(
        "INVALID_ARRAY_INDEX",
        "O índice do array excede o maior inteiro seguro.",
        `Use um índice entre 0 e ${Number.MAX_SAFE_INTEGER}.`,
        { token, max_safe_index: Number.MAX_SAFE_INTEGER },
      );
    }

    const arrayIndex = Number(bigIndex);
    sqlitePath += `[${arrayIndex}]`;

    if (arrayIndex > current.length) {
      throw new JsonPathError(
        "ARRAY_INDEX_OUT_OF_BOUNDS",
        "O índice criaria uma lacuna no array.",
        `Use um índice entre 0 e ${current.length}; o índice ${current.length} adiciona ao final.`,
        { index: arrayIndex, array_length: current.length },
      );
    }

    if (arrayIndex === current.length) {
      for (let rest = index + 1; rest < tokens.length; rest += 1) {
        sqlitePath += sqliteObjectSegment(tokens[rest]);
      }
      return {
        sqlitePath,
        createsObjectChain: !isFinal,
        appendsArrayElement: true,
      };
    }

    if (isFinal) {
      return { sqlitePath, createsObjectChain: false };
    }

    const child = current[arrayIndex];
    if (child === null || typeof child !== "object") {
      throw typeConflict(tokens.slice(0, index + 1), child);
    }
    current = child;
  }
}
