import { useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import type { MemoryEntry } from "../../api/memory";

type Group = { ids: string[]; reason: string; suggestedTitle: string; suggestedBody: string };
function Duplicate({ group, entries, merge }: { group: Group; entries: MemoryEntry[]; merge: (ids: string[], title: string, body: string) => void }) {
  const [title, setTitle] = useState(group.suggestedTitle);
  const [body, setBody] = useState(group.suggestedBody);
  return <div className="space-y-2 rounded-md border p-3"><p className="text-sm">{group.reason}</p><ul className="text-sm">{group.ids.map((id) => <li key={id}>{entries.find((entry) => entry.id === id)?.title ?? id}{entries.find((entry) => entry.id === id)?.body && <p className="whitespace-pre-wrap text-muted-foreground">{entries.find((entry) => entry.id === id)?.body}</p>}</li>)}</ul><label className="block text-sm">Merged title<Input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label className="block text-sm">Merged details<Textarea value={body} onChange={(e) => setBody(e.target.value)} /></label><Button size="sm" disabled={!title.trim()} onClick={() => merge(group.ids, title, body)}>Merge into one</Button></div>;
}
export function TidyPanel({ duplicates, stale, entries, merge, withdraw }: { duplicates: Group[]; stale: MemoryEntry[]; entries: MemoryEntry[]; merge: (ids: string[], title: string, body: string) => void; withdraw: (id: string) => void }) {
  const [kept, setKept] = useState<string[]>([]);
  return <section className="space-y-3 rounded-md border p-4"><h2 className="font-semibold">Looks like duplicates</h2>{duplicates.length ? duplicates.map((group) => <Duplicate key={group.ids.join(":")} group={group} entries={entries} merge={merge} />) : <p className="text-sm text-muted-foreground">No duplicates found.</p>}<h2 className="font-semibold">Not used for 60 days</h2>{stale.filter((entry) => !kept.includes(entry.id)).map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-2"><span>{entry.title}</span><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setKept((ids) => [...ids, entry.id])}>Keep</Button><Button size="sm" variant="outline" onClick={() => withdraw(entry.id)}>Withdraw</Button></div></div>)}</section>;
}
