import * as core from "@actions/core";

import { parseAllowlist, type AllowPattern } from "./allowlist.js";
import { ConfigError } from "./errors.js";
import { SIGN_PHRASE } from "./signing.js";
import { isVersion } from "./version.js";

export interface Config {
  githubToken: string;
  claToken: string | null;
  org: string;
  membersPass: boolean;
  allowlist: AllowPattern[];
  signaturesOwner: string;
  signaturesRepo: string;
  signaturesBranch: string;
  signaturesPath: string;
  documentUrl: string;
  documentUrlRu: string | null;
  claVersion: string;
  documentSha256: string;
  minimumVersion: string;
  signPhrase: string;
  statusContext: string;
  lockAfterMerge: boolean;
  requireOpenerAsAuthor: boolean;
}

function input(name: string): string {
  return core.getInput(name).trim();
}

function required(name: string): string {
  const value = input(name);
  if (value === "") throw new ConfigError(`${name} is required`);
  return value;
}

function optional(name: string, fallback: string): string {
  const value = input(name);
  return value === "" ? fallback : value;
}

function booleanInput(name: string, fallback: boolean): boolean {
  const raw = input(name).toLowerCase();
  if (raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new ConfigError(`${name} must be true or false`);
}

function versionInput(name: string, value: string): string {
  if (!isVersion(value)) throw new ConfigError(`${name} must be a dotted numeric version`);
  return value;
}

export function loadConfig(): Config {
  const githubToken = required("github-token");
  const claTokenRaw = input("cla-token");
  const org = optional("org", "pyrlyn");
  const repository = optional("signatures-repository", "pyrlyn/cla-signatures");
  const slash = /^([^/\s]+)\/([^/\s]+)$/.exec(repository);
  const signaturesOwner = slash?.[1];
  const signaturesRepo = slash?.[2];
  if (!signaturesOwner || !signaturesRepo) {
    throw new ConfigError("signatures-repository must be owner/name");
  }

  const claVersion = versionInput("cla-version", required("cla-version"));
  const minimumRaw = input("minimum-version");
  const minimumVersion = versionInput(
    "minimum-version",
    minimumRaw === "" ? claVersion : minimumRaw,
  );
  const documentSha256 = required("document-sha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(documentSha256)) {
    throw new ConfigError("document-sha256 must be a 64-character hex SHA-256");
  }

  const documentUrlRu = input("document-url-ru");
  const signPhrase = optional("sign-phrase", SIGN_PHRASE);
  if (signPhrase === "") throw new ConfigError("sign-phrase is required");

  return {
    githubToken,
    claToken: claTokenRaw === "" ? null : claTokenRaw,
    org,
    membersPass: booleanInput("members-pass", true),
    allowlist: parseAllowlist(input("allowlist")),
    signaturesOwner,
    signaturesRepo,
    signaturesBranch: optional("signatures-branch", "main"),
    signaturesPath: optional("signatures-path", "signatures/cla.json"),
    documentUrl: required("document-url"),
    documentUrlRu: documentUrlRu === "" ? null : documentUrlRu,
    claVersion,
    documentSha256,
    minimumVersion,
    signPhrase,
    statusContext: optional("status-context", "pyrlyn/cla"),
    lockAfterMerge: booleanInput("lock-after-merge", true),
    requireOpenerAsAuthor: booleanInput("require-opener-as-author", true),
  };
}
