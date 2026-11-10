import { Button } from "@/components/ui/button";

const prompts = ["Compare two ways to do this and pick one", "Find the weak points in my plan", "Draft it, review it, then tell me what to fix"];

export function CouncilEmptyState({ hasFreeConnection, addDisabled, onAdd, onPrompt }: { hasFreeConnection: boolean; addDisabled?: boolean; onAdd: () => void; onPrompt: (prompt: string) => void }) {
  return <div className="space-y-3 rounded-lg border bg-muted/10 p-4 text-sm">
    <ol className="space-y-2">
      <li>1. Add a team <Button type="button" variant="outline" size="sm" className="ml-2" disabled={addDisabled} onClick={onAdd}>{hasFreeConnection ? "Add a free team" : "Add a seat"}</Button></li>
      <li>2. Ask a question (try @Name to ask one seat)</li>
      <li>3. Turn the answer into tasks</li>
    </ol>
    <div className="flex flex-wrap gap-2">{prompts.map((prompt) => <button key={prompt} type="button" className="rounded-md border px-2 py-1 text-left hover:bg-accent" onClick={() => onPrompt(prompt)}>{prompt}</button>)}</div>
  </div>;
}
