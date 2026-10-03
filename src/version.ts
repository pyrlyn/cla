const VERSION = /^\d+(\.\d+)*$/;

export function isVersion(value: string): boolean {
  return VERSION.test(value);
}

/** Dotted numeric versions. Missing parts compare as 0, so `1.0` equals `1.0.0`. */
export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map((part) => Number(part));
  const b = right.split(".").map((part) => Number(part));
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (Number.isNaN(av) || Number.isNaN(bv)) return 0;
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

export function versionSatisfies(signed: string, minimum: string): boolean {
  if (!isVersion(signed) || !isVersion(minimum)) return false;
  return compareVersions(signed, minimum) >= 0;
}
