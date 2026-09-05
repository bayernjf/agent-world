import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { randomBytes } from "node:crypto";
import { log } from "./logger.js";

function loadSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  // Persist next to the sqlite db so sessions survive restarts.
  const dbFile = process.env.DB_FILE ?? "agent-world.sqlite";
  const secretFile = join(dirname(dbFile), ".jwt-secret");
  try {
    const existing = readFileSync(secretFile, "utf8").trim();
    if (existing) return existing;
  } catch {
    /* first boot */
  }
  const fresh = randomBytes(32).toString("hex");
  try {
    writeFileSync(secretFile, fresh, { mode: 0o600 });
  } catch (err) {
    log.warn("could not persist JWT secret, sessions will reset on restart", { error: String(err) });
  }
  return fresh;
}

const JWT_SECRET = loadSecret();

const JWT_ISSUER = "agent-world";
export const REMEMBER_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 days
const SESSION_MAX_AGE_SEC = 24 * 60 * 60; // upper bound when not remembered

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(
  userId: string,
  email: string,
  remember = true,
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(JWT_ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${remember ? REMEMBER_MAX_AGE_SEC : SESSION_MAX_AGE_SEC}s`)
    .sign(secret);
}

export interface TokenPayload {
  userId: string;
  email: string;
}

export async function verifyToken(
  token: string,
): Promise<TokenPayload | null> {
  try {
    const secret = new TextEncoder().encode(JWT_SECRET);
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
    });
    return {
      userId: payload.userId as string,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}
