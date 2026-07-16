import assert from "node:assert/strict";
import test from "node:test";

import {
  JsonPathError,
  MAX_POINTER_BYTES,
  MAX_POINTER_SEGMENTS,
  parseJsonPointer,
  planJsonSetPath,
  sqliteObjectSegment,
} from "../src/json-path.js";

function parse(query) {
  return parseJsonPointer(new URLSearchParams(query));
}

function expectCode(code, callback) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof JsonPathError);
    assert.equal(error.code, code);
    assert.ok(error.message);
    assert.ok(error.hint);
    return true;
  });
}

test("parseJsonPointer decodes RFC 6901 tokens and preserves literal keys", () => {
  assert.deepEqual(parse("path=%2Fperfil%2Ftema"), {
    pointer: "/perfil/tema",
    tokens: ["perfil", "tema"],
  });
  assert.deepEqual(parse("path=%2Fa~1b%2Fm~0n%2F%2F-%2F0"), {
    pointer: "/a~1b/m~0n//-/0",
    tokens: ["a/b", "m~n", "", "-", "0"],
  });
  assert.deepEqual(parse("path=%2F"), { pointer: "/", tokens: [""] });
  assert.deepEqual(parse("path=%2F%C3%A9%2Fa.b%2Fa%5Bb%5D%2Fa%22b%2Fa%5Cb"), {
    pointer: '/é/a.b/a[b]/a"b/a\\b',
    tokens: ["é", "a.b", "a[b]", 'a"b', "a\\b"],
  });
});

test("parseJsonPointer rejects missing, duplicate, root, and malformed paths", () => {
  expectCode("MISSING_PATH_PARAMETER", () => parse(""));
  expectCode("DUPLICATE_PATH_PARAMETER", () => parse("path=%2Fa&path=%2Fb"));
  expectCode("ROOT_PATH_NOT_ALLOWED", () => parse("path="));
  expectCode("INVALID_JSON_POINTER", () => parse("path=perfil"));
  expectCode("INVALID_JSON_POINTER", () => parse("path=%2Fa~"));
  expectCode("INVALID_JSON_POINTER", () => parse("path=%2Fa~2b"));

  assert.throws(
    () => parse(`path=${"x".repeat(10_000)}`),
    (error) => {
      assert.equal(error.code, "INVALID_JSON_POINTER");
      assert.equal(error.details.path.length, 512);
      return true;
    },
  );
});

test("parseJsonPointer enforces decoded UTF-8 byte and segment limits", () => {
  const maxPointer = `/${"a".repeat(MAX_POINTER_BYTES - 1)}`;
  assert.equal(parse(`path=${encodeURIComponent(maxPointer)}`).pointer, maxPointer);

  const longPointer = `/${"a".repeat(MAX_POINTER_BYTES)}`;
  expectCode("PATH_TOO_LONG", () =>
    parse(`path=${encodeURIComponent(longPointer)}`),
  );

  const maxDepth = `/${Array(MAX_POINTER_SEGMENTS).fill("a").join("/")}`;
  assert.equal(
    parse(`path=${encodeURIComponent(maxDepth)}`).tokens.length,
    MAX_POINTER_SEGMENTS,
  );

  const tooDeep = `/${Array(MAX_POINTER_SEGMENTS + 1).fill("a").join("/")}`;
  expectCode("PATH_TOO_DEEP", () =>
    parse(`path=${encodeURIComponent(tooDeep)}`),
  );
});

test("sqliteObjectSegment always quotes object labels", () => {
  assert.equal(sqliteObjectSegment("a.b"), '."a.b"');
  assert.equal(sqliteObjectSegment(""), '.""');
  assert.equal(sqliteObjectSegment('a"b\\c'), '."a\\"b\\\\c"');
});

test("planJsonSetPath traverses objects and creates missing object chains", () => {
  assert.deepEqual(planJsonSetPath({ perfil: { tema: "claro" } }, ["perfil", "tema"]), {
    sqlitePath: '$."perfil"."tema"',
    createsObjectChain: false,
  });
  assert.deepEqual(planJsonSetPath({}, ["items", "0", "name"]), {
    sqlitePath: '$."items"."0"."name"',
    createsObjectChain: true,
  });
  assert.deepEqual(planJsonSetPath({ items: {} }, ["items", "-", ""]), {
    sqlitePath: '$."items"."-".""',
    createsObjectChain: true,
  });
  assert.deepEqual(planJsonSetPath({ "": null }, [""]), {
    sqlitePath: '$.""',
    createsObjectChain: false,
  });
});

test("planJsonSetPath replaces final scalars and rejects scalar ancestors", () => {
  assert.deepEqual(planJsonSetPath({ value: null }, ["value"]), {
    sqlitePath: '$."value"',
    createsObjectChain: false,
  });
  assert.deepEqual(planJsonSetPath({ value: 1 }, ["value"]), {
    sqlitePath: '$."value"',
    createsObjectChain: false,
  });

  assert.throws(
    () => planJsonSetPath({ value: null }, ["value", "nested"]),
    (error) => {
      assert.equal(error.code, "PATH_TYPE_CONFLICT");
      assert.deepEqual(error.details, {
        blocked_at: "/value",
        actual_type: "null",
        required_type: "object_or_array",
      });
      return true;
    },
  );
  assert.throws(
    () => planJsonSetPath("scalar", ["nested"]),
    (error) => {
      assert.equal(error.code, "PATH_TYPE_CONFLICT");
      assert.equal(error.details.blocked_at, "");
      assert.equal(error.details.actual_type, "string");
      return true;
    },
  );
});

test("planJsonSetPath addresses existing arrays and appends at their length", () => {
  assert.deepEqual(planJsonSetPath({ values: [1, { name: "old" }] }, ["values", "1", "name"]), {
    sqlitePath: '$."values"[1]."name"',
    createsObjectChain: false,
  });
  assert.deepEqual(planJsonSetPath({ values: [1] }, ["values", "1"]), {
    sqlitePath: '$."values"[1]',
    createsObjectChain: false,
    appendsArrayElement: true,
  });
  assert.deepEqual(planJsonSetPath({ values: [] }, ["values", "0", "name"]), {
    sqlitePath: '$."values"[0]."name"',
    createsObjectChain: true,
    appendsArrayElement: true,
  });
});

test("planJsonSetPath rejects invalid, unsafe, and out-of-bounds array indices", () => {
  for (const token of ["-", "-1", "01", "1.0", "x"]) {
    expectCode("INVALID_ARRAY_INDEX", () =>
      planJsonSetPath({ values: [] }, ["values", token]),
    );
  }
  expectCode("INVALID_ARRAY_INDEX", () =>
    planJsonSetPath({ values: [] }, ["values", "9007199254740992"]),
  );

  assert.throws(
    () => planJsonSetPath({ values: [1] }, ["values", "2"]),
    (error) => {
      assert.equal(error.code, "ARRAY_INDEX_OUT_OF_BOUNDS");
      assert.equal(error.details.index, 2);
      assert.equal(error.details.array_length, 1);
      return true;
    },
  );
});

test("planJsonSetPath reports array element blockers at their pointer", () => {
  assert.throws(
    () => planJsonSetPath({ values: [null] }, ["values", "0", "name"]),
    (error) => {
      assert.equal(error.code, "PATH_TYPE_CONFLICT");
      assert.equal(error.details.blocked_at, "/values/0");
      assert.equal(error.details.actual_type, "null");
      return true;
    },
  );
});
