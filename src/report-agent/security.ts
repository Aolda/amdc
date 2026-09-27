/** PRD 03 minimum markers. Entropy alone never identifies a secret. */
const credentialMarkers: readonly RegExp[] = [
  /\bauthorization\b["']?\s*[:=]\s*["']?\s*[^\s"'{}\[\],;]+/i,
  /\b(?:set-cookie|cookie)\b["']?\s*[:=]\s*["']?\s*[^\s"'{}\[\],;]+/i,
  /\bbearer\s+[a-z0-9._~+\/-]{8,}={0,2}/i,
  /(?<![a-z0-9])(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|token|password|passwd|pwd|client[_ -]?secret|private[_ -]?key|secret[_ -]?key|secret)\b["']?\s*[:=]\s*["']?\s*[^\s"'{}\[\],;]+/i,
  /-----BEGIN [A-Z0-9 ]{1,64}-----/,
  /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s\/@]+@/i,
  /[?&](?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|password|passwd|pwd|client[_-]?secret|secret|signature|sig|x-amz-signature|x-goog-signature)\s*=[^\s&#]+/i,
  /\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_|xox[baprs]-|xoxe-)[A-Za-z0-9_-]{8,}/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bAIza[A-Za-z0-9_-]{30,}\b/,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{8,}\b/
];

/**
 * Callers inject known loaded secrets. This module never reads process.env,
 * credential files, or providers, and returns neither values nor fingerprints.
 */
export function createSecretDetector(
  knownSecrets: readonly string[] = []
): (value: string) => boolean {
  const secrets = [...new Set(knownSecrets.filter((secret) => secret.length >= 8))];
  return (value: string): boolean => {
    // Scan the original before URL decoding; encoded query names are credentials too.
    let candidate = value;
    for (let pass = 0; pass < 3; pass += 1) {
      if (secrets.some((secret) => candidate.includes(secret)) ||
          credentialMarkers.some((marker) => marker.test(candidate))) {
        return true;
      }
      try {
        const decoded = candidate.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
          try { return decodeURIComponent(encoded); } catch { return encoded; }
        });
        if (decoded === candidate) break;
        candidate = decoded;
      } catch {
        break;
      }
    }
    return false;
  };
}

