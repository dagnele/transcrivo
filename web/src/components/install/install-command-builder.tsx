"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Platform = "linux" | "windows";
type Backend = "cpu" | "vulkan" | "cuda";

const SOURCE_README_URL =
  "https://github.com/dagnele/transcrivo/blob/main/cli/README.md";
const RELEASES_URL = "https://github.com/dagnele/transcrivo/releases";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/dagnele/transcrivo/main/cli";

const PLATFORM_OPTIONS: Array<{ value: Platform; label: string }> = [
  { value: "linux", label: "Linux" },
  { value: "windows", label: "Windows" },
];

const BACKEND_OPTIONS: Array<{
  value: Backend;
  label: string;
  description: string;
}> = [
  {
    value: "cpu",
    label: "CPU",
    description: "Safest default. Works without GPU-specific runtime setup.",
  },
  {
    value: "vulkan",
    label: "Vulkan",
    description: "Use when Vulkan is installed and your system exposes a working driver.",
  },
  {
    value: "cuda",
    label: "CUDA",
    description: "Use on NVIDIA systems with a compatible CUDA runtime.",
  },
];

const ASSET_NAMES: Record<Platform, Record<Backend, string>> = {
  linux: {
    cpu: "transcrivo-linux-x86_64-cpu",
    vulkan: "transcrivo-linux-x86_64-vulkan",
    cuda: "transcrivo-linux-x86_64-cuda",
  },
  windows: {
    cpu: "transcrivo-windows-x86_64-cpu.exe",
    vulkan: "transcrivo-windows-x86_64-vulkan.exe",
    cuda: "transcrivo-windows-x86_64-cuda.exe",
  },
};

function CopyCommand({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [value]);

  return (
    <div className="group relative max-w-full">
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-muted/40 px-4 py-3 pr-12 font-mono text-xs leading-relaxed text-foreground">
        {value}
      </pre>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 h-7 w-7 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100"
        onClick={handleCopy}
        aria-label="Copy install command"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}

export function InstallCommandBuilder() {
  const [platform, setPlatform] = useState<Platform>("linux");
  const [backend, setBackend] = useState<Backend>("cpu");

  const selectedBackend = useMemo(
    () => BACKEND_OPTIONS.find((option) => option.value === backend) ?? BACKEND_OPTIONS[0],
    [backend],
  );

  const scriptUrl = `${GITHUB_RAW_BASE}/${platform === "linux" ? "install.sh" : "install.ps1"}`;

  const installDescription =
    platform === "linux"
      ? "The installer downloads the latest release, installs to ~/.local/bin, and prints PATH guidance."
      : "The installer downloads the latest release, installs to %LOCALAPPDATA%\\Programs\\Transcrivo\\bin, and prints PATH guidance.";

  const command =
    platform === "linux"
      ? `curl -LsSf ${scriptUrl} | bash -s -- --backend ${backend}`
      : `& ([scriptblock]::Create((irm "${scriptUrl}"))) -Backend ${backend}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Install command</Badge>
            <Badge variant="outline">Release binaries</Badge>
          </div>
          <CardTitle className="text-xl tracking-tight sm:text-2xl">
            Pick your platform and backend, then run one command.
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Platform
              </p>
              <Select
                value={platform}
                onValueChange={(value) => setPlatform(value as Platform)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLATFORM_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                Backend
              </p>
              <Select
                value={backend}
                onValueChange={(value) => setBackend(value as Backend)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BACKEND_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <CopyCommand value={command} />

          <p className="text-sm leading-relaxed text-muted-foreground">
            {installDescription}
          </p>
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Which backend should I choose?</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            {BACKEND_OPTIONS.map((option) => (
              <div
                key={option.value}
                className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2"
              >
                <p className="font-medium text-foreground">{option.label}</p>
                <p className="mt-1 leading-relaxed">{option.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-card/80 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Current selection</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
              <p className="font-medium text-foreground">
                {platform === "linux" ? "Linux" : "Windows"} + {selectedBackend.label}
              </p>
              <p className="mt-1 break-all font-mono text-xs text-muted-foreground/90">
                {ASSET_NAMES[platform][backend]}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" asChild>
                <Link href={SOURCE_README_URL} target="_blank" rel="noreferrer">
                  Build from source
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link href={RELEASES_URL} target="_blank" rel="noreferrer">
                  View all releases
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
