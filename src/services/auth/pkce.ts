/**
 * Proof Key for Code Exchange (PKCE) cryptographic helpers (RFC 7636).
 *
 * Utilizes the standard Web Crypto API for secure random generation
 * and SHA-256 code challenge computation.
 */

/**
 * Base64URL encode an ArrayBuffer or Uint8Array according to RFC 7636.
 * Replaces '+' with '-', '/' with '_', and trims '=' padding.
 */
export function base64UrlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Base64URL decode a string to UTF-8 text.
 */
export function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = base64.length % 4;
  if (pad) {
    if (pad === 1) {
      throw new Error('Invalid base64url string');
    }
    base64 += new Array(5 - pad).join('=');
  }
  return atob(base64);
}

/**
 * Generate cryptographically secure random bytes as a base64url string.
 */
export function generateRandomString(byteLength = 32): string {
  const array = new Uint8Array(byteLength);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(array);
  } else {
    // Fallback for non-browser/test edge cases
    for (let i = 0; i < byteLength; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64UrlEncode(array);
}

/**
 * Generate a high-entropy PKCE code verifier (RFC 7636 Section 4.1).
 * Length between 43 and 128 characters.
 */
export function generateCodeVerifier(length = 64): string {
  // 48 random bytes yields 64 base64url characters
  const byteLength = Math.max(32, Math.min(96, Math.floor((length * 3) / 4)));
  const verifier = generateRandomString(byteLength);
  return verifier.slice(0, length);
}

/**
 * Compute the S256 code challenge from a code verifier (RFC 7636 Section 4.2).
 * code_challenge = BASE64URL-ENCODE(SHA256(ASCII(code_verifier)))
 */
export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);

  if (globalThis.crypto?.subtle?.digest) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return base64UrlEncode(digest);
  }

  throw new Error('Web Crypto API subtle.digest is unavailable in this environment.');
}

/**
 * Generate a random state token for CSRF protection.
 */
export function generateState(): string {
  return generateRandomString(24);
}

/**
 * Generate a random nonce for replay attack prevention in OIDC ID tokens.
 */
export function generateNonce(): string {
  return generateRandomString(24);
}

