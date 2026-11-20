"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { PHOTO_MAX, PHOTO_MAX_BYTES, PHOTO_TYPES } from "../../convex/lib/toolOptions";
import { quietButton } from "./button-styles";

type Tool = FunctionReturnType<typeof api.tools.listMine>[number];

const MAX_SIDE = 1600;
const MB = PHOTO_MAX_BYTES / (1024 * 1024);
const TYPE_HELP = "Choose a JPEG, PNG or WebP photo.";

/** Redraws the photo as a JPEG (at most MAX_SIDE on the long side, white behind transparency). The new file carries no Exif or GPS data. */
async function reencode(file: File) {
  const bitmap = await createImageBitmap(file); // modern browsers apply the photo's rotation here
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    throw new Error("no canvas");
  }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  // toBlob quietly falls back to PNG when it cannot encode JPEG.
  if (blob?.type !== "image/jpeg") throw new Error("encode failed");
  return blob;
}

function messageFor(error: unknown) {
  const code = error instanceof ConvexError ? (error.data as { code?: string })?.code : undefined;
  switch (code) {
    case "PHOTO_LIMIT":
      return `This tool already has ${PHOTO_MAX} photos. Remove one to add another.`;
    case "NOT_FOUND":
      return "This tool no longer exists.";
    case "FORBIDDEN":
      return "You can only add photos to tools you listed.";
    default:
      return "We could not add that photo. Try again.";
  }
}

/** Photos of one of the owner's tools: add (up to PHOTO_MAX), see and remove. The server re-checks every rule. */
export function ToolPhotos({ tool, announce }: { tool: Tool; announce: (text: string) => void }) {
  const makeUrl = useMutation(api.tools.generatePhotoUploadUrl);
  const attach = useMutation(api.tools.addPhoto);
  const detach = useMutation(api.tools.removePhoto);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<"add" | "remove" | null>(null);
  const busy = useRef(false); // blocks a second pick or remove while one is running
  const input = useRef<HTMLInputElement>(null);
  const count = useRef<HTMLParagraphElement>(null);
  const focusAfter = useRef<"add" | "count" | null>(null);
  const full = tool.photos.length >= PHOTO_MAX;

  // Where focus goes once the list has re-rendered: the add control after a remove, the count when adding filled it up.
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === "add") input.current?.focus();
    else if (target === "count") count.current?.focus();
  });

  async function run(action: "add" | "remove", job: () => Promise<void>) {
    if (busy.current) return setError("Wait for the current photo action to finish.");
    busy.current = true;
    setWorking(action);
    setError(null);
    announce(""); // so a repeat message is announced again
    try {
      await job();
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  const pick = (file: File) =>
    run("add", async () => {
      if (tool.photos.length >= PHOTO_MAX) return setError(`This tool already has ${PHOTO_MAX} photos. Remove one to add another.`);
      if (!PHOTO_TYPES.includes(file.type)) return setError(TYPE_HELP);
      let photo: Blob;
      try {
        photo = await reencode(file);
      } catch {
        return setError("We could not read that photo. Try a different one.");
      }
      if (photo.size > PHOTO_MAX_BYTES) return setError(`That photo is over ${MB} MB even after resizing. Try a smaller one.`);
      const response = await fetch(await makeUrl({ id: tool._id }), {
        method: "POST",
        headers: { "Content-Type": photo.type },
        body: photo,
      });
      if (!response.ok) throw new Error("upload failed");
      const { storageId } = await response.json();
      const result = await attach({ id: tool._id, storageId });
      if (!result.ok) {
        return setError(
          result.code === "PHOTO_LIMIT"
            ? `This tool already has ${PHOTO_MAX} photos. Remove one to add another.`
            : `That file could not be added. Use a JPEG, PNG or WebP photo under ${MB} MB.`,
        );
      }
      focusAfter.current = tool.photos.length + 1 >= PHOTO_MAX ? "count" : null;
      announce(`Photo added to ${tool.name}`);
    });

  const remove = (photo: Tool["photos"][number]) =>
    run("remove", async () => {
      await detach({ id: tool._id, storageId: photo.id });
      focusAfter.current = "add";
      announce(`Photo removed from ${tool.name}`);
    });

  return (
    <div className="mt-4 border-t border-border pt-3">
      <p ref={count} tabIndex={-1} className="text-sm font-medium">
        {tool.photos.length} of {PHOTO_MAX} photos{full ? ". Remove one to add another." : ""}
      </p>
      {tool.photos.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-3">
          {tool.photos.map((photo, i) => (
            <li key={photo.id} className="flex w-24 flex-col gap-2">
              <Image
                src={photo.url}
                alt={`Photo ${i + 1} of ${tool.name}`}
                width={96}
                height={72}
                unoptimized
                className="aspect-[4/3] w-24 rounded-md border border-border object-cover"
              />
              <button type="button" className={`${quietButton} px-2 text-sm`} onClick={() => remove(photo)}>
                Remove<span className="sr-only"> photo {i + 1} of {tool.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">
            Add a photo<span className="sr-only"> to {tool.name}</span>
          </span>
          <input
            ref={input}
            type="file"
            accept={PHOTO_TYPES.join(",")}
            className="block w-full max-w-full text-sm file:mr-3 file:min-h-10 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:py-2 file:font-medium file:text-foreground"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = ""; // lets the same file be chosen again
              if (file) pick(file);
            }}
          />
        </label>
      )}
      <p role="status" className={working === "add" ? "mt-2 text-sm text-muted" : "sr-only"}>
        {working === "add" ? "Uploading…" : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
