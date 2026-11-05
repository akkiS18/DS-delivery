/**
 * What the DS Taxi desktop (Windows) program may ask before signing in: the oldest version the server still accepts and where to get the new one.
 * Read-only, public (nothing secret), changed by editing the environment of the server and restarting it. Unset = no rule (every version allowed).
 *   TAXI_WINDOWS_MIN_VERSION     e.g. 1.2.0 - older programs show "update required" and stop working
 *   TAXI_WINDOWS_LATEST_VERSION  e.g. 1.3.0 - older programs show a "new version" hint but keep working
 *   TAXI_WINDOWS_DOWNLOAD_URL    https://... the installer (or the page with it)
 * A malformed value is ignored (never blocks the operators because of a typo).
 */
export type WindowsClientConfig = { minVersion: string | null; latestVersion: string | null; downloadUrl: string | null };

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

function version(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return VERSION_RE.test(v) ? v : null;
}

function httpsUrl(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  if (v.length === 0 || v.length > 500) return null;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function windowsClientConfig(vars: Record<string, string | undefined> = process.env): WindowsClientConfig {
  return {
    minVersion: version(vars.TAXI_WINDOWS_MIN_VERSION),
    latestVersion: version(vars.TAXI_WINDOWS_LATEST_VERSION),
    downloadUrl: httpsUrl(vars.TAXI_WINDOWS_DOWNLOAD_URL),
  };
}
