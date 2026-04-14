export type InterpolationNamespaces = Record<
  string,
  Record<string, string | number | boolean | undefined>
>;

const PLACEHOLDER = /\$\{([a-zA-Z_]\w*)\.([a-zA-Z_]\w*)\}/g;

export function interpolate(
  template: string,
  namespaces: InterpolationNamespaces,
): string {
  return template.replace(PLACEHOLDER, (_match, ns: string, key: string) => {
    const value = namespaces[ns]?.[key];
    if (value === undefined) return "";
    return String(value);
  });
}

export function interpolateArray(
  template: string[],
  namespaces: InterpolationNamespaces,
): string[] {
  return template.map((item) => interpolate(item, namespaces));
}

export function interpolateRecord(
  template: Record<string, string>,
  namespaces: InterpolationNamespaces,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(template)) {
    out[k] = interpolate(v, namespaces);
  }
  return out;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function maskSecrets(
  text: string,
  secrets: Record<string, string>,
): string {
  let result = text;
  const values = Object.values(secrets)
    .filter((v) => v.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const value of values) {
    const pattern = new RegExp(escapeRegex(value), "g");
    result = result.replace(pattern, "***");
  }
  return result;
}
