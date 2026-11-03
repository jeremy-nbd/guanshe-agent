export function parseJsonObject<T>(content: string): T {
  const trimmed = content.trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const extracted = extractJsonObject(trimmed);

    if (!extracted) {
      throw new Error("Response does not contain a JSON object");
    }

    return JSON.parse(extracted) as T;
  }
}

function extractJsonObject(content: string) {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return content.slice(start, end + 1);
}
