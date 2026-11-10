import { Children, Fragment, cloneElement, isValidElement, useState, type ChangeEvent, type ReactElement, type ReactNode } from "react";

export function CouncilSetting({ description, children }: { description: string; children: ReactNode }) {
  return <div className="space-y-1">{children}<p className="text-xs text-muted-foreground">{description}</p></div>;
}

type NodeProps = { children?: ReactNode; description?: string; value?: string; onChange?: (event: ChangeEvent<HTMLSelectElement>) => void; "aria-label"?: string };

function flatten(node: ReactNode): ReactNode[] {
  return Children.toArray(node).flatMap((child) => isValidElement<NodeProps>(child) && child.type === Fragment ? flatten(child.props.children) : [child]);
}

function findSelect(node: ReactNode, label: string): ReactElement<NodeProps> | undefined {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<NodeProps>(child)) continue;
    if (child.type === "select" && child.props["aria-label"] === label) return child;
    const nested = findSelect(child.props.children, label);
    if (nested) return nested;
  }
  return undefined;
}

const descriptions: Record<string, string> = {
  "Seats rank anonymous answers; needs at least three answers.": "Seats rank each other's answers without names. Requires at least three answers.",
  "Other seats vote on the best answer.": "After answers, other seats vote on the best answer.",
  "Other seats grade each work step.": "During planned work, other seats grade each finished step.",
  "The chair may ask questions before work starts.": "Before planned work, the chair may ask you questions.",
  "Allow a seat to ask another seat a question before answering.": "Before answering, a seat may ask another seat a question.",
  "Have the chair plan steps before the seats begin work.": "Plan the steps before the seats begin work.",
};

export function CouncilSettingsPanel({ who, how, extras }: { who: ReactNode; how: ReactNode; extras: ReactNode }) {
  const [advancedOpen, setAdvancedOpen] = useState(() => {
    try { return localStorage.getItem("council-settings-advanced-open") === "true"; } catch { return false; }
  });
  const whoItems = flatten(who);
  const howItems = flatten(how);
  const extraItems = flatten(extras);
  const byDescription = (items: ReactNode[], description: string) => items.find((item) => isValidElement<NodeProps>(item) && item.props.description === description);
  const panel = byDescription(whoItems, "Choose how many seats answer, or let everyone answer.");
  const rounds = findSelect(how, "Rounds");
  const style = findSelect(how, "Discussion style");
  const approval = byDescription(extraItems, "Ask for approval before downloading exports.");
  const specialHow = new Set(["Choose how many rounds of discussion follow the first answers.", "Seats can answer independently or build on the previous answer.", "Choose whether seats cooperate or challenge each other."]);
  const hasCombined = Boolean(rounds && style);
  const advanced = [...whoItems.filter((item) => item !== panel), ...howItems.filter((item) => !(isValidElement<NodeProps>(item) && (item.props.description === "Seats can answer independently or build on the previous answer." || item.props.description === "Choose whether seats cooperate or challenge each other."))), ...extraItems.filter((item) => item !== approval)];
  const groups: Array<[string, string[]]> = [
    ["Check the work", ["Other seats vote on the best answer.", "Other seats grade each work step.", "Review the finished work against your goal and revise it if needed.", "Seats rank anonymous answers; needs at least three answers."]],
    ["Plan the work", ["Allow a seat to ask another seat a question before answering.", "The chair may ask questions before work starts.", "Have the chair plan steps before the seats begin work.", "Create draft tasks from completed work."]],
    ["Who speaks", ["Choose how many rounds of discussion follow the first answers.", "Choose which seat writes the summary.", "Add a short summary after the answers.", "Choose the order seats take their turns.", "Classify this room’s discussion."]],
  ];
  const groupedDescriptions = new Set(groups.flatMap(([, items]) => items));
  const updateSelect = (select: ReactElement<NodeProps>, value: string) => select.props.onChange?.({ target: { value } } as ChangeEvent<HTMLSelectElement>);
  const combinedValue = rounds?.props.value === "off" ? (style?.props.value === "chain" ? "chain" : "separate") : (style?.props.value === "challenge" ? "challenge" : style?.props.value === "chain" ? "chain-debate" : "collaborate");
  const rewrite = (item: ReactNode) => isValidElement<NodeProps>(item) && item.props.description && descriptions[item.props.description] ? cloneElement(item, { description: descriptions[item.props.description] }) : item;
  return <div className="space-y-4 text-sm">
    <section className="space-y-3" aria-label="Who answers"><h3 className="font-semibold">Who answers</h3>{panel ? <CouncilSetting description="Choose how many seats answer, or let everyone answer.">{(() => { const select = findSelect(panel, "Random panel"); return select ? <label>Number of seats answering{cloneElement(select, { "aria-label": "Number of seats answering" })}</label> : panel; })()}</CouncilSetting> : who}</section>
    <section className="space-y-3" aria-label="How they talk"><h3 className="font-semibold">How they talk</h3>{hasCombined ? <><label>How seats answer<select aria-label="How seats answer" className="ml-2 h-8 rounded-md border bg-background px-2" value={combinedValue} onChange={(event) => { const value = event.target.value; updateSelect(style!, value === "chain" || value === "chain-debate" ? "chain" : value === "challenge" ? "challenge" : "collaborate"); updateSelect(rounds!, value === "separate" || value === "chain" ? "off" : rounds!.props.value === "off" ? "low" : rounds!.props.value!); }}><option value="separate">Answer separately</option><option value="chain">Build on previous answers</option><option value="collaborate">Discuss together after answering</option><option value="challenge">Challenge each other after answering</option><option value="chain-debate">Build on answers, then discuss</option></select></label><p className="text-xs text-muted-foreground">Answer style is set above the message box.</p></> : howItems.filter((item) => !isValidElement<NodeProps>(item) || !specialHow.has(item.props.description ?? ""))}{!hasCombined && howItems.some((item) => isValidElement<NodeProps>(item) && item.props.description === "Seats can answer independently or build on the previous answer.") ? byDescription(howItems, "Seats can answer independently or build on the previous answer.") : null}</section>
    <section className="space-y-3" aria-label="Safety and extras"><h3 className="font-semibold">Safety and extras</h3>{approval ?? extras}</section>
    <details open={advancedOpen} onToggle={(event) => { const open = event.currentTarget.open; setAdvancedOpen(open); try { localStorage.setItem("council-settings-advanced-open", String(open)); } catch { /* Storage is optional. */ } }}><summary className="cursor-pointer font-semibold">Advanced options</summary><div className="space-y-3"><p className="text-xs text-muted-foreground">Most people never need these. The defaults work.</p>{groups.map(([heading, descriptions]) => { const items = descriptions.map((description) => byDescription(advanced, description)).filter(Boolean); return items.length ? <section key={heading} className="space-y-2"><h4 className="text-xs font-semibold">{heading}</h4>{items.map(rewrite)}</section> : null; })}{advanced.filter((item) => !isValidElement<NodeProps>(item) || !groupedDescriptions.has(item.props.description ?? "")).map(rewrite)}</div></details>
  </div>;
}

export function CouncilAnswerStyle({ value, onChange }: { value: "side-by-side" | "chain"; onChange: (value: "side-by-side" | "chain") => void }) {
  return <label>How seats answer<select aria-label="How seats answer" className="ml-2 h-8 rounded-md border bg-background px-2" value={value} onChange={(event) => onChange(event.target.value as "side-by-side" | "chain")}><option value="side-by-side">Side by side</option><option value="chain">One after another</option></select></label>;
}
