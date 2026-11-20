"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  CATEGORIES,
  CONDITIONS,
  DESCRIPTION_MAX,
  MAX_TOOLS_PER_USER,
  NAME_MAX,
  VISIBLE_TEXT,
} from "../../convex/lib/toolOptions";
import { dangerButton, primaryButton, quietButton } from "./button-styles";
import { ToolPhotos } from "./tool-photos";

type Tool = FunctionReturnType<typeof api.tools.listMine>[number];
type ToolInput = Pick<Tool, "name" | "category" | "condition" | "description">;
type FormValues = { name: string; category: string; condition: string; description: string };

const EMPTY: FormValues = { name: "", category: "", condition: "", description: "" };
const fieldClass = "mt-1 block min-h-10 w-full rounded-md border bg-surface px-3 py-2";
type Field = "name" | "category" | "condition" | "description";

/** Plain wording for a failed call. Anything without a known code (validator, network) gets the fallback. */
function messageFor(error: unknown, action = "save this") {
  const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
  switch (code) {
    case "LIMIT_REACHED":
      return `You have reached the limit of ${MAX_TOOLS_PER_USER} tools. Delete one to add another.`;
    case "NOT_FOUND":
      return "This tool no longer exists.";
    case "FORBIDDEN":
      return "You can only change tools you listed.";
    case "INVALID_INPUT":
      return `Check the name and description: both are required (up to ${NAME_MAX} and ${DESCRIPTION_MAX} characters).`;
    default:
      return `We could not ${action}. Try again.`;
  }
}

