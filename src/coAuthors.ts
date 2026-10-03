/**
 * `Co-authored-by` parsing ported from iainmcgin/cla-github-action v3.2.0
 * `src/shared/coAuthors.ts` (`parseCoAuthors`), Apache-2.0. See NOTICE.
 *
 * GitHub counts these trailers as commit authors. The noreply address has two
 * shapes because GitHub changed it: `<id>+<login>@…` and the older `<login>@…`.
 */

export interface CoAuthor {
  name: string;
  email: string;
  noreplyLogin?: string;
  noreplyId?: number;
}

const TRAILER = /^\s*co-authored-by:\s*(.+?)\s+<([^<>\s]+@[^<>\s]+)>\s*$/i;

function parseNoreply(email: string): { login?: string; id?: number } {
  const match = /^(.+)@users\.noreply\.github\.com$/i.exec(email);
  if (!match) return {};
  const local = match[1] ?? "";
  const plus = local.indexOf("+");
  if (plus < 0) return { login: local };
  const idPart = local.slice(0, plus);
  const loginPart = local.slice(plus + 1);
  const id = /^\d+$/.test(idPart) ? Number(idPart) : undefined;
  return { login: loginPart, ...(id === undefined ? {} : { id }) };
}

export function parseCoAuthors(message: string): CoAuthor[] {
  const seen = new Set<string>();
  const out: CoAuthor[] = [];
  for (const rawLine of message.split(/\r?\n/)) {
    const match = TRAILER.exec(rawLine);
    if (!match) continue;
    const name = (match[1] ?? "").trim();
    const email = (match[2] ?? "").trim();
    const key = `${name.toLowerCase()}:${email.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const noreply = parseNoreply(email);
    out.push({
      name,
      email,
      ...(noreply.login ? { noreplyLogin: noreply.login } : {}),
      ...(noreply.id ? { noreplyId: noreply.id } : {}),
    });
  }
  return out;
}
