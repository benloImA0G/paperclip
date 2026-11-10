import { useState } from "react";
import { councilApi, type CouncilSeatCheckResult } from "../api/council";
import { Button } from "./ui/button";

export function CouncilSeatCheck({ companyId, roomId, onError }: { companyId: string; roomId: string; onError: (error: unknown) => void }) {
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState<CouncilSeatCheckResult[] | null>(null);

  async function check() {
    setChecking(true);
    setResults(null);
    try {
      setResults((await councilApi.checkSeats(companyId, roomId)).results);
    } catch (error) {
      onError(error);
    } finally {
      setChecking(false);
    }
  }

  return <div className="space-y-2">
    <Button type="button" variant="outline" size="sm" disabled={checking} onClick={() => void check()}>{checking ? "Checking…" : "Check seats"}</Button>
    {results && <div className="rounded-md border p-2 text-xs" aria-label="Seat check results">
      <div className="flex items-center justify-between gap-2"><span className="font-medium">Seat check</span><button type="button" onClick={() => setResults(null)} aria-label="Dismiss seat check results">Dismiss</button></div>
      <ul>{results.map((result) => <li key={result.seatId} className="mt-1"><span className="font-medium">{result.seatName}: </span><span className={result.ok ? "text-(--status-task-icon-done)" : "text-destructive"}>{result.ok ? `Works · ${(result.durationMs / 1000).toFixed(1)}s` : `Needs attention: ${result.error || "Check failed"}`}</span></li>)}</ul>
    </div>}
  </div>;
}
