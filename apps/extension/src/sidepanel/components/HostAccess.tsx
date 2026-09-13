import { useEffect, useState } from "react";
import { DEV_HOST_PATTERNS } from "../../manifest";
import { ext } from "../../platform/ext";
import { Button } from "./ui";

/**
 * Firefox MV3 treats host permissions as user-granted, so content scripts may not run on localhost
 * until access is allowed. Chrome grants them at install; there this renders nothing.
 */
export function HostAccess() {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const check = () => {
      ext.permissions.contains({ origins: DEV_HOST_PATTERNS }).then(setGranted, (e: unknown) => setError(`Permission check failed: ${String(e)}`));
    };
    check();
    ext.permissions.onAdded.addListener(check);
    ext.permissions.onRemoved.addListener(check);
    return () => {
      ext.permissions.onAdded.removeListener(check);
      ext.permissions.onRemoved.removeListener(check);
    };
  }, []);

  if (granted !== false && !error) return null;

  const request = async () => {
    try {
      // Must run directly in the click handler: permission requests need a user gesture.
      const ok = await ext.permissions.request({ origins: DEV_HOST_PATTERNS });
      setGranted(ok);
      setError(ok ? null : "Required permission missing: access to localhost was declined.");
    } catch (e) {
      setError(`Required permission missing: ${(e as Error).message}`);
    }
  };

  return (
    <div data-testid="host-access" className="flex flex-col gap-2 rounded-lg bg-bone/5 p-3">
      <p className="text-xs leading-5 text-signal">{error ?? "UIHook needs access to localhost and 127.0.0.1 to inspect your dev server."}</p>
      <Button variant="primary" onClick={() => void request()}>
        Allow localhost access
      </Button>
      <p className="text-[11px] text-bone/50">Reload the app tab after granting access.</p>
    </div>
  );
}
