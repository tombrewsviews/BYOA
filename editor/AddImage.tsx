/**
 * "+ Image" button. Opens the file picker, copies the chosen image
 * into `<project>/assets/`, calls onImported with the absolute path.
 *
 * Smaller than AddVideo since there's no URL/download flow — image
 * URLs from the web rot too easily and aren't worth the complexity.
 */
import React, { useState } from "react";
import { isTauri } from "./runtime";
import { AddItemButton } from "./AddItemButton";

type Props = {
  onImported: (absolutePath: string) => void;
};

export const AddImage: React.FC<Props> = ({ onImported }) => {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pickFile = async () => {
    setError(null);
    if (!isTauri()) {
      setError("File picker only works in the desktop app.");
      return;
    }
    try {
      setBusy(true);
      const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
      const picked = await openDialog({
        directory: false,
        multiple: false,
        filters: [
          {
            name: "Image",
            extensions: ["jpg", "jpeg", "png", "webp", "gif", "avif"],
          },
        ],
      });
      if (typeof picked !== "string") {
        setBusy(false);
        return;
      }
      const { invoke } = await import("@tauri-apps/api/core");
      const dest = await invoke<string>("import_local_image", {
        source: picked,
      });
      setBusy(false);
      onImported(dest);
    } catch (e) {
      setBusy(false);
      setError(`Import failed: ${(e as Error).message ?? e}`);
    }
  };

  return (
    <div className="relative inline-flex flex-col gap-1">
      <AddItemButton
        label={busy ? "…" : "+ Image"}
        onClick={() => void pickFile()}
        disabled={busy}
        title="Add image"
      />
      {error && (
        <div className="absolute bottom-full mb-1 max-w-[240px] rounded-md border border-destructive/40 bg-destructive/15 px-2 py-1 text-[10px] text-destructive">
          {error}
        </div>
      )}
    </div>
  );
};
