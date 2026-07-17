/**
 * Startup security checks: JWT secret strength and CORS origin allowlist.
 * Fail closed in production — never fall back to insecure defaults.
 */

const MIN_JWT_SECRET_LENGTH = 16;

const WEAK_JWT_SECRETS = new Set([
  "fallback_secret",
  "secret",
  "jwt_secret",
  "changeme",
  "change_me",
  "change_me_to_a_long_random_string_min_16_chars",
  "supersecretjwtkey12345",
]);

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve JWT_SECRET. Refuses missing/short secrets always;
 * refuses known weak placeholders in production.
 */
export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();

  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_SECRET environment variable is required (min ${MIN_JWT_SECRET_LENGTH} characters)`
    );
  }

  if (isProduction() && WEAK_JWT_SECRETS.has(secret.toLowerCase())) {
    throw new Error(
      "JWT_SECRET is a known weak/placeholder value; set a strong random secret in production"
    );
  }

  return secret;
}

/**
 * Build the CORS / Socket.IO origin allowlist from CORS_ORIGINS or FRONTEND_URL.
 * - Dev: defaults to http://localhost:5173 when unset
 * - Production: requires an explicit allowlist (no localhost default)
 * - Never returns "*" (incompatible with credentials: true)
 */
export function resolveAllowedOrigins(): string[] {
  const fromList = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const fromFrontend = process.env.FRONTEND_URL?.trim();
  if (fromFrontend && !fromList.includes(fromFrontend)) {
    fromList.push(fromFrontend);
  }

  let origins = fromList;

  if (origins.length === 0) {
    if (isProduction()) {
      throw new Error(
        "CORS_ORIGINS or FRONTEND_URL must be set in production (comma-separated origin allowlist)"
      );
    }
    origins = ["http://localhost:5173"];
  }

  if (origins.some((o) => o === "*")) {
    throw new Error(
      'CORS origin "*" is not allowed (incompatible with credentials). Set explicit origins via CORS_ORIGINS / FRONTEND_URL.'
    );
  }

  return origins;
}
