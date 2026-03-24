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

  const command = token
    ? [
        "transcrivo run",
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
          setTokenExpiresAt(null);
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
            this session. Tokens stay valid for 1 hour 30 minutes, and the
            session expiration clock starts only after the CLI sends
            <span className="mx-1 font-mono text-[11px]">session.start</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              1. Install build dependencies
            </p>
            <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <p>Recommended on Linux:</p>
              <p>Rust toolchain with `cargo`, `pkg-config`, and PipeWire / SPA development headers.</p>
              <p>For GPU acceleration, prefer Vulkan. Use CUDA if you specifically want an NVIDIA-only build.</p>
              <p>Package names vary by distro, but you typically need PipeWire dev packages plus Vulkan or CUDA drivers/runtime.</p>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              2. Install the Rust CLI from this repo root
            </p>
            <CopyBlock value="cargo install --path ./cli --locked --features whisper-gpu-vulkan" />
            <p className="text-[11px] leading-relaxed text-muted-foreground/70">
              Recommended: <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">whisper-gpu-vulkan</code>. Use <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">whisper-gpu-cuda</code> instead if you want a CUDA build.
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              3. List available audio devices
            </p>
            <CopyBlock value="transcrivo devices" />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              4. Generate a connection token
            </p>
            {token ? (
              <>
                <CopyBlock value={token} masked />
                <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  <p>Token lifetime: 1 hour 30 minutes.</p>
                  <p>
                    Token expires at {formatTimestamp(tokenExpiresAt) ?? "-"}.
                  </p>
                  <p>
                    The session itself expires 1 hour after the CLI starts it.
                    Once expired, the session is closed and will not accept more
                    CLI connections.
                  </p>
                </div>
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
                </div>
                <p className="text-[11px] text-muted-foreground/60">
                  Regenerate the token if the token expired. If the session
                  expired, create a new session instead.
                </p>
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
                5. Start streaming
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
