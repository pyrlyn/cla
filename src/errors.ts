export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** A handled check failure. The job stays green and the commit status carries `description`. */
export class ClaCheckError extends Error {
  readonly description: string;

  constructor(description: string, detail?: string) {
    super(detail ?? description);
    this.name = "ClaCheckError";
    this.description = description.length <= 140 ? description : `${description.slice(0, 139)}…`;
  }
}

export function httpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
