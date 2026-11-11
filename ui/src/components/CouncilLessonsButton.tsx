import { useMutation } from "@tanstack/react-query";
import { memoryApi } from "../api/memory";
import { useOptionalToastActions } from "../context/ToastContext";
import { Button } from "./ui/button";

export function CouncilLessonsButton({ companyId, issueId }: { companyId: string; issueId: string }) {
  const toast = useOptionalToastActions();
  const extract = useMutation({ mutationFn: () => memoryApi.extractLessons(companyId, issueId), onSuccess: (result) => {
    if (result.reason) toast?.pushToast({ title: result.reason, tone: "info" });
    else if (!result.created.length) toast?.pushToast({ title: "Nothing new to learn", tone: "info" });
    else toast?.pushToast({ title: result.autoApproved > 0 ? `Learned ${result.created.length} lessons (${result.autoApproved} auto-approved)` : `Found ${result.created.length} lessons - approve them in Memory`, tone: "success", action: { label: "Open Memory", href: "/memory" } });
  }, onError: (error) => toast?.pushToast({ title: error instanceof Error ? error.message : "Could not learn from this room", tone: "error" }) });
  return <Button size="sm" variant="outline" disabled={extract.isPending} onClick={() => extract.mutate()}>Learn from this room</Button>;
}
