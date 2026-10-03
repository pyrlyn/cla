import type { Classified } from "./coverage.js";

/** Hidden marker so the next run edits this comment instead of posting another. */
export const MARKER = "<!-- pyrlyn-cla -->";

export interface ReportModel {
  version: string;
  phrase: string;
  documentUrl: string;
  documentUrlRu: string | null;
  rows: Classified[];
  impersonation?: string;
  membershipUnverified: boolean;
  error?: string;
}

export function isCovered(model: ReportModel): boolean {
  if (model.error || model.impersonation) return false;
  return model.rows.every(
    (row) => row.reason.kind === "member" || row.reason.kind === "bot" || row.reason.kind === "signed",
  );
}

export function missingLogins(model: ReportModel): string[] {
  const logins: string[] = [];
  for (const row of model.rows) {
    if (row.person.kind !== "user") continue;
    if (row.reason.kind === "missing" || row.reason.kind === "outdated") logins.push(row.person.login);
  }
  if (model.impersonation && !logins.includes(model.impersonation)) logins.push(model.impersonation);
  return logins;
}

function limit(text: string): string {
  if (text.length <= 140) return text;
  return `${text.slice(0, 139)}…`;
}

function noun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function renderStatus(model: ReportModel): { state: "success" | "failure" | "error"; description: string } {
  if (model.error) return { state: "error", description: limit(model.error) };
  const unknowns = model.rows.filter((row) => row.reason.kind === "unknown_email");
  if (unknowns.length > 0) {
    return {
      state: "failure",
      description: `Unknown commit email (not linked to GitHub): ${unknowns.length}. See the comment.`,
    };
  }
  if (model.impersonation) {
    return {
      state: "failure",
      description: limit(`PR opener @${model.impersonation} is not an author of any commit.`),
    };
  }
  const missing = model.rows.filter((row) => row.reason.kind === "missing" || row.reason.kind === "outdated");
  if (missing.length > 0) {
    return { state: "failure", description: missingDescription(model.version, missingLogins(model)) };
  }
  let member = 0;
  let bot = 0;
  let signed = 0;
  for (const row of model.rows) {
    if (row.reason.kind === "member") member += 1;
    else if (row.reason.kind === "bot") bot += 1;
    else if (row.reason.kind === "signed") signed += 1;
  }
  const total = member + bot + signed;
  const parts: string[] = [];
  if (member) parts.push(noun(member, "member", "members"));
  if (bot) parts.push(noun(bot, "bot", "bots"));
  if (signed) parts.push(`${signed} signed CLA ${model.version}`);
  const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return {
    state: "success",
    description: limit(`All ${noun(total, "contributor", "contributors")} covered${detail}`),
  };
}

function missingDescription(version: string, logins: readonly string[]): string {
  const suffix = ". See the pull request comment.";
  const prefix = `CLA ${version} signature missing: `;
  const names = logins.map((login) => `@${login}`);
  let shown = names;
  let text = `${prefix}${shown.join(", ")}${suffix}`;
  while (text.length > 140 && shown.length > 1) {
    shown = shown.slice(0, -1);
    text = `${prefix}${shown.join(", ")}, …${suffix}`;
  }
  return limit(text);
}

function day(iso: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(iso)?.[1] ?? iso;
}

function resultText(row: Classified, version: string): string {
  switch (row.reason.kind) {
    case "member":
      return "Organization member";
    case "bot":
      return "Allowlisted bot";
    case "signed":
      return `Signed CLA ${row.reason.version} on ${day(row.reason.signedAt)}`;
    case "missing":
      return "Missing signature";
    case "unknown_email":
      return "Unknown email (not linked to a GitHub account)";
    case "outdated":
      return `You signed version ${row.reason.signedVersion}; version ${version} is now required`;
  }
}

function personCell(row: Classified): string {
  if (row.person.kind === "unknown") return `\`${row.person.email}\``;
  const mention = row.reason.kind === "missing" || row.reason.kind === "outdated";
  return mention ? `@${row.person.login}` : row.person.login;
}

export function renderTable(model: ReportModel): string {
  const lines = ["| Person | Result |", "| --- | --- |"];
  for (const row of model.rows) lines.push(`| ${personCell(row)} | ${resultText(row, model.version)} |`);
  return lines.join("\n");
}

export function renderComment(model: ReportModel): string {
  if (model.error) {
    return `${MARKER}\n\nThe CLA check could not read signatures. Maintainers: see the run log.\n`;
  }
  if (isCovered(model)) {
    return `${MARKER}\n\nAll contributors are covered by the pyrlyn CLA (version ${model.version}).\n`;
  }
  const lines = [MARKER, "", "## Contributor License Agreement", "", renderTable(model), ""];
  const needsPhrase = model.rows.some((row) => row.reason.kind === "missing" || row.reason.kind === "outdated");
  if (needsPhrase) {
    lines.push("Post this as a new comment, alone:", "", "```", model.phrase, "```", "");
  }
  const docs = [`[English](${model.documentUrl})`];
  if (model.documentUrlRu) docs.push(`[Russian](${model.documentUrlRu})`);
  lines.push(`The agreement: ${docs.join(" · ")}. Version ${model.version} is required.`, "");
  lines.push("Comment `recheck` to run this check again.");
  if (model.rows.some((row) => row.reason.kind === "unknown_email")) {
    lines.push(
      "",
      "If your commit email is not linked to your GitHub account, add it in [email settings](https://github.com/settings/emails) or rewrite the commits with a linked address.",
    );
  }
  if (model.membershipUnverified) {
    lines.push("", "Organization membership could not be verified for this run, so members are asked to sign.");
  }
  if (model.impersonation) {
    lines.push(
      "",
      `@${model.impersonation} opened this pull request but is not an author of any commit. Attributing commits to someone else does not cover the opener.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderSummary(model: ReportModel): string {
  if (model.error) return `${model.error}\n`;
  return `${renderStatus(model).description}\n\n${renderTable(model)}\n`;
}
