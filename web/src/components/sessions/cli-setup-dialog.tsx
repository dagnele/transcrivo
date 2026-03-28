"use client";

import Link from "next/link";
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
import { formatTimestamp } from "@/lib/session-ui";
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
  const [tokenExpiresAt, setTokenExpiresAt] = useState<Date | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const tokenMutation = useMutation(
    trpc.session.createToken.mutationOptions({
      onSuccess(data) {
        setToken(data.token);
        setTokenExpiresAt(data.expiresAt);
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

  const command = token ? `transcrivo run --token ${token}` : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setToken(null);
          setTokenExpiresAt(null);
          setTokenError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect via CLI</DialogTitle>
          <DialogDescription>
            Generate a token and run the command to start streaming audio to
            this session. See the{" "}
            <Link href="/install" className="text-underline underline">
              install guide
            </Link>{" "}
            for setup instructions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {token ? (
            <>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Token</p>
                <CopyBlock value={token} masked />
                <p className="text-xs text-muted-foreground">
                  Expires at {formatTimestamp(tokenExpiresAt) ?? "-"}.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Run this command</p>
                <CopyBlock value={command!} />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={generateToken}
                disabled={tokenMutation.isPending}
              >
                <RefreshCw className="mr-2 h-3 w-3" />
                Regenerate token
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
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
      </DialogContent>
    </Dialog>
  );
}
