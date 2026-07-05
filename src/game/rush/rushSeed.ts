/** Six-digit decimal seed for Rush runs (000000–999999). */
export const generateRushSeed = (): string => {
  const bytes = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    bytes[0] = Math.floor(Math.random() * 0x1_0000_0000);
  }
  const value = bytes[0]! % 1_000_000;
  return String(value).padStart(6, "0");
};

/** True for the current six-digit Rush seed format. */
export const isRushSeed = (value: unknown): value is string =>
  typeof value === "string" && /^\d{6}$/.test(value);
