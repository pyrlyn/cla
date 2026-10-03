import { errorText, httpStatus } from "./errors.js";
import type { Github } from "./github.js";

function ignored(error: unknown, snippet: string): boolean {
  return httpStatus(error) === 403 && errorText(error).toLowerCase().includes(snippet);
}

export async function lockConversation(
  octokit: Github,
  owner: string,
  repo: string,
  issue: number,
): Promise<void> {
  try {
    await octokit.rest.issues.lock({ owner, repo, issue_number: issue, lock_reason: "resolved" });
  } catch (error) {
    if (ignored(error, "locked")) return;
    throw error;
  }
}

export async function unlockConversation(
  octokit: Github,
  owner: string,
  repo: string,
  issue: number,
): Promise<void> {
  try {
    await octokit.rest.issues.unlock({ owner, repo, issue_number: issue });
  } catch (error) {
    if (ignored(error, "not locked")) return;
    throw error;
  }
}
