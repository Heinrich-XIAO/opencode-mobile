const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), '=');

  if (typeof globalThis.atob === 'function') {
    return globalThis.atob(padded);
  }

  const buffer = (globalThis as any).Buffer as
    | { from: (input: string, encoding: string) => { toString: (enc: string) => string } }
    | undefined;
  if (buffer) {
    return buffer.from(padded, 'base64').toString('utf-8');
  }

  return null;
}

export function getJwtExpiry(jwt?: string | null): number | null {
  if (!jwt) return null;
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;

  const payload = decodeBase64Url(parts[1]);
  if (!payload) return null;

  try {
    const parsed = JSON.parse(payload) as { exp?: number };
    if (!parsed.exp) return null;
    return parsed.exp * 1000;
  } catch {
    return null;
  }
}

export function isJwtExpired(jwt?: string | null): boolean {
  const expiry = getJwtExpiry(jwt);
  if (!expiry) return false;
  return Date.now() >= expiry;
}

export function isJwtExpiringSoon(jwt?: string | null, bufferMs = EXPIRY_BUFFER_MS): boolean {
  const expiry = getJwtExpiry(jwt);
  if (!expiry) return false;
  return Date.now() >= expiry - bufferMs;
}
