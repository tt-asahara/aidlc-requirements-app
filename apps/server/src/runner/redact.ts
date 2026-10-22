import { sanitizeDiagnostic } from "../workspace/command.ts";

const sensitiveKeys =
  /(?:api[_-]?key|access[_-]?key|secret|password|authorization|credential|(?:^|_)token$|accessToken|sessionToken)/i;
/** Redact before persistence AND presentation. Values are never printed while constructing this filter. */
export function makeRedactor(env: Record<string, string | undefined>) {
  const values = Object.entries(env)
    .filter(
      ([key, value]) => sensitiveKeys.test(key) && value && value.length >= 4,
    )
    .flatMap(([, value]) => [
      value as string,
      ...(value as string).split(/[\r\n]+/).filter((part) => part.length >= 4),
    ])
    .sort((a, b) => b.length - a.length);
  const redact = (text: string): string => {
    for (const secret of values) text = text.split(secret).join("[REDACTED]");
    return sanitizeDiagnostic(text);
  };
  const value = (input: unknown): unknown => {
    if (typeof input === "string") return redact(input);
    if (Array.isArray(input)) return input.map(value);
    if (input && typeof input === "object") {
      const block = input as Record<string, unknown>;
      if (
        block.type === "image" &&
        block.source &&
        typeof block.source === "object"
      ) {
        const source = block.source as Record<string, unknown>;
        if (source.type === "base64")
          return {
            type: "image",
            source: {
              type: "base64",
              media_type: source.media_type,
              data: "[IMAGE BYTES OMITTED]",
            },
          };
      }
      return Object.fromEntries(
        Object.entries(input).map(([key, entry]) => [
          key,
          sensitiveKeys.test(key) ? "[REDACTED]" : value(entry),
        ]),
      );
    }
    return input;
  };
  return { text: redact, value };
}
