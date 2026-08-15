import { Buffer } from "node:buffer";

const algorithm = "pbkdf2-sha256";
const iterations = 100_000;
const encoder = new TextEncoder();

const derivePassword = async (password: string, salt: Uint8Array, rounds: number) => {
  const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256));
};

const constantTimeEqual = (left: Uint8Array, right: Uint8Array) => {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
};

export const hashPassword = async (password: string) => {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const derived = await derivePassword(password, salt, iterations);
  return `${algorithm}$${iterations}$${Buffer.from(salt).toString("base64url")}$${Buffer.from(derived).toString("base64url")}`;
};

export const verifyPassword = async (hash: string, password: string) => {
  const [storedAlgorithm, roundsValue, saltValue, derivedValue] = hash.split("$");
  const rounds = Number(roundsValue);
  if (storedAlgorithm !== algorithm || !Number.isSafeInteger(rounds) || rounds < 100_000 || !saltValue || !derivedValue) return false;
  const expected = Buffer.from(derivedValue, "base64url");
  const actual = await derivePassword(password, Buffer.from(saltValue, "base64url"), rounds);
  return constantTimeEqual(actual, expected);
};

let dummyPasswordHash: Promise<string> | undefined;

export const getDummyPasswordHash = () => {
  dummyPasswordHash ??= hashPassword("not-a-real-user-password");
  return dummyPasswordHash;
};
