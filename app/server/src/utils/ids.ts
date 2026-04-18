import { customAlphabet } from "nanoid";

const shortId = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 10);

export function createId(prefix: string): string {
  return `${prefix}_${shortId()}`;
}

