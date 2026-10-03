import { http, HttpResponse, type HttpHandler } from "msw";

export interface ActorFixture {
  email?: string;
  name?: string;
  login?: string;
  id?: number;
}

export interface CommitFixture {
  message?: string;
  author: ActorFixture | null;
  committer: ActorFixture | null;
}

export interface CommentFixture {
  id: number;
  body: string;
  created_at: string;
  html_url: string;
  user: { login: string; id: number; type?: string } | null;
}

export interface StatusCall {
  sha: string;
  state: string;
  description: string;
  context: string;
  target_url?: string;
}

function gqlActor(actor: ActorFixture | null): Record<string, unknown> | null {
  if (!actor) return null;
  return {
    email: actor.email ?? null,
    name: actor.name ?? null,
    user: actor.id && actor.login ? { login: actor.login, databaseId: actor.id } : null,
  };
}

export class FakeGithub {
  commits: CommitFixture[] = [];
  comments: CommentFixture[] = [];
  members = new Set<string>();
  /** Status code to force for every members lookup. */
  memberHttp: number | null = null;
  file: { sha: string; text: string } | null = null;
  emptyRepo = false;
  contentsStatus: number | null = null;
  pageSize = 100;
  statuses: StatusCall[] = [];
  puts: string[] = [];
  created: string[] = [];
  updated: string[] = [];
  locks = 0;
  unlocks = 0;
  graphqlCalls = 0;
  /** On the first write, store this JSON instead and answer 409. */
  raceFile: string | null = null;
  private raced = false;
  private nextComment = 500;
  headSha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  opener = { login: "alice", id: 10 };

  handlers = (): HttpHandler[] => {
    return [
      http.post("https://api.github.com/graphql", async ({ request }) => {
        const body = (await request.json()) as { variables?: { cursor?: string | null } };
        this.graphqlCalls += 1;
        const start = body.variables?.cursor ? Number(body.variables.cursor) : 0;
        const slice = this.commits.slice(start, start + this.pageSize);
        const next = start + slice.length;
        return HttpResponse.json({
          data: {
            repository: {
              pullRequest: {
                commits: {
                  totalCount: this.commits.length,
                  pageInfo: { hasNextPage: next < this.commits.length, endCursor: String(next) },
                  edges: slice.map((commit) => ({
                    node: {
                      commit: {
                        message: commit.message ?? "",
                        author: gqlActor(commit.author),
                        committer: gqlActor(commit.committer),
                      },
                    },
                  })),
                },
              },
            },
          },
        });
      }),
      http.get(/\/repos\/pyrlyn\/cox\/issues\/\d+\/comments$/, () => HttpResponse.json(this.comments)),
      http.post(/\/repos\/pyrlyn\/cox\/issues\/\d+\/comments$/, async ({ request }) => {
        const body = (await request.json()) as { body: string };
        const issue = Number(new URL(request.url).pathname.split("/")[5]);
        const id = this.nextComment++;
        const comment: CommentFixture = {
          id,
          body: body.body,
          created_at: "2026-10-03T12:00:00Z",
          html_url: `https://github.com/pyrlyn/cox/pull/${issue}#issuecomment-${id}`,
          user: { login: "github-actions[bot]", id: 41898282, type: "Bot" },
        };
        this.comments.push(comment);
        this.created.push(body.body);
        return HttpResponse.json(comment);
      }),
      http.patch(/\/repos\/pyrlyn\/cox\/issues\/comments\/\d+$/, async ({ request }) => {
        const body = (await request.json()) as { body: string };
        const id = Number(new URL(request.url).pathname.split("/").pop());
        const existing = this.comments.find((comment) => comment.id === id);
        if (existing) existing.body = body.body;
        this.updated.push(body.body);
        return HttpResponse.json(existing ?? { id, body: body.body });
      }),
      http.post(/\/repos\/pyrlyn\/cox\/statuses\/[^/]+$/, async ({ request }) => {
        const body = (await request.json()) as Omit<StatusCall, "sha">;
        const sha = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
        this.statuses.push({ sha, ...body });
        return HttpResponse.json({ state: body.state });
      }),
      http.get(/\/repos\/pyrlyn\/cla-signatures\/contents\//, () => {
        if (this.emptyRepo) {
          return HttpResponse.json({ message: "Git Repository is empty." }, { status: 409 });
        }
        if (this.contentsStatus) {
          return HttpResponse.json({ message: "nope" }, { status: this.contentsStatus });
        }
        if (!this.file) return HttpResponse.json({ message: "Not Found" }, { status: 404 });
        return HttpResponse.json({
          type: "file",
          encoding: "base64",
          sha: this.file.sha,
          content: Buffer.from(this.file.text, "utf8").toString("base64"),
        });
      }),
      http.put(/\/repos\/pyrlyn\/cla-signatures\/contents\//, async ({ request }) => {
        const body = (await request.json()) as { content: string; sha?: string };
        const text = Buffer.from(body.content, "base64").toString("utf8");
        if (this.raceFile && !this.raced) {
          this.raced = true;
          this.file = { sha: "race-sha", text: this.raceFile };
          return HttpResponse.json({ message: "sha conflict" }, { status: 409 });
        }
        this.file = { sha: this.raced ? "after-race" : "written-sha", text };
        this.puts.push(text);
        return HttpResponse.json({ content: { sha: this.file.sha } });
      }),
      http.get(/\/orgs\/pyrlyn\/members\/[^/]+$/, ({ request }) => {
        const login = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
        if (this.memberHttp) return HttpResponse.json({ message: "forbidden" }, { status: this.memberHttp });
        if (this.members.has(login)) return new HttpResponse(null, { status: 204 });
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }),
      http.get(/\/orgs\/pyrlyn\/public_members\/[^/]+$/, ({ request }) => {
        const login = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
        if (this.members.has(login)) return new HttpResponse(null, { status: 204 });
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }),
      http.get(/\/repos\/pyrlyn\/cox\/pulls\/\d+$/, () =>
        HttpResponse.json({
          number: 12,
          merged: false,
          head: { sha: this.headSha },
          user: this.opener,
        }),
      ),
      http.put(/\/repos\/pyrlyn\/cox\/issues\/\d+\/lock$/, () => {
        this.locks += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.delete(/\/repos\/pyrlyn\/cox\/issues\/\d+\/lock$/, () => {
        this.unlocks += 1;
        return new HttpResponse(null, { status: 204 });
      }),
      http.get(/\/users\/[^/]+$/, ({ request }) => {
        const login = decodeURIComponent(new URL(request.url).pathname.split("/").pop() ?? "");
        if (login === "legacy") return HttpResponse.json({ login: "legacy", id: 77 });
        return HttpResponse.json({ message: "Not Found" }, { status: 404 });
      }),
    ];
  }
}
