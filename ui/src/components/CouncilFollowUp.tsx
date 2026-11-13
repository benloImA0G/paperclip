import { useQuery } from "@tanstack/react-query";
import { councilApi, type CouncilFollowUp as CouncilFollowUpData } from "../api/council";

export function CouncilFollowUpView({ data }: { data: CouncilFollowUpData }) {
  if (data.items.length === 0) {
    return <p className="text-xs text-muted-foreground">No tasks from this room yet</p>;
  }
  return (
    <section aria-label="Task follow-up" className="space-y-2">
      <p role="status" className="text-xs font-medium">{data.headline}</p>
      <ul className="space-y-2">
        {data.items.map((item) => (
          <li key={item.id} className="flex min-w-0 flex-col gap-1 rounded-md border border-border p-2 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-medium">{item.identifier ?? item.id}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{item.title}</span>
              <span className="rounded-full bg-muted px-2 py-1 text-xs">{item.status.replace(/_/g, " ")}</span>
              <span className="text-xs text-muted-foreground">{item.assigneeName ?? "Unassigned"}</span>
            </div>
            {item.outcome ? <p className="text-xs text-muted-foreground">{item.outcome}</p> : null}
            {item.stale ? <p className="text-xs text-destructive">No update for {item.staleDays} days</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CouncilFollowUp({ companyId, roomId }: { companyId: string; roomId: string }) {
  const followUp = useQuery({
    queryKey: ["council", "follow-up", companyId, roomId],
    queryFn: () => councilApi.getFollowUp(companyId, roomId),
    enabled: Boolean(companyId && roomId),
  });
  if (followUp.isLoading) return <p role="status" className="text-xs text-muted-foreground">Loading follow-up…</p>;
  if (followUp.isError || !followUp.data) return <p role="alert" className="text-xs text-muted-foreground">Couldn&apos;t load follow-up.</p>;
  return <CouncilFollowUpView data={followUp.data} />;
}
