/** Public origin-only build configuration; never accept source paths or credentials. */
export function parseSourceOrigins(value = "[]") {
  let origins;
  try { origins = JSON.parse(value); }
  catch { throw new Error("Invalid KLARO_TV_SOURCE_ORIGINS JSON"); }
  if (!Array.isArray(origins) || origins.some(origin => {
    if (typeof origin !== "string") return true;
    try {
      const url = new URL(origin);
      return !["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password;
    } catch { return true; }
  })) throw new Error("KLARO_TV_SOURCE_ORIGINS must be a JSON array of exact HTTP(S) origins without paths or credentials");
  return [...new Set(origins)];
}
