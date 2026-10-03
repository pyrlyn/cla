import * as core from "@actions/core";

import { isAllowlisted, resolveAllowlistIds } from "./allowlist.js";
import type { Config } from "./config.js";
import { classifyPeople, impersonatedOpener } from "./coverage.js";
import { ClaCheckError } from "./errors.js";
import type { Github } from "./github.js";
import { githubClient } from "./github.js";
import { membershipCache, type MemberState } from "./membership.js";
import { fetchPeople, type KnownUser } from "./people.js";
import {
  MARKER,
  isCovered,
  missingLogins,
  renderComment,
  renderStatus,
  renderSummary,
  type ReportModel,
} from "./report.js";
import { isSignatureComment } from "./signing.js";
import { appendSignatures, readSignatures, type Signature } from "./store.js";

export interface PullRef {
  owner: string;
  repo: string;
  number: number;
  headSha: string;
  opener: { login: string; id: number };
  repositoryId: number;
}

interface Comment {
  id: number;
  body: string;
  created_at: string;
  html_url: string;
  user: { login: string; id: number } | null;
}

const GITHUB_ACTIONS_BOT_ID = 41898282;

export async function checkPullRequest(config: Config, ref: PullRef): Promise<void> {
  const gh = githubClient(config.githubToken);
  if (!config.claToken) {
    // The signatures repository is private. Public membership must not turn a
    // missing token into a pass.
    await publish(
      gh,
      ref,
      config,
      errorModel(config, "CLA check could not read signatures (missing cla-token). Maintainers: see the run log."),
    );
    return;
  }
  const cla = githubClient(config.claToken);
  try {
    const model = await evaluate(config, ref, gh, cla);
    await publish(gh, ref, config, model);
  } catch (error) {
    if (error instanceof ClaCheckError) {
      core.error(error.message);
      await publish(gh, ref, config, errorModel(config, error.description));
      return;
    }
    throw error;
  }
}

async function evaluate(config: Config, ref: PullRef, gh: Github, cla: Github): Promise<ReportModel> {
  const people = await fetchPeople(gh, {
    owner: ref.owner,
    repo: ref.repo,
    number: ref.number,
    opener: ref.opener,
  });
  const current = await readSignatures(cla, config);
  const comments = await listComments(gh, ref);
  const additions = signaturesFromComments(comments, people, current.signatures, config, ref);
  const signatures =
    additions.length > 0 ? await appendSignatures(cla, config, additions) : current.signatures;

  const memberOf = config.membersPass ? membershipCache(cla, config.org, "token") : null;
  const membership = new Map<number, MemberState>();
  if (memberOf) {
    for (const person of people) {
      if (person.kind !== "user") continue;
      membership.set(person.id, await memberOf(person.login));
    }
  }
  const ids = await resolveAllowlistIds(gh, config.allowlist);
  const rows = classifyPeople({
    people,
    signatures,
    minimumVersion: config.minimumVersion,
    membersPass: config.membersPass,
    membershipOf: (person) => membership.get(person.id),
    allowlisted: (login, id) => isAllowlisted(login, id, config.allowlist, ids),
  });
  const opener = people.find((person): person is KnownUser => person.kind === "user" && person.roles.includes("opener"));
  const impersonation = impersonatedOpener({
    require: config.requireOpenerAsAuthor,
    people,
    openerIsMember: opener ? membership.get(opener.id) === "member" : false,
  });
  return {
    version: config.claVersion,
    phrase: config.signPhrase,
    documentUrl: config.documentUrl,
    documentUrlRu: config.documentUrlRu,
    rows,
    membershipUnverified: [...membership.values()].some((state) => state === "unverified"),
    ...(impersonation ? { impersonation } : {}),
  };
}

function signaturesFromComments(
  comments: readonly Comment[],
  people: readonly { kind: string; id?: number }[],
  existing: readonly Signature[],
  config: Config,
  ref: PullRef,
): Signature[] {
  const ids = new Set(people.filter((person) => person.kind === "user" && person.id).map((person) => person.id));
  const seen = new Set(existing.map((signature) => `${signature.user_id}:${signature.cla_version}`));
  const sorted = comments.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const out: Signature[] = [];
  for (const comment of sorted) {
    const user = comment.user;
    if (!user || user.id === GITHUB_ACTIONS_BOT_ID) continue;
    if (comment.body.includes(MARKER)) continue;
    if (!isSignatureComment(comment.body, user.login, config.signPhrase)) continue;
    if (!ids.has(user.id)) continue;
    const key = `${user.id}:${config.claVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      user: user.login,
      user_id: user.id,
      cla_version: config.claVersion,
      document_sha256: config.documentSha256,
      signed_at: comment.created_at,
      comment_id: comment.id,
      comment_url: comment.html_url,
      repository: `${ref.owner}/${ref.repo}`,
      repository_id: ref.repositoryId,
      pull_request: ref.number,
    });
  }
  return out;
}

async function listComments(octokit: Github, ref: PullRef): Promise<Comment[]> {
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.number,
    per_page: 100,
  });
  return comments.map((comment) => ({
    id: comment.id,
    body: comment.body ?? "",
    created_at: comment.created_at,
    html_url: comment.html_url,
    user: comment.user ? { login: comment.user.login, id: comment.user.id } : null,
  }));
}

function errorModel(config: Config, description: string): ReportModel {
  return {
    version: config.claVersion,
    phrase: config.signPhrase,
    documentUrl: config.documentUrl,
    documentUrlRu: config.documentUrlRu,
    rows: [],
    membershipUnverified: false,
    error: description,
  };
}

async function publish(gh: Github, ref: PullRef, config: Config, model: ReportModel): Promise<void> {
  const body = renderComment(model);
  const commentUrl = await upsertComment(gh, ref, body);
  const status = renderStatus(model);
  await gh.rest.repos.createCommitStatus({
    owner: ref.owner,
    repo: ref.repo,
    sha: ref.headSha,
    state: status.state,
    context: config.statusContext,
    description: status.description,
    ...(commentUrl ? { target_url: commentUrl } : {}),
  });
  const covered = isCovered(model);
  core.setOutput("covered", covered ? "true" : "false");
  core.setOutput("missing", JSON.stringify(missingLogins(model)));
  if (process.env.GITHUB_STEP_SUMMARY) await core.summary.addRaw(renderSummary(model)).write();
  core.info(status.description);
}

async function upsertComment(gh: Github, ref: PullRef, body: string): Promise<string | undefined> {
  const comments = await gh.paginate(gh.rest.issues.listComments, {
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.number,
    per_page: 100,
  });
  // Only a bot's comment is ours: anyone can paste the marker into a comment
  // of their own, and the check must not edit it or link the status to it.
  const existing = comments.find(
    (comment) => comment.user?.type === "Bot" && (comment.body ?? "").includes(MARKER),
  );
  if (existing) {
    if ((existing.body ?? "") !== body) {
      await gh.rest.issues.updateComment({
        owner: ref.owner,
        repo: ref.repo,
        comment_id: existing.id,
        body,
      });
    }
    return existing.html_url;
  }
  const created = await gh.rest.issues.createComment({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.number,
    body,
  });
  return created.data.html_url;
}
