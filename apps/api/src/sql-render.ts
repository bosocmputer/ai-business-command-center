export type QueryConfigLike = {
  text: string;
  values?: readonly unknown[];
};

export function renderParameterizedSqlForJavaWs(query: QueryConfigLike) {
  const values = query.values ?? [];
  const highestPlaceholder = findHighestPlaceholderIndex(query.text);
  if (highestPlaceholder > values.length) {
    throw new Error("SQL render rejected because a placeholder has no value.");
  }

  return query.text.replace(/\$(\d+)(?!\d)/g, (_match, rawIndex: string) => {
    const index = Number(rawIndex);
    if (!Number.isInteger(index) || index < 1 || index > values.length) {
      throw new Error("SQL render rejected because a placeholder is invalid.");
    }
    return toPostgresLiteral(values[index - 1]);
  });
}

function findHighestPlaceholderIndex(text: string) {
  let highest = 0;
  for (const match of text.matchAll(/\$(\d+)(?!\d)/g)) {
    highest = Math.max(highest, Number(match[1]));
  }
  return highest;
}

function toPostgresLiteral(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("SQL render rejected because a number is not finite.");
    }
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  }

  throw new Error("SQL render rejected because a parameter type is unsupported.");
}
