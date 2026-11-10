import type { CouncilSeat, CouncilSeatRole } from "../api/council";

export type SavedTeamSeat = { name: string; connectionId: string; grantId?: string; model: string; role: CouncilSeatRole; persona: string; roleId?: string };
export type SavedTeam = { id: string; name: string; seats: SavedTeamSeat[] };
const KEY = "council.savedTeams.v1";
let memory: SavedTeam[] = [];
let storageWritable = true;

export function serializeTeam(name: string, seats: CouncilSeat[]): SavedTeam {
  return { id: crypto.randomUUID(), name: name.trim(), seats: seats.flatMap((seat) => seat.connectionId && seat.model ? [{ name: seat.name, connectionId: seat.connectionId, ...(seat.grantId ? { grantId: seat.grantId } : {}), model: seat.model, role: seat.role, persona: seat.persona }] : []) };
}
export function loadTeams(): SavedTeam[] {
  if (!storageWritable) return memory;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      memory = Array.isArray(parsed) ? parsed.slice(0, 12) : [];
    } else memory = [];
  } catch { /* Keep the in-memory copy when storage is unavailable. */ }
  return memory;
}
function persist(teams: SavedTeam[]) {
  memory = teams;
  try { localStorage.setItem(KEY, JSON.stringify(teams)); } catch { storageWritable = false; }
  return teams;
}
export function saveTeam(team: SavedTeam): SavedTeam[] {
  const name = team.name.trim();
  const teams = loadTeams();
  if (!name) return teams;
  return persist([ { ...team, name }, ...teams.filter((item) => item.id !== team.id && item.name.trim().toLocaleLowerCase() !== name.toLocaleLowerCase()) ].slice(0, 12));
}
export function deleteTeam(id: string): SavedTeam[] {
  return persist(loadTeams().filter((team) => team.id !== id));
}
