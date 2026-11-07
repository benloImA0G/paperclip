import { useState } from "react";
import { Button } from "@/components/ui/button";
import { councilApi, type CouncilSeatProposal } from "../api/council";

export function CouncilSuggestSeats({ companyId, roomId, onAdd }: {
  companyId: string;
  roomId: string;
  onAdd: (proposal: CouncilSeatProposal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(3);
  const [proposals, setProposals] = useState<CouncilSeatProposal[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2147483647));

  async function suggest(shuffle: boolean) {
    const nextSeed = shuffle ? (seed + 1) % 2147483648 : seed;
    setSeed(nextSeed);
    setPending(true);
    setError(false);
    try {
      const result = await councilApi.suggestSeats(companyId, roomId, { count, seed: nextSeed });
      setProposals(result.proposals);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return <section className="space-y-2 pb-2">
    <Button type="button" variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>Suggest seats</Button>
    {open ? <div className="space-y-2 rounded-md border p-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">Count <select aria-label="Count" className="rounded-md border bg-background px-1" value={count} onChange={(event) => setCount(Number(event.target.value))}>{Array.from({ length: 8 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}</select></label>
        <Button type="button" size="sm" disabled={pending} onClick={() => void suggest(false)}>Suggest</Button>
        {proposals !== null ? <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void suggest(true)}>Shuffle</Button> : null}
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">Couldn’t suggest seats. Try again.</p> : null}
      {proposals?.length === 0 ? <p className="text-xs text-muted-foreground">No seats can be suggested.</p> : null}
      {proposals?.map((proposal, index) => <div key={`${proposal.connectionId}:${proposal.model}:${index}`} className="flex items-center justify-between gap-2 text-xs">
        <span><strong>{proposal.name}</strong> · {proposal.vendor} · {proposal.model}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => onAdd(proposal)}>Add</Button>
      </div>)}
    </div> : null}
  </section>;
}
