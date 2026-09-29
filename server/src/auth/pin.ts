import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** 개인 PIN(숫자 4~6자리) 형식 검증. */
export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, pinHash: string): Promise<boolean> {
  return bcrypt.compare(pin, pinHash);
}
