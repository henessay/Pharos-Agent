// Tiny ANSI color helpers (no dependency).
const enabled = process.env.NO_COLOR === undefined;
const wrap = (code: number) => (s: string) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s);

export const green = wrap(32);
export const yellow = wrap(33);
export const red = wrap(31);
export const cyan = wrap(36);
export const gray = wrap(90);
export const bold = wrap(1);

/** Color a verdict string: allow=green, warn=yellow, block=red. */
export function colorVerdict(verdict: string): string {
  const v = verdict.toUpperCase();
  if (verdict === "allow") return green(v);
  if (verdict === "warn") return yellow(v);
  return red(v);
}
