import { useQuery } from "@tanstack/react-query";
import { memoryApi } from "../../api/memory";
export function History({ companyId, id }: { companyId: string; id: string }) {
  const history = useQuery({ queryKey: ["memory-history", companyId, id], queryFn: () => memoryApi.history(companyId, id) });
  if (history.isLoading) return <p>Loading history…</p>;
  if (history.isError) return <p role="alert">Could not load history.</p>;
  const older = (history.data?.entries ?? []).filter((entry) => entry.id !== id);
  return <div className="space-y-2 text-sm">{older.length ? older.map((entry) => <div key={entry.id}><strong>{entry.title}</strong><p className="whitespace-pre-wrap">{entry.body}</p>{entry.withdrawnReason && <p>Reason: {entry.withdrawnReason}</p>}</div>) : <p>No older versions.</p>}</div>;
}
