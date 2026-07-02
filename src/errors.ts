/**
 * Typed errors that map to the CLI's exit-code contract:
 *   0 pass, 1 audit failed per failOn, 2 config/credential/runtime error.
 */

/** Config parse/validation failure. Exit code 2. */
export class ConfigError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

/** Missing/invalid credentials or environment. Exit code 2. */
export class CredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialError";
  }
}

/** Any other runtime failure (network, git, etc.). Exit code 2. */
export class RuntimeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RuntimeError";
  }
}

export const EXIT_OK = 0;
export const EXIT_AUDIT_FAILED = 1;
export const EXIT_ERROR = 2;
