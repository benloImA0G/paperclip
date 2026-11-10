import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { AGENT_ROLE_LABELS, type Agent } from "@paperclipai/shared";
import { agentsApi } from "../api/agents";
import { councilApi, type CouncilSeat } from "../api/council";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { queryKeys } from "../lib/queryKeys";
import { agentUrl } from "../lib/utils";
import { Link } from "../lib/router";
import { AgentStatusBadge } from "./StatusBadge";
import { Button } from "./ui/button";

const BUILTIN_ADAPTER_LABELS: Record<string, string> = {
  acpx_local: "ACPX",
  claude_local: "Claude",
  codex_local: "Codex",
  paperclip_runner: "Paperclip Runner",
  cursor_cloud: "Cursor Cloud",
  cursor: "Cursor",
  gemini_local: "Gemini",
  grok_local: "Grok",
  hermes_gateway: "Hermes gateway",
  hermes_local: "Hermes local",
  kimi_local: "Kimi",
  openclaw_gateway: "OpenClaw gateway",
  opencode_local: "OpenCode",
  pi_local: "Pi",
  process: "Process",
  http: "HTTP",
};

const ROLE_LABELS = AGENT_ROLE_LABELS as Record<string, string>;

function adapterLabel(adapterType: string): string {
  return BUILTIN_ADAPTER_LABELS[adapterType] ?? adapterType;
}

function roleLabel(agent: Agent): string {
  return ROLE_LABELS[agent.role] || agent.role;
}

function AgentRow({ agent, roomId, seats, addingAgentId, addError, onAdd }: {
  agent: Agent;
  roomId?: string;
  seats: CouncilSeat[];
  addingAgentId: string | null;
  addError: boolean;
  onAdd: () => void;
}) {
  const isHermes = agent.adapterType === "hermes_gateway" || agent.adapterType === "hermes_local";
  // Mirrors the server gate (isAgentInvokableForCouncil); a missing lifecycleState counts as ready.
  const agentReady = (agent.lifecycleState ?? "ready") === "ready" && !["paused", "terminated", "pending_approval", "error", "deleted"].includes(agent.status);
  const blockedStatus = ["error", "paused", "terminated", "pending_approval"].includes(agent.status) ? agent.status.replaceAll("_", " ") : null;
  const alreadyAdded = seats.some((seat) => seat.kind === "agent" && seat.agentId === agent.id);
  const agentSeatLimitReached = seats.filter((seat) => seat.kind === "agent").length >= 3;
  const addUnavailableReason = agent.adapterType !== "hermes_gateway" ? "Only Hermes gateway agents can join war rooms." : !agentReady ? "This agent is not ready (paused, errored or still being set up)." : alreadyAdded ? "This agent is already in the room." : agentSeatLimitReached ? "This room already has three agents." : undefined;

  return (
    <li className="flex flex-col gap-3 border-t py-3 first:border-t-0 first:pt-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to={agentUrl(agent)}
            className="truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={`View ${agent.name}'s agent details`}
          >
            {agent.name}
          </Link>
          {blockedStatus ? <span className="text-xs text-muted-foreground">{blockedStatus}: fix it under Agents first</span> : null}
          {isHermes ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">Hermes</span> : null}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {roleLabel(agent)} <span aria-hidden="true">·</span> {adapterLabel(agent.adapterType)}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <AgentStatusBadge status={agent.status} />
        {roomId ? (
          <Button type="button" variant="outline" size="sm" disabled={Boolean(addUnavailableReason) || addingAgentId === agent.id} title={addUnavailableReason} aria-label={`Add ${agent.name} to this room`} onClick={onAdd}>
            {addingAgentId === agent.id ? "Adding…" : "Add to room"}
          </Button>
        ) : null}
      </div>
      {addError ? <p className="text-sm text-destructive" role="alert">Couldn’t add this agent. Try again.</p> : null}
    </li>
  );
}

export function CouncilAgentPanel({ roomId, seats = [], onSeatAdded }: { roomId?: string; seats?: CouncilSeat[]; onSeatAdded?: () => void }) {
  const { selectedCompanyId } = useCompany();
  const { openNewAgent } = useDialogActions();
  const queryClient = useQueryClient();
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId ?? ""),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
  });
  const addAgentSeat = useMutation({
    mutationFn: (agent: Agent) => councilApi.addSeat(selectedCompanyId!, roomId!, { kind: "agent", agentId: agent.id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["council", selectedCompanyId, roomId, "seats"] });
      onSeatAdded?.();
    },
  });

  return (
    <section className="rounded-lg border bg-card p-4 sm:p-5" aria-labelledby="council-agents-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="council-agents-heading" className="text-base font-semibold">Agents</h2>
          <p className="mt-1 text-sm text-muted-foreground">Agents answer like vendors in the room, without tools.</p>
        </div>
        <Button type="button" onClick={openNewAgent} className="w-full sm:w-auto">
          Create agent
        </Button>
      </div>

      {!selectedCompanyId ? (
        <p className="mt-4 text-sm text-muted-foreground">Select a company to view its agents.</p>
      ) : agentsQuery.isLoading ? (
        <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading agents…
        </div>
      ) : agentsQuery.isError ? (
        <div className="mt-4 flex flex-col gap-3 rounded-md border border-destructive/40 p-3 sm:flex-row sm:items-center sm:justify-between" role="alert">
          <p className="text-sm text-destructive">Couldn’t load agents.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void agentsQuery.refetch()}>
            Retry
          </Button>
        </div>
      ) : agentsQuery.data?.length ? (
        <ul className="mt-4" aria-label="Company agents">
          {agentsQuery.data.map((agent) => <AgentRow key={agent.id} agent={agent} roomId={roomId} seats={seats} addingAgentId={addAgentSeat.isPending ? addAgentSeat.variables?.id ?? null : null} addError={addAgentSeat.isError && addAgentSeat.variables?.id === agent.id} onAdd={() => addAgentSeat.mutate(agent)} />)}
        </ul>
      ) : (
        <div className="mt-4 flex flex-col items-start gap-2 rounded-md bg-muted/50 p-4">
          <Bot className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium">No agents yet</p>
          <p className="text-sm text-muted-foreground">Create an agent to add it to this room.</p>
        </div>
      )}
    </section>
  );
}
