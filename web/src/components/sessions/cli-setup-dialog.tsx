"use client";

import { useCallback, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Copy, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTRPC } from "@/lib/trpc";

type CliSetupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
};

function CopyBlock({ value, masked }: { value: string; masked?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  const display = masked
    ? value.slice(0, 20) + "..." + value.slice(-8)
    : value;

  return (
    <div className="group relative max-w-full">
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 px-3 py-2.5 pr-10 font-mono text-xs leading-relaxed text-foreground">
        {display}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-1.5 top-1.5 h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={handleCopy}
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-500" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </Button>
    </div>
  );
}

export function CliSetupDialog({
  open,
  onOpenChange,
  sessionId,
}: CliSetupDialogProps) {
  const trpc = useTRPC();
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const tokenMutation = useMutation(
    trpc.session.createToken.mutationOptions({
      onSuccess(data) {
        setToken(data.token);
        setTokenError(null);
      },
      onError(error) {
        setTokenError(error.message);
      },
    }),
  );

  const generateToken = useCallback(() => {
    tokenMutation.mutate({ sessionId });
  }, [tokenMutation, sessionId]);

  const command = token
    ? [
        "cheatcode run",
        `  --token ${token}`,
        "  --backend-url ws://localhost:3000/ws",
      ].join(" \\\n")
    : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setToken(null);
          setTokenError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Connect via CLI</DialogTitle>
          <DialogDescription>
            Generate a token and run the command to start streaming audio to
            this session.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              1. Install the CLI (if you haven&apos;t already)
            </p>
            <CopyBlock value="pip install cheatcode-cli" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              2. List available audio devices
            </p>
            <CopyBlock value="cheatcode devices" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              3. Generate a connection token
            </p>
            {token ? (
              <>
                <CopyBlock value={token} masked />
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-2 text-xs text-muted-foreground"
                    onClick={generateToken}
                    disabled={tokenMutation.isPending}
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </Button>
                  <span className="text-[11px] text-muted-foreground/60">
                    Token is short-lived. Regenerate if expired.
                  </span>
                </div>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={generateToken}
                  disabled={tokenMutation.isPending}
                >
                  {tokenMutation.isPending ? "Generating..." : "Generate token"}
                </Button>
                {tokenError && (
                  <p className="text-xs text-destructive">{tokenError}</p>
                )}
              </>
            )}
          </div>

          {command && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                4. Start streaming
              </p>
              <CopyBlock value={command} />
              <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                Add{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  --mic-device
                </code>{" "}
                or{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
                  --system-device
                </code>{" "}
                to select specific audio sources.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
