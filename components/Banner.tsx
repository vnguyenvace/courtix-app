export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function param(sp: Record<string, string | string[] | undefined>, key: string) {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Shows ?error= or ?notice= messages set by server actions. */
export function Banner({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const error = param(sp, "error");
  const notice = param(sp, "notice");
  if (error) return <div className="banner error" role="alert">{error}</div>;
  if (notice) return <div className="banner notice" role="status">{notice}</div>;
  return null;
}
