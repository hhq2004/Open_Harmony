/** Bound retained identifiers; callers must supply route aliases, never URLs or user data. */
export const MAX_IDENTIFIER_LENGTH = 128;

export function checkIdentifier(value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > MAX_IDENTIFIER_LENGTH) {
    throw new TypeError('An identifier must be a nonempty string of at most 128 UTF-16 code units.');
  }
}

export function checkPositiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}
