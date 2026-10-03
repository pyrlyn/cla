import type { Config } from "./config.js";
import { ClaCheckError, errorText, httpStatus } from "./errors.js";
import type { Github } from "./github.js";

export interface Signature {
  user: string;
  user_id: number;
  cla_version: string;
  document_sha256: string;
  signed_at: string;
  comment_id: number;
  comment_url: string;
  repository: string;
  repository_id: number;
  pull_request: number;
}

interface SignatureFile {
  schema: 1;
  signatures: Signature[];
}

const ATTEMPTS = 5;

function invalid(detail: string): ClaCheckError {
  return new ClaCheckError(
    "CLA check could not read signatures (invalid file). Maintainers: see the run log.",
    detail,
  );
}

function isSignature(value: unknown): value is Signature {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.user === "string" &&
    typeof entry.user_id === "number" &&
    typeof entry.cla_version === "string" &&
    typeof entry.document_sha256 === "string" &&
    typeof entry.signed_at === "string" &&
    typeof entry.comment_id === "number" &&
    typeof entry.comment_url === "string" &&
    typeof entry.repository === "string" &&
    typeof entry.repository_id === "number" &&
    typeof entry.pull_request === "number"
  );
}

function parseFile(text: string): SignatureFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw invalid(`signatures file is not JSON: ${errorText(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("signatures file is not an object");
  const schema = (value as { schema?: unknown }).schema;
  const signatures = (value as { signatures?: unknown }).signatures;
  if (schema !== 1 || !Array.isArray(signatures)) {
    throw invalid("signatures file schema is not 1; refusing to rewrite it");
  }
  for (const entry of signatures) {
    if (!isSignature(entry)) throw invalid("a signature entry is missing required fields");
  }
  return { schema: 1, signatures };
}

function emptyRepository(error: unknown): boolean {
  return httpStatus(error) === 409 && /empty/i.test(errorText(error));
}

function mapStoreError(error: unknown): Error {
  if (error instanceof ClaCheckError) return error;
  if (emptyRepository(error)) {
    return new ClaCheckError(
      "CLA check could not read signatures (empty repository). Maintainers: see the run log.",
      errorText(error),
    );
  }
  const status = httpStatus(error);
  if (status === 401 || status === 403 || status === 404) {
    return new ClaCheckError(
      `CLA check could not read signatures (HTTP ${status}). Maintainers: see the run log.`,
      errorText(error),
    );
  }
  return error instanceof Error ? error : new Error(errorText(error));
}

export async function readSignatures(
  octokit: Github,
  config: Config,
): Promise<{ sha: string | null; signatures: Signature[] }> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner: config.signaturesOwner,
      repo: config.signaturesRepo,
      path: config.signaturesPath,
      ref: config.signaturesBranch,
    });
    if (Array.isArray(data) || !("content" in data) || typeof data.content !== "string" || typeof data.sha !== "string") {
      throw invalid("signatures path is not a file");
    }
    const text = Buffer.from(data.content.replace(/\n/g, ""), "base64").toString("utf8");
    return { sha: data.sha, signatures: parseFile(text).signatures };
  } catch (error) {
    if (error instanceof ClaCheckError) throw error;
    if (httpStatus(error) === 404) return { sha: null, signatures: [] };
    throw mapStoreError(error);
  }
}

function keyOf(signature: Signature): string {
  return `${signature.user_id}:${signature.cla_version}`;
}

/**
 * Append-only. On 409 another writer won the sha, so re-read and keep their
 * entries. Old objects are concatenated, never rebuilt.
 */
export async function appendSignatures(
  octokit: Github,
  config: Config,
  additions: readonly Signature[],
): Promise<Signature[]> {
  let last: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const current = await readSignatures(octokit, config);
    const have = new Set(current.signatures.map(keyOf));
    const extra = additions.filter((signature) => !have.has(keyOf(signature)));
    if (extra.length === 0) return current.signatures;
    const next: SignatureFile = { schema: 1, signatures: [...current.signatures, ...extra] };
    const content = Buffer.from(`${JSON.stringify(next, null, 2)}\n`, "utf8").toString("base64");
    const message =
      extra.length === 1
        ? `cla: record signature for ${extra[0]?.user ?? "contributor"}`
        : `cla: record ${extra.length} signatures`;
    try {
      await octokit.rest.repos.createOrUpdateFileContents({
        owner: config.signaturesOwner,
        repo: config.signaturesRepo,
        path: config.signaturesPath,
        branch: config.signaturesBranch,
        message,
        content,
        ...(current.sha ? { sha: current.sha } : {}),
      });
      return next.signatures;
    } catch (error) {
      if (httpStatus(error) === 409 && !emptyRepository(error)) {
        last = error;
        continue;
      }
      throw mapStoreError(error);
    }
  }
  throw new ClaCheckError(
    "CLA check could not write signatures (HTTP 409). Maintainers: see the run log.",
    `gave up after ${ATTEMPTS} attempts: ${errorText(last)}`,
  );
}