/** The add and edit form. The server re-checks everything; these checks only save a round trip. */
function ToolForm({
  initial,
  submitLabel,
  clearOnSuccess,
  deleted,
  onSubmit,
  onCancel,
}: {
  initial: FormValues;
  submitLabel: string;
  clearOnSuccess?: boolean;
  deleted?: boolean;
  onSubmit: (tool: ToolInput) => Promise<void>;
  onCancel: () => void;
}) {
  const uid = useId();
  const [values, setValues] = useState(initial);
  // `field` is the one input to outline; a server error that names no field outlines none.
  const [error, setError] = useState<{ text: string; field?: Field } | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false); // blocks a second submit in the same tick, before state updates
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const errorId = `${uid}-error`;
  // Each input points at its helper line (if any) and, when it is the one in error, at the message.
  const props = (field: Field, helper?: string) => ({
    "aria-invalid": error?.field === field || undefined,
    "aria-describedby": [helper && `${uid}-${field}-hint`, error?.field === field && errorId].filter(Boolean).join(" ") || undefined,
    className: `${fieldClass} ${error?.field === field ? "border-danger" : "border-border"}`,
  });

  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  const set = (field: keyof FormValues) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [field]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    if (deleted) return setError({ text: "This tool was deleted, so it cannot be saved. Choose Cancel to close the form." });
    const name = values.name.trim();
    const description = values.description.trim();
    const category = CATEGORIES.find((c) => c === values.category);
    const condition = CONDITIONS.find((c) => c === values.condition);
    if (!VISIBLE_TEXT.test(name) || name.length > NAME_MAX) return setError({ text: `Enter a name of up to ${NAME_MAX} characters.`, field: "name" });
    if (!category) return setError({ text: "Choose a category.", field: "category" });
    if (!condition) return setError({ text: "Choose a condition.", field: "condition" });
    if (!VISIBLE_TEXT.test(description) || description.length > DESCRIPTION_MAX) {
      return setError({ text: `Enter a description of up to ${DESCRIPTION_MAX} characters.`, field: "description" });
    }
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await onSubmit({ name, category, condition, description });
      if (clearOnSuccess) {
        setValues(EMPTY);
        nameRef.current?.focus();
      }
    } catch (caught) {
      setError({ text: messageFor(caught) });
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="rounded-md border border-border bg-surface p-4">
      {deleted && (
        <p role="status" className="mb-3 font-semibold">This tool was deleted. Cancel to close this form.</p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          Name
          <input
            ref={nameRef}
            {...props("name", "hint")}
            value={values.name}
            onChange={set("name")}
            maxLength={NAME_MAX}
            readOnly={pending}
            required
            placeholder="e.g. Cordless drill"
          />
          <span id={`${uid}-name-hint`} className="mt-1 block text-sm text-muted">
            Up to {NAME_MAX} characters.
          </span>
        </label>
        <label className="block">
          Category
          {/* Selects cannot be read-only, so they are disabled while saving; focus stays on the submit button. */}
          <select
            {...props("category")}
            value={values.category}
            onChange={set("category")}
            disabled={pending}
            required
          >
            <option value="">Choose a category</option>
            {CATEGORIES.map((category) => (
              <option key={category}>{category}</option>
            ))}
          </select>
        </label>
        <label className="block">
          Condition
          <select
            {...props("condition")}
            value={values.condition}
            onChange={set("condition")}
            disabled={pending}
            required
          >
            <option value="">Choose a condition</option>
            {CONDITIONS.map((condition) => (
              <option key={condition}>{condition}</option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          Description
          <textarea
            {...props("description", "hint")}
            rows={3}
            value={values.description}
            onChange={set("description")}
            maxLength={DESCRIPTION_MAX}
            readOnly={pending}
            required
            placeholder="What it is and how to look after it"
          />
          <span id={`${uid}-description-hint`} className="mt-1 block text-sm text-muted">
            Up to {DESCRIPTION_MAX} characters.
          </span>
        </label>
      </div>
      {error && (
        <p ref={errorRef} id={errorId} role="alert" tabIndex={-1} className="mt-3 font-semibold text-danger">
          {error.text}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={primaryButton} aria-disabled={pending || deleted}>
          {pending ? "Saving…" : submitLabel}
        </button>
        <button type="button" className={quietButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function MyListings() {
  const tools = useQuery(api.tools.listMine, {});
  const create = useMutation(api.tools.create);
  const update = useMutation(api.tools.update);
  const remove = useMutation(api.tools.remove);

  const [adding, setAdding] = useState(false);
  // The edit state keeps its own copy of the tool and its place, so the form survives the tool being
  // deleted in another tab.
  const [editing, setEditing] = useState<{ tool: Tool; index: number } | null>(null);
  const [confirmId, setConfirmId] = useState<Id<"tools"> | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  // Where focus goes after the next render. A ref, because every call site also changes state.
  type FocusTarget = "add" | { edit: Id<"tools"> } | { del: Id<"tools"> };
  const focusTarget = useRef<FocusTarget | null>(null);
  const setFocusTarget = (target: FocusTarget) => {
    focusTarget.current = target;
  };
  const deleting = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const cancelDelete = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const deleteButtons = useRef(new Map<string, HTMLButtonElement>());
  const lastFocused = useRef<HTMLElement | null>(null);

  // A confirmation for a tool that vanished (deleted in another tab) stops rendering; the focus rule above recovers.
  const confirming = tools?.some((tool) => tool._id === confirmId) ? confirmId : null;

  useEffect(() => {
    const target = focusTarget.current;
    focusTarget.current = null;
    if (target) {
      const element =
        target === "add"
          ? addButton.current
          : "edit" in target
            ? editButtons.current.get(target.edit)
            : deleteButtons.current.get(target.del);
      element?.focus();
    } else if (
      document.activeElement === document.body &&
      lastFocused.current &&
      !lastFocused.current.isConnected
    ) {
      // The focused row, form or confirmation disappeared (for example deleted in another tab).
      addButton.current?.focus();
    }
  });

  useEffect(() => {
    if (confirming) cancelDelete.current?.focus();
  }, [confirming]);

  async function confirmDelete(tool: Tool) {
    if (deleting.current) return;
    deleting.current = true;
    setDeleteError(null);
    setStatus("");
    try {
      await remove({ id: tool._id });
      setConfirmId(null);
      setStatus(`Deleted ${tool.name}`);
      setFocusTarget("add");
    } catch (caught) {
      setDeleteError(messageFor(caught, "delete this"));
    } finally {
      deleting.current = false;
    }
  }

  const rows = tools ?? [];
  const list = [...rows];
  const orphaned = editing !== null && !rows.some((tool) => tool._id === editing.tool._id);
  if (editing && orphaned) list.splice(Math.min(editing.index, list.length), 0, editing.tool);

  return (
    <div
      className="mt-8"
      onFocus={(event) => {
        lastFocused.current = event.target as HTMLElement;
      }}
    >
      <p role="status" className="sr-only">
        {status}
      </p>
      <button
        ref={addButton}
        type="button"
        className={primaryButton}
        aria-expanded={adding}
        onClick={() => {
          setAdding((open) => !open);
          setEditing(null);
        }}
      >
        Add a tool
      </button>

      {adding && (
        <div className="mt-4">
          <ToolForm
            initial={EMPTY}
            submitLabel="Add tool"
            clearOnSuccess
            onSubmit={async (tool) => {
              setStatus("");
              await create(tool);
              setStatus(`Added ${tool.name}`);
            }}
            onCancel={() => {
              setAdding(false);
              setFocusTarget("add");
            }}
          />
        </div>
      )}

      {tools === undefined ? (
        <div role="status" aria-busy="true" className="mt-6 space-y-3">
          <span className="sr-only">Loading your tools</span>
          <div className="h-20 rounded-md border border-border bg-surface" />
          <div className="h-20 rounded-md border border-border bg-surface" />
        </div>
      ) : list.length === 0 && !adding ? (
        <div className="mt-6 rounded-md border border-dashed border-border p-6">
          <p className="font-medium">You have not listed any tools yet.</p>
          <p className="mt-1 text-sm text-muted">Choose Add a tool to list your first one.</p>
        </div>
      ) : list.length > 0 && (
        <ul className="mt-6 space-y-3">
          {list.map((tool) => (
            <li key={tool._id}>
              {editing?.tool._id === tool._id ? (
                <ToolForm
                  initial={editing.tool}
                  submitLabel="Save"
                  deleted={orphaned}
                  onSubmit={async (changes) => {
                    setStatus("");
                    await update({ id: tool._id, ...changes });
                    // A slow save can finish after this form was closed; only touch the page if it is still open.
                    setEditing((current) => (current?.tool._id === tool._id ? null : current));
                    setStatus(`Saved ${changes.name}`);
                    setFocusTarget({ edit: tool._id });
                  }}
                  onCancel={() => {
                    setEditing(null);
                    setFocusTarget(orphaned ? "add" : { edit: tool._id });
                  }}
                />
              ) : (
                <div className="rounded-md border border-border bg-surface p-4">
                  <h2 className="text-lg font-semibold break-words">{tool.name}</h2>
                  <p className="mt-1 flex flex-wrap gap-2 text-sm text-muted">
                    <span className="rounded-full border border-border px-2">
                      <span className="sr-only">Category: </span>
                      {tool.category}
                    </span>
                    <span className="rounded-full border border-border px-2">
                      <span className="sr-only">Condition: </span>
                      {tool.condition}
                    </span>
                  </p>
                  <p className="mt-3 break-words whitespace-pre-line">{tool.description}</p>
                  <ToolPhotos tool={tool} announce={setStatus} />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={quietButton}
                      ref={(element) => {
                        if (element) editButtons.current.set(tool._id, element);
                        else editButtons.current.delete(tool._id);
                      }}
                      onClick={() => {
                        setEditing({ tool, index: rows.findIndex((row) => row._id === tool._id) });
                        setAdding(false);
                        setConfirmId(null);
                      }}
                    >
                      Edit<span className="sr-only"> {tool.name}</span>
                    </button>
                    <button
                      type="button"
                      className={quietButton}
                      ref={(element) => {
                        if (element) deleteButtons.current.set(tool._id, element);
                        else deleteButtons.current.delete(tool._id);
                      }}
                      onClick={() => {
                        setDeleteError(null);
                        setConfirmId(tool._id);
                      }}
                    >
                      Delete<span className="sr-only"> {tool.name}</span>
                    </button>
                  </div>
                  {confirming === tool._id && (
                    <div className="mt-3 border-t border-border pt-3">
                      <p className="break-words font-semibold">Delete {tool.name}? This cannot be undone.</p>
                      {deleteError && (
                        <p role="alert" className="mt-1 text-danger">
                          {deleteError}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          ref={cancelDelete}
                          type="button"
                          className={quietButton}
                          onClick={() => {
                            setConfirmId(null);
                            setFocusTarget({ del: tool._id });
                          }}
                        >
                          Cancel
                        </button>
                        <button type="button" className={dangerButton} onClick={() => confirmDelete(tool)}>
                          Yes, delete<span className="sr-only"> {tool.name}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
