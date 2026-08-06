import crypto from 'crypto';

const ITERATIONS = 10000;
const KEY_LENGTH = 64;
const DIGEST = 'sha512';

export function hashPassword(password, salt = null) {
  const useSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, useSalt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return `${useSalt}:${hash}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');

  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(originalHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function generatePin() {
  return String(crypto.randomInt(100000, 1000000));
}
