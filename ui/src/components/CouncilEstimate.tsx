import { useQuery } from "@tanstack/react-query";
import { councilApi, type CouncilEstimateMode, type CouncilSeat } from "../api/council";
import { useCompany } from "../context/CompanyContext";

function dollars(cents: number): string {
  if (cents < 1) return "<$0.01";
  return `$${(cents / 100).toFixed(2)}`;
}

function costRange(cost: { low: number; high: number } | null): string {
  return cost ? `roughly ${dollars(cost.low)}-${dollars(cost.high)}` : "cost unknown (no price history)";
}

export function CouncilEstimate({ roomId, mode }: { roomId: string; mode: CouncilEstimateMode }) {
  const { selectedCompanyId } = useCompany();
  const companyId = selectedCompanyId ?? "";
  const seats = useQuery({
    queryKey: ["council", companyId, roomId, "seats"],
    queryFn: () => councilApi.listSeats(companyId, roomId),
    enabled: !!companyId && !!roomId,
  });
  const seatIds = (seats.data ?? []).map((seat: CouncilSeat) => seat.id).sort();
  const estimate = useQuery({
    queryKey: ["council", companyId, roomId, "estimate", mode, seatIds],
    queryFn: () => councilApi.getEstimate(companyId, roomId, mode),
    enabled: !!companyId && !!roomId && seats.isSuccess,
  });

  if (!estimate.data || estimate.isError) return null;
  const { calls, estimatedSeconds: seconds, unpricedSeats } = estimate.data;
  const seatDetails = estimate.data.seats.map((seat) => `${seat.label}: ${seat.calls} call${seat.calls === 1 ? "" : "s"}`).join("; ");
  return (
    <span className="min-w-0 text-xs text-muted-foreground" title={seatDetails || "No seat details available"}>
      Estimate: about {calls} call{calls === 1 ? "" : "s"}, {costRange(estimate.data.estimatedCostCents)}, {seconds.low}-{seconds.high} s{unpricedSeats > 0 ? ` (${unpricedSeats} seat${unpricedSeats === 1 ? "" : "s"} unpriced)` : ""}
    </span>
  );
}

