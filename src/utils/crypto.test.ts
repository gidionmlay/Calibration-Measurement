import { describe, it, expect } from 'vitest';
import { sha256 } from './crypto';

describe('SHA-256 Cryptographic Verification Vectors', () => {
  it('computes exact hash for empty string (FIPS 180-4 standard)', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('computes exact hash for "abc" (standard NIST test vector)', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('computes exact hash for "test"', () => {
    expect(sha256('test')).toBe('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08');
  });

  it('computes exact hash for multi-block messages (> 64 bytes)', () => {
    const longMessage = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(sha256(longMessage)).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

