import { Skeleton } from "@/components/ui/skeleton";

export default function SessionDetailLoadingPage() {
  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 px-6 py-2.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-7 w-14" />
      </div>

      {/* Split panels */}
      <div className="flex min-h-0 flex-1">
        {/* Transcript panel */}
        <div className="flex w-1/2 flex-col border-r border-border/40">
          <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="flex-1 px-6 py-5 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        </div>

        {/* Solution panel */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center justify-between border-b border-border/40 px-6 py-3">
            <Skeleton className="h-3 w-16" />
          </div>
          <div className="flex-1 px-6 py-5 space-y-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-20 w-full rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      </div>
    </div>
  );
}
