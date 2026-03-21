import { Skeleton } from "@/components/ui/skeleton";

export default function SessionsLoadingPage() {
  return (
    <div className="flex h-screen">
      {/* Sidebar skeleton */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex items-center justify-between px-4 py-4">
          <Skeleton className="h-4 w-16" />
          <div className="flex items-center gap-1">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-7 w-7 rounded-md" />
          </div>
        </div>
        <div className="flex-1 space-y-1 px-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5">
              <Skeleton className="h-3.5 w-3.5 shrink-0 rounded" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-10 rounded-full" />
                </div>
                <Skeleton className="h-3 w-3/5" />
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Main content skeleton */}
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center space-y-2">
          <Skeleton className="mx-auto h-4 w-24" />
          <Skeleton className="mx-auto h-3 w-48" />
        </div>
      </div>
    </div>
  );
}
