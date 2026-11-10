import { useEffect, useRef, useState, type ReactNode } from "react";
import { councilApi, type CouncilSeatCheckResult } from "../api/council";
import { rememberCheck, seatCheckText, type LastCheck } from "../pages/council-check-memory";
import { Button } from "./ui/button";

export function CouncilSeatCheck({ companyId, roomId, onError, showCheck = true, children, onRemember }: { companyId: string; roomId: string; onError: (error: unknown) => void; showCheck?: boolean; children?: ReactNode; onRemember?: (check: LastCheck) => void }) {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<(CouncilSeatCheckResult & { backupUsed?: boolean; primaryError?: string; agentSeat?: boolean })[] | null>(null);

  const resultsRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (results) resultsRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" }); }, [results]);

  async function check() {
    setChecking(true);
    setResults(null);
    try {
      const checked = (await councilApi.checkSeats(companyId, roomId)).results as (CouncilSeatCheckResult & { backupUsed?: boolean; primaryError?: string; agentSeat?: boolean })[];
      setResults(checked);
      const remembered = rememberCheck(roomId, Object.fromEntries(checked.map((result) => [result.seatId, { ok: result.ok, error: result.error, seconds: result.durationMs / 1000, backupUsed: result.backupUsed, primaryError: result.primaryError, agentSeat: result.agentSeat }])));
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
      <p className="font-medium">{`${results.filter((r) => r.ok && !r.backupUsed).length} of ${results.length} seats fully work, ${results.filter((r) => r.ok && r.backupUsed).length} only through a backup, ${results.filter((r) => !r.ok).length} needs attention`}</p>
      <div className="flex items-center justify-between gap-2"><span className="font-medium">Seat check</span><button type="button" onClick={() => setResults(null)} aria-label="Dismiss seat check results">Dismiss</button></div>
      <ul>{results.map((result) => <li key={result.seatId} className="mt-1"><span className="font-medium">{result.seatName}: </span><span className={!result.ok ? "text-destructive" : result.backupUsed ? "text-(--status-task-icon-todo)" : "text-(--status-task-icon-done)"}>{seatCheckText({ ...result, seconds: result.durationMs / 1000 })}</span></li>)}</ul>
    </div>}
  </div>;
}
