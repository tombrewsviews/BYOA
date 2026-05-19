/**
 * "+ Image" button. Opens the file picker, copies the chosen image
 * into `<project>/assets/`, calls onImported with the absolute path.
 *
 * Smaller than AddVideo since there's no URL/download flow — image
 * URLs from the web rot too easily and aren't worth the complexity.
 */
import React, { useState } from "react";
import { isTauri } from "./runtime";

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
    <div style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        onClick={() => void pickFile()}
        disabled={busy}
        title="Add image"
        style={{
          padding: "4px 12px",
          fontSize: 11,
          borderRadius: 4,
          border: "1px dashed #3a3a4c",
          background: "transparent",
          color: busy ? "#4b4b5a" : "#8b8b9a",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {busy ? "…" : "+ Image"}
      </button>
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            marginBottom: 4,
            background: "#3a1414",
            border: "1px solid #5a2020",
            color: "#ff8b8b",
            fontSize: 10,
            padding: "4px 8px",
            borderRadius: 4,
            maxWidth: 240,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
};
