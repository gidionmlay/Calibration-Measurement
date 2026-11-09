/**
 * Pure TypeScript cryptographic hashing utilities.
 * Implements deterministic SHA-256 (FIPS 180-4) without external dependencies,
 * ensuring identical synchronous hashing across Node.js, Vitest, and browser environments.
 */

// Initial hash values (first 32 bits of the fractional parts of the square roots of the first 8 primes)
const H = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

// Round constants (first 32 bits of the fractional parts of the cube roots of the first 64 primes)
const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(n: number, x: number): number {
  return (x >>> n) | (x << (32 - n));
}

function ch(x: number, y: number, z: number): number {
  return (x & y) ^ (~x & z);
}

function maj(x: number, y: number, z: number): number {
  return (x & y) ^ (x & z) ^ (y & z);
}

function sigma0(x: number): number {
  return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
}

function sigma1(x: number): number {
  return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
}

function gamma0(x: number): number {
  return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
}

function gamma1(x: number): number {
  return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
}

/**
 * Computes standard cryptographic SHA-256 hash (FIPS 180-4) of a string.
 * Returns a 64-character lowercase hexadecimal digest.
 */
export function sha256(ascii: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(ascii);
  const bitLength = bytes.length * 8;

  // Pre-processing: padding
  const paddingLength = (bytes.length % 64 < 56)
    ? 56 - (bytes.length % 64)
    : 120 - (bytes.length % 64);

  const totalLength = bytes.length + paddingLength + 8;
  const padded = new Uint8Array(totalLength);
  padded.set(bytes, 0);
  padded[bytes.length] = 0x80;

  // Append original length in bits as 64-bit big-endian integer
  const view = new DataView(padded.buffer);
  // High 32 bits
  view.setUint32(totalLength - 8, Math.floor(bitLength / 0x100000000), false);
  // Low 32 bits
  view.setUint32(totalLength - 4, bitLength >>> 0, false);

  // Initialize working variables
  const h = [...H];
  const w = new Uint32Array(64);

  // Process message in 512-bit (64-byte) blocks
  for (let offset = 0; offset < totalLength; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = gamma0(w[i - 15]);
      const s1 = gamma1(w[i - 2]);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hVal = h[7];

    for (let i = 0; i < 64; i++) {
      const s1 = sigma1(e);
      const chVal = ch(e, f, g);
      const temp1 = (hVal + s1 + chVal + K[i] + w[i]) >>> 0;
      const s0 = sigma0(a);
      const majVal = maj(a, b, c);
      const temp2 = (s0 + majVal) >>> 0;

      hVal = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hVal) >>> 0;
  }

  return h.map((val) => val.toString(16).padStart(8, '0')).join('');
}

