import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { SessionStatus } from "@/lib/contracts/session";
import { formatTimestamp, getStatusVariant } from "@/lib/session-ui";

type SessionStatusBadgeProps = {
  status: SessionStatus;
  createdAt: Date;
  startedAt: Date | null;
  expiresAt: Date | null;
  className?: string;
  popoverAlign?: "start" | "center" | "end";
};

export function SessionStatusBadge({
  status,
  createdAt,
  startedAt,
  expiresAt,
  className,
  popoverAlign = "start",
}: SessionStatusBadgeProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex shrink-0 cursor-pointer items-center">
          <Badge variant={getStatusVariant(status)} className={className ?? "capitalize"}>
            {status}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align={popoverAlign} className="w-60 p-3">
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          <span className="text-muted-foreground/60">Created</span>
          <span className="text-muted-foreground">{formatTimestamp(createdAt) ?? "-"}</span>

          <span className="text-muted-foreground/60">{startedAt ? "Started" : "Starts"}</span>
          <span className="text-muted-foreground">
            {startedAt ? (formatTimestamp(startedAt) ?? "-") : "On first CLI connection"}
          </span>

          <span className="text-muted-foreground/60">{status === "expired" ? "Expired" : "Expires"}</span>
          <span className="text-muted-foreground">
            {expiresAt ? (formatTimestamp(expiresAt) ?? "-") : "1 hour after start"}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
