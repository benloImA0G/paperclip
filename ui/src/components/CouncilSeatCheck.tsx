import { useEffect, useRef, useState, type ReactNode } from "react";
import { councilApi, type CouncilSeatCheckResult } from "../api/council";
import { rememberCheck, type LastCheck } from "../pages/council-check-memory";
import { Button } from "./ui/button";

export function CouncilSeatCheck({ companyId, roomId, onError, showCheck = true, children, onRemember }: { companyId: string; roomId: string; onError: (error: unknown) => void; showCheck?: boolean; children?: ReactNode; onRemember?: (check: LastCheck) => void }) {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<CouncilSeatCheckResult[] | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (results) resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }); }, [results]);

  async function check() {
    setChecking(true);
    setResults(null);
    try {
      const checked = (await councilApi.checkSeats(companyId, roomId)).results;
      setResults(checked);
      const remembered = rememberCheck(roomId, Object.fromEntries(checked.map((result) => [result.seatId, { ok: result.ok, error: result.error, seconds: result.durationMs / 1000 }])));
      onRemember?.(remembered);
    } catch (error) {
      onError(error);
    } finally {
      setChecking(false);
    }
  }

  return <div className="space-y-2">
    <div className="flex flex-wrap items-center gap-2">
      {showCheck && <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Check seats"}</Button>}
      {children}
    </div>
    {results && <div ref={resultsRef} className="rounded-md border p-2 text-xs" aria-label="Seat check results">
      <p className="font-medium">{results.every((result) => result.ok) ? `All ${results.length} seats work` : `${results.filter((result) => result.ok).length} of ${results.length} seats work. Fix the red ones below.`}</p>
      <div className="flex items-center justify-between gap-2"><span className="font-medium">Seat check</span><button type="button" onClick={() => setResults(null)} aria-label="Dismiss seat check results">Dismiss</button></div>
      <ul>{results.map((result) => <li key={result.seatId} className="mt-1"><span className="font-medium">{result.seatName}: </span><span className={result.ok ? "text-(--status-task-icon-done)" : "text-destructive"}>{result.ok ? `Works · ${(result.durationMs / 1000).toFixed(1)}s` : `Needs attention: ${result.error || "Check failed"}`}</span></li>)}</ul>
    </div>}
  </div>;
}
