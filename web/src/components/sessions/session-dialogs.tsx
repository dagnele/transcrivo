"use client";

import { useCallback, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import type { EntitlementSummary } from "@/lib/contracts/billing";
import type {
  Session,
  SessionLanguage,
  SessionType,
} from "@/lib/contracts/session";
import {
  sessionLanguageOptions,
  sessionTypeOptions,
} from "@/lib/session-config";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEFAULT_SESSION_TYPE: SessionType = "coding";
const DEFAULT_SESSION_LANGUAGE: SessionLanguage = "python";

function normalizeSessionLanguage(type: SessionType, language: SessionLanguage | null) {
  return type === "coding" ? (language ?? DEFAULT_SESSION_LANGUAGE) : null;
}

const sessionTitleSchema = z.object({
  title: z.string().trim().min(1).max(50),
});

type SessionFormValues = z.infer<typeof sessionTitleSchema>;

/* ------------------------------------------------------------------ */
/*  Session form (shared by create and rename dialogs)                 */
/* ------------------------------------------------------------------ */

function SessionForm({
  id,
  title,
  type,
  language,
  pending,
  submitLabel,
  pendingLabel,
  onTitleChange,
  onTypeChange,
  onLanguageChange,
  onSubmit,
  onCancel,
}: {
  id: string;
  title: string;
  type: SessionType;
  language: SessionLanguage | null;
  pending: boolean;
  submitLabel: string;
  pendingLabel: string;
  onTitleChange: (value: string) => void;
  onTypeChange: (type: SessionType, language: SessionLanguage | null) => void;
  onLanguageChange: (language: SessionLanguage) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SessionFormValues>({
    resolver: zodResolver(sessionTitleSchema),
    defaultValues: { title },
    mode: "onChange",
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit(() => onSubmit())();
      }}
      className="space-y-4"
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-title`}>Title</Label>
        <Input
          id={`${id}-title`}
          placeholder="e.g. Frontend system design"
          {...register("title")}
          onChange={(e) => onTitleChange(e.target.value)}
          autoFocus
        />
        {errors.title && (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>
      <div className="space-y-2">
        <Label>Session type</Label>
        <Select
          value={type}
          onValueChange={(value: string) => {
            const nextType = value as SessionType;
            const nextLanguage =
              nextType === "coding"
                ? language ?? DEFAULT_SESSION_LANGUAGE
                : null;
            onTypeChange(nextType, nextLanguage);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sessionTypeOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Coding language</Label>
        <Select
          value={language ?? ""}
          onValueChange={(value: string) => onLanguageChange(value as SessionLanguage)}
          disabled={type !== "coding"}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={type !== "coding" ? "No language" : undefined} />
          </SelectTrigger>
          <SelectContent>
            {sessionLanguageOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <DialogFooter className="mt-4">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/*  Create session dialog                                              */
/* ------------------------------------------------------------------ */

type CreateSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entitlementSummary: EntitlementSummary | null;
  buyPending: boolean;
  onBuySession: () => void;
  onCreate: (input: {
    title: string;
    type: SessionType;
    language: SessionLanguage | null;
  }) => Promise<void>;
};

export function CreateSessionDialog({
  open,
  onOpenChange,
  entitlementSummary,
  buyPending,
  onBuySession,
  onCreate,
}: CreateSessionDialogProps) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<SessionType>(DEFAULT_SESSION_TYPE);
  const [language, setLanguage] = useState<SessionLanguage | null>(DEFAULT_SESSION_LANGUAGE);
  const [pending, setPending] = useState(false);

  const reset = useCallback(() => {
    setTitle("");
    setType(DEFAULT_SESSION_TYPE);
    setLanguage(DEFAULT_SESSION_LANGUAGE);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;
    setPending(true);
    try {
      await onCreate({
        title: title.trim(),
        type,
        language: normalizeSessionLanguage(type, language),
      });
      reset();
      onOpenChange(false);
    } catch {
      // ignore
    } finally {
      setPending(false);
    }
  }, [language, onCreate, onOpenChange, reset, title, type]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Give your session a short, descriptive title.
          </DialogDescription>
        </DialogHeader>

        {/* Entitlement status banner */}
        {entitlementSummary ? (
          <div className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            {entitlementSummary.availablePurchasedSessions > 0 ? (
              <p>
                You have{" "}
                <span className="font-medium text-foreground">
                  {entitlementSummary.availablePurchasedSessions}
                </span>{" "}
                paid session{entitlementSummary.availablePurchasedSessions !== 1 ? "s" : ""}{" "}
                available.
              </p>
            ) : entitlementSummary.trialAvailable ? (
              <p>
                You can create a draft now. Billing is decided when the session starts, and you still have a{" "}
                <span className="font-medium text-foreground">Free trial (5 min)</span>.
              </p>
            ) : (
              <p>
                No sessions available.{" "}
                <button
                  type="button"
                  className="font-medium text-primary underline-offset-4 hover:underline"
                  onClick={onBuySession}
                  disabled={buyPending}
                >
                  {buyPending ? "Redirecting..." : "Buy a session"}
                </button>{" "}
                to continue.
              </p>
            )}
          </div>
        ) : null}

        <SessionForm
          id="create-session"
          title={title}
          type={type}
          language={language}
          pending={pending}
          submitLabel="Create"
          pendingLabel="Creating..."
          onTitleChange={setTitle}
          onTypeChange={(nextType, nextLanguage) => {
            setType(nextType);
            setLanguage(nextLanguage);
          }}
          onLanguageChange={setLanguage}
          onSubmit={() => void handleSubmit()}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Rename session dialog                                              */
/* ------------------------------------------------------------------ */

type RenameSessionDialogProps = {
  session: Session | null;
  onClose: () => void;
  onRename: (input: {
    sessionId: string;
    title: string;
    type: SessionType;
    language: SessionLanguage | null;
  }) => Promise<void>;
};

export function RenameSessionDialog({
  session,
  onClose,
  onRename,
}: RenameSessionDialogProps) {
  const [title, setTitle] = useState(session?.title ?? "");
  const [type, setType] = useState<SessionType>(session?.type ?? DEFAULT_SESSION_TYPE);
  const [language, setLanguage] = useState<SessionLanguage | null>(
    session?.language ?? DEFAULT_SESSION_LANGUAGE,
  );
  const [pending, setPending] = useState(false);

  // Sync form state when the target session changes
  const sessionId = session?.id ?? null;
  const [prevSessionId, setPrevSessionId] = useState(sessionId);
  if (sessionId !== prevSessionId) {
    setPrevSessionId(sessionId);
    if (session) {
      setTitle(session.title);
      setType(session.type);
      setLanguage(session.language);
    }
  }

  const handleSubmit = useCallback(async () => {
    if (!session || !title.trim()) return;
    setPending(true);
    try {
      await onRename({
        sessionId: session.id,
        title: title.trim(),
        type,
        language: normalizeSessionLanguage(type, language),
      });
      onClose();
    } catch {
      // ignore
    } finally {
      setPending(false);
    }
  }, [language, onClose, onRename, session, title, type]);

  return (
    <Dialog open={session !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename session</DialogTitle>
          <DialogDescription>
            Update the title for this session.
          </DialogDescription>
        </DialogHeader>
        <SessionForm
          id="rename-session"
          title={title}
          type={type}
          language={language}
          pending={pending}
          submitLabel="Save"
          pendingLabel="Saving..."
          onTitleChange={setTitle}
          onTypeChange={(nextType, nextLanguage) => {
            setType(nextType);
            setLanguage(nextLanguage);
          }}
          onLanguageChange={setLanguage}
          onSubmit={() => void handleSubmit()}
          onCancel={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/*  Delete session dialog                                              */
/* ------------------------------------------------------------------ */

type DeleteSessionDialogProps = {
  session: Session | null;
  onClose: () => void;
  onDelete: (sessionId: string) => Promise<void>;
};

export function DeleteSessionDialog({
  session,
  onClose,
  onDelete,
}: DeleteSessionDialogProps) {
  const [pending, setPending] = useState(false);

  const handleDelete = useCallback(async () => {
    if (!session) return;
    setPending(true);
    try {
      await onDelete(session.id);
      onClose();
    } catch {
      // ignore
    } finally {
      setPending(false);
    }
  }, [onDelete, onClose, session]);

  return (
    <AlertDialog open={session !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete session</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete &ldquo;{session?.title}&rdquo; and all its transcript data. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="!bg-destructive !text-white hover:!bg-destructive/90"
            disabled={pending}
            onClick={() => void handleDelete()}
          >
            {pending ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/*  CLI setup dialog (re-export for convenience)                       */
/* ------------------------------------------------------------------ */

export { CliSetupDialog } from "@/components/sessions/cli-setup-dialog";
