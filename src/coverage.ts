import type { MemberState } from "./membership.js";
import type { KnownUser, Person } from "./people.js";
import type { Signature } from "./store.js";
import { compareVersions, versionSatisfies } from "./version.js";

export type Reason =
  | { kind: "member" }
  | { kind: "bot" }
  | { kind: "signed"; version: string; signedAt: string }
  | { kind: "missing" }
  | { kind: "unknown_email"; email: string }
  | { kind: "outdated"; signedVersion: string; signedAt: string };

export interface Classified {
  person: Person;
  reason: Reason;
}

function highest(signatures: readonly Signature[]): Signature | undefined {
  return signatures.reduce<Signature | undefined>((best, signature) => {
    if (!best) return signature;
    const order = compareVersions(signature.cla_version, best.cla_version);
    if (order > 0) return signature;
    if (order === 0 && signature.signed_at < best.signed_at) return signature;
    return best;
  }, undefined);
}

export function classifyPeople(args: {
  people: readonly Person[];
  signatures: readonly Signature[];
  minimumVersion: string;
  membersPass: boolean;
  membershipOf: (person: KnownUser) => MemberState | undefined;
  allowlisted: (login: string, id: number) => boolean;
}): Classified[] {
  return args.people.map((person) => ({ person, reason: reasonFor(person, args) }));
}

function reasonFor(
  person: Person,
  args: {
    signatures: readonly Signature[];
    minimumVersion: string;
    membersPass: boolean;
    membershipOf: (person: KnownUser) => MemberState | undefined;
    allowlisted: (login: string, id: number) => boolean;
  },
): Reason {
  if (person.kind === "unknown") return { kind: "unknown_email", email: person.email };
  if (args.membersPass && args.membershipOf(person) === "member") return { kind: "member" };
  if (args.allowlisted(person.login, person.id)) return { kind: "bot" };
  const mine = args.signatures.filter((signature) => signature.user_id === person.id);
  const covering = mine.filter((signature) => versionSatisfies(signature.cla_version, args.minimumVersion));
  const best = highest(covering);
  if (best) return { kind: "signed", version: best.cla_version, signedAt: best.signed_at };
  const latest = highest(mine);
  if (latest) return { kind: "outdated", signedVersion: latest.cla_version, signedAt: latest.signed_at };
  return { kind: "missing" };
}

/** A signature does not excuse an opener who authored nothing. Membership does. */
export function impersonatedOpener(args: {
  require: boolean;
  people: readonly Person[];
  openerIsMember: boolean;
}): string | undefined {
  if (!args.require) return undefined;
  const opener = args.people.find((person) => person.kind === "user" && person.roles.includes("opener"));
  if (!opener || opener.kind !== "user") return undefined;
  if (opener.roles.includes("author") || opener.roles.includes("coauthor")) return undefined;
  if (args.openerIsMember) return undefined;
  return opener.login;
}
