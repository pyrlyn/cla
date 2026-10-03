import { readFileSync } from "node:fs";

import * as core from "@actions/core";

import { checkPullRequest, type PullRef } from "./check.js";
import { loadConfig, type Config } from "./config.js";
import { githubClient } from "./github.js";
import { lockConversation, unlockConversation } from "./lock.js";
import { MARKER } from "./report.js";
import { commentContainsSignature } from "./signing.js";

interface EventContext {
  eventName: string;
  owner: string;
  repo: string;
  payload: {
    action?: string;
    repository?: { id?: number };
    pull_request?: object;
    issue?: object;
    comment?: object;
  };
}

export async function run(): Promise<void> {
  try {
    const config = loadConfig();
    core.setSecret(config.githubToken);
    if (config.claToken) core.setSecret(config.claToken);
    const event = readEvent();
    if (event.eventName === "pull_request_target" || event.eventName === "pull_request") {
      await onPullRequest(config, event);
      return;
    }
    if (event.eventName === "issue_comment") {
      await onComment(config, event);
      return;
    }
    core.info(`Ignoring event ${event.eventName}`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Read the event when the run starts. `@actions/github`'s context is built at
 * import, which keeps the first payload for the rest of the process.
 */
function readEvent(): EventContext {
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  if (!owner || !repo) throw new Error("GITHUB_REPOSITORY is missing");
  const eventPath = process.env.GITHUB_EVENT_PATH;
  const payload = eventPath ? (JSON.parse(readFileSync(eventPath, "utf8")) as EventContext["payload"]) : {};
  return { eventName: process.env.GITHUB_EVENT_NAME ?? "", owner, repo, payload };
}

async function onPullRequest(config: Config, event: EventContext): Promise<void> {
  const action = event.payload.action;
  const pull = event.payload.pull_request;
  if (!pull) throw new Error("pull request payload is missing");
  const number = readNumber(pull, "number");
  const merged = Boolean((pull as { merged?: unknown }).merged);
  if (action === "closed") {
    if (config.lockAfterMerge && merged) {
      await lockConversation(githubClient(config.githubToken), event.owner, event.repo, number);
    }
    return;
  }
  if (action === "reopened" && config.lockAfterMerge) {
    await unlockConversation(githubClient(config.githubToken), event.owner, event.repo, number);
  }
  if (action !== "opened" && action !== "synchronize" && action !== "reopened") {
    core.info(`Ignoring pull request action ${String(action)}`);
    return;
  }
  await checkPullRequest(config, readRef(event, pull, number));
}

async function onComment(config: Config, event: EventContext): Promise<void> {
  const payload = event.payload;
  if (payload.action !== "created") return;
  const issue = payload.issue;
  if (!issue || !("pull_request" in issue)) return;
  const comment = payload.comment;
  if (!comment) return;
  const commentRecord = comment as { body?: unknown; user?: { login?: unknown; id?: unknown } };
  const body = typeof commentRecord.body === "string" ? commentRecord.body : "";
  const user = commentRecord.user;
  const login = typeof user?.login === "string" ? user.login : "";
  const id = typeof user?.id === "number" ? user.id : 0;
  if (login === "github-actions[bot]" || id === 41898282) return;
  if (body.includes(MARKER)) return;
  const recheck = body.trim().toLowerCase() === "recheck";
  const mentions = body.toLowerCase().includes(config.signPhrase.toLowerCase());
  if (!recheck && !mentions && !commentContainsSignature(body, config.signPhrase)) return;

  const number = readNumber(issue, "number");
  const gh = githubClient(config.githubToken);
  const { data } = await gh.rest.pulls.get({ owner: event.owner, repo: event.repo, pull_number: number });
  if (!data.user) throw new Error("pull request opener is missing");
  await checkPullRequest(config, {
    owner: event.owner,
    repo: event.repo,
    number,
    headSha: data.head.sha,
    opener: { login: data.user.login, id: data.user.id },
    repositoryId: readRepositoryId(event),
  });
}

function readRef(event: EventContext, pull: object, number: number): PullRef {
  const head = (pull as { head?: { sha?: unknown } }).head;
  if (!head || typeof head.sha !== "string" || head.sha === "") throw new Error("pull request head sha is missing");
  const user = (pull as { user?: { login?: unknown; id?: unknown } }).user;
  if (!user || typeof user.login !== "string" || typeof user.id !== "number") {
    throw new Error("pull request opener is missing");
  }
  return {
    owner: event.owner,
    repo: event.repo,
    number,
    headSha: head.sha,
    opener: { login: user.login, id: user.id },
    repositoryId: readRepositoryId(event),
  };
}

function readNumber(value: object, field: string): number {
  const number = (value as Record<string, unknown>)[field];
  if (typeof number !== "number") throw new Error(`pull request ${field} is missing`);
  return number;
}

function readRepositoryId(event: EventContext): number {
  const id = event.payload.repository?.id;
  if (typeof id !== "number") throw new Error("repository id is missing");
  return id;
}

if (process.env.VITEST !== "true") {
  void run();
}
