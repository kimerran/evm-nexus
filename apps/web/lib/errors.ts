// Typed application errors (SPEC §8, §13).
//
// SERVER-ONLY but dependency-free (no next/server, no logger) so it stays pure
// and cheap to import/unit-test. Handlers throw these; `toErrorResponse`
// (lib/http.ts) maps them to the SPEC §8 `{ error: { code, message } }` envelope
// with the right status. An UNKNOWN throw maps to a generic 500 there — never
// leaking stack traces, internal detail, or secrets.

/** Base class for errors that carry an explicit HTTP status + stable code. */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
  }
}

/** 401 — no valid session / API key on a protected route. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required.') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

/** 403 — authenticated but lacks the required role. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action.') {
    super(403, 'FORBIDDEN', message);
  }
}

/** 403 — CSRF (origin / double-submit token) check failed. */
export class CsrfError extends AppError {
  constructor(message = 'CSRF validation failed.') {
    super(403, 'CSRF_FAILED', message);
  }
}

/** 400 — request body/params failed validation. */
export class ValidationError extends AppError {
  constructor(message = 'Invalid request.') {
    super(400, 'INVALID_BODY', message);
  }
}

/** 404 — target resource not found. */
export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(404, 'NOT_FOUND', message);
  }
}

/** 429 — rate limit exceeded; carries the retry hint. */
export class RateLimitError extends AppError {
  readonly retryAfterSec: number;
  constructor(retryAfterSec: number, message = 'Too many requests. Try again later.') {
    super(429, 'RATE_LIMITED', message);
    this.retryAfterSec = retryAfterSec;
  }
}
