import { parseCoAuthors, type CoAuthor } from "./coAuthors.js";
import { errorText, httpStatus } from "./errors.js";
import type { Github } from "./github.js";

/** GitHub's merge commit committer. Not a person who wrote the change. */
export const WEB_FLOW_ID = 19864447;

export type Role = "opener" | "author" | "committer" | "coauthor";

export interface KnownUser {
  kind: "user";
  login: string;
  id: number;
  roles: Role[];
}

export interface UnknownEmail {
  kind: "unknown";
  email: string;
  name?: string;
  roles: Role[];
}

export type Person = KnownUser | UnknownEmail;

export interface Actor {
  name?: string;
  email?: string;
  login?: string;
  id?: number;
}

export interface ResolvedCoAuthor {
  name: string;
  email: string;
  login?: string;
  id?: number;
}

export interface CommitInfo {
  message?: string;
  author: Actor | null;
  committer: Actor | null;
  /** When set, the message trailers are not parsed again. */
  coAuthors?: ResolvedCoAuthor[];
}

function addRole(roles: Role[], role: Role): Role[] {
  return roles.includes(role) ? roles : [...roles, role];
}

export function collectPeople(
  opener: { login: string; id: number },
  commits: readonly CommitInfo[],
): Person[] {
  const users = new Map<number, KnownUser>();
  const unknowns = new Map<string, UnknownEmail>();

  function addUser(id: number, login: string, role: Role): void {
    if (!Number.isInteger(id) || id <= 0 || login === "") return;
    const existing = users.get(id);
    if (existing) {
      existing.roles = addRole(existing.roles, role);
      return;
    }
    users.set(id, { kind: "user", login, id, roles: [role] });
  }

  function addUnknown(email: string, name: string | undefined, role: Role): void {
    const key = email.toLowerCase();
    const existing = unknowns.get(key);
    if (existing) {
      existing.roles = addRole(existing.roles, role);
      return;
    }
    unknowns.set(key, { kind: "unknown", email, ...(name ? { name } : {}), roles: [role] });
  }

  addUser(opener.id, opener.login, "opener");

  for (const commit of commits) {
    const author = commit.author;
    if (author?.id && author.login) addUser(author.id, author.login, "author");
    else if (author?.email) addUnknown(author.email, author.name, "author");

    const committer = commit.committer;
    if (committer?.id && committer.id !== WEB_FLOW_ID && committer.login) {
      addUser(committer.id, committer.login, "committer");
    }

    const coAuthors =
      commit.coAuthors ??
      parseCoAuthors(commit.message ?? "").map((co) => ({
        name: co.name,
        email: co.email,
        ...(co.noreplyLogin && co.noreplyId ? { login: co.noreplyLogin, id: co.noreplyId } : {}),
      }));
    for (const co of coAuthors) {
      if (co.id && co.login) addUser(co.id, co.login, "coauthor");
      else addUnknown(co.email, co.name, "coauthor");
    }
  }

  return [...users.values(), ...unknowns.values()];
}

interface GqlUser {
  login?: string;
  databaseId?: number;
}

interface GqlActor {
  email?: string | null;
  name?: string | null;
  user?: GqlUser | null;
}

interface GqlResponse {
  repository?: {
    pullRequest?: {
      commits?: {
        edges?: Array<{ node?: { commit?: { message?: string | null; author?: GqlActor | null; committer?: GqlActor | null } } }>;
        pageInfo?: { endCursor?: string | null; hasNextPage?: boolean };
      };
    } | null;
  };
}

const COMMITS_QUERY = `
query($owner:String!, $name:String!, $number:Int!, $cursor:String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $cursor) {
        totalCount
        pageInfo { endCursor hasNextPage }
        edges {
          cursor
          node {
            commit {
              message
              author { email name user { login databaseId } }
              committer { name email user { login databaseId } }
            }
          }
        }
      }
    }
  }
}`;

function actorFrom(actor: GqlActor | null | undefined): Actor | null {
  if (!actor) return null;
  const login = actor.user?.login;
  const id = actor.user?.databaseId;
  return {
    ...(actor.name ? { name: actor.name } : {}),
    ...(actor.email ? { email: actor.email } : {}),
    ...(login ? { login } : {}),
    ...(typeof id === "number" ? { id } : {}),
  };
}

async function resolveCoAuthor(octokit: Github, co: CoAuthor): Promise<ResolvedCoAuthor> {
  if (co.noreplyId && co.noreplyLogin) {
    return { name: co.name, email: co.email, login: co.noreplyLogin, id: co.noreplyId };
  }
  if (co.noreplyLogin) {
    try {
      const { data } = await octokit.rest.users.getByUsername({ username: co.noreplyLogin });
      return { name: co.name, email: co.email, login: data.login, id: data.id };
    } catch (error) {
      if (httpStatus(error) === 404) return { name: co.name, email: co.email };
      throw new Error(`could not resolve co-author ${co.noreplyLogin}: ${errorText(error)}`);
    }
  }
  return { name: co.name, email: co.email };
}

export async function fetchPeople(
  octokit: Github,
  args: { owner: string; repo: string; number: number; opener: { login: string; id: number } },
): Promise<Person[]> {
  const commits: CommitInfo[] = [];
  let cursor: string | null = null;
  // A cursor that never moves would loop the job. 100 pages is 10_000 commits.
  for (let page = 1; page <= 100; page++) {
    const response: GqlResponse = await octokit.graphql(COMMITS_QUERY, {
      owner: args.owner,
      name: args.repo,
      number: args.number,
      cursor,
    });
    const connection = response.repository?.pullRequest?.commits;
    if (!connection) throw new Error("pull request commits are missing from the GitHub response");
    for (const edge of connection.edges ?? []) {
      const commit = edge.node?.commit;
      if (!commit) continue;
      const parsed = parseCoAuthors(commit.message ?? "");
      const coAuthors: ResolvedCoAuthor[] = [];
      for (const co of parsed) coAuthors.push(await resolveCoAuthor(octokit, co));
      commits.push({
        author: actorFrom(commit.author),
        committer: actorFrom(commit.committer),
        coAuthors,
      });
    }
    if (!connection.pageInfo?.hasNextPage) {
      return collectPeople(args.opener, commits);
    }
    const next = connection.pageInfo.endCursor ?? null;
    if (!next || next === cursor) throw new Error("pull request commit list did not advance");
    cursor = next;
    if (page === 100) throw new Error("pull request commit list exceeded 100 pages");
  }
  throw new Error("pull request commit list exceeded 100 pages");
}
