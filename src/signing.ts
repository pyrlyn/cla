/**
 * Phrase matching ported from iainmcgin/cla-github-action v3.2.0
 * `src/pullrequest/signatureComment.ts` (`commentContainsSignature`), Apache-2.0.
 * See NOTICE.
 *
 * A quoted line is someone else's words, and a short extra remark is not a
 * different statement. Anything longer than the phrase is a conversation,
 * not a signature — which also keeps the bot comment that repeats the phrase
 * from signing.
 */

export const SIGN_PHRASE = "I have read the CLA Document and I hereby sign the CLA";

/** Floor so a very short custom phrase still tolerates a remark such as `recheck`. */
const MIN_EXTRA_TEXT_ALLOWANCE = 32;

/** Keeps a phrase block from matching across a Markdown quote line. */
const QUOTE_LINE = "\0";

export function commentContainsSignature(commentBody: string, signPhrase: string): boolean {
  const collapse = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();
  const normLine = (s: string): string => collapse(s.replace(/[.!]+\s*$/, ""));

  const phraseLines = signPhrase
    .split(/\r?\n/)
    .map(normLine)
    .filter((line) => line !== "");
  if (phraseLines.length === 0) return false;

  const bodyLines = commentBody
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith(">") ? QUOTE_LINE : normLine(line)))
    .filter((line) => line !== "");

  const hasOwnBlock = bodyLines.some(
    (_, index) =>
      index + phraseLines.length <= bodyLines.length &&
      phraseLines.every((phraseLine, offset) => bodyLines[index + offset] === phraseLine),
  );
  if (!hasOwnBlock) return false;

  const phraseLength = collapse(signPhrase).length;
  const bodyLength = collapse(commentBody).length;
  const allowance = Math.max(phraseLength, MIN_EXTRA_TEXT_ALLOWANCE);
  return bodyLength <= phraseLength + allowance;
}

/** `github-actions[bot]` repeats the phrase in the sticky comment, so it never signs. */
export function isSignatureComment(body: string, authorLogin: string, phrase: string): boolean {
  if (authorLogin === "github-actions[bot]") return false;
  return commentContainsSignature(body, phrase);
}
