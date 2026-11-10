import { useState } from "react";
import type { CouncilSeat } from "../api/council";
import { deleteTeam, loadTeams, saveTeam, serializeTeam, type SavedTeamSeat } from "../pages/council-saved-teams";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function CouncilSavedTeams({ seats, onCreate, onAdded, onError }: { seats: CouncilSeat[]; onCreate: (seat: SavedTeamSeat) => Promise<unknown>; onAdded: (count: number) => void; onError: (error: unknown) => void }) {
  const [teams, setTeams] = useState(loadTeams);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const savable = seats.some((seat) => seat.connectionId && seat.model);
  async function useTeam(teamSeats: SavedTeamSeat[]) {
    setBusy(true);
    const names = new Set(seats.map((seat) => seat.name.trim().toLowerCase()));
    let count = 0;
    try {
      for (const seat of teamSeats) {
        const key = seat.name.trim().toLowerCase();
        if (names.has(key)) continue;
        await onCreate(seat);
        names.add(key);
        count++;
      }
      onAdded(count);
    } catch (error) { onError(error); } finally { setBusy(false); }
  }
  return <details className="relative">
    <summary className="cursor-pointer rounded-md border px-2 py-1 text-sm">Teams</summary>
    <div className="absolute left-0 z-10 mt-1 w-80 max-w-full space-y-2 rounded-md border bg-popover p-3 shadow-lg">
      {naming ? <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; setTeams(saveTeam(serializeTeam(name, seats))); setName(""); setNaming(false); }}>
        <Input aria-label="Team name" placeholder="Team name" value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        <Button type="submit" size="sm" disabled={!name.trim()}>Save</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setNaming(false)}>Cancel</Button>
      </form> : <Button type="button" variant="outline" size="sm" disabled={!savable} onClick={() => setNaming(true)}>Save current team…</Button>}
      {teams.map((team) => <div key={team.id} className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm">{team.name}</span><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void useTeam(team.seats)}>Use</Button><Button type="button" variant="ghost" size="sm" aria-label={`Delete ${team.name}`} onClick={() => setTeams(deleteTeam(team.id))}>×</Button></div>)}
    </div>
  </details>;
}
