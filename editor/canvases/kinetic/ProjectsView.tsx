/**
 * Home view: lists projects under ~/KineticStudio, supports creating
 * new projects, opening an arbitrary folder, and basic context-menu
 * actions per card.
 */
import React, { useEffect, useRef, useState } from "react";
import { color, radius } from "../../platform/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type ProjectMeta = {
  name: string;
  path: string;
  beats: number;
  lastOpened: string;
  /** Absolute path to the cached preview MP4, if rendered. */
  previewPath?: string | null;
  /** True if story.json has been edited since the preview was rendered. */
  previewStale?: boolean;
};

const fmtAgo = (iso: string) => {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const ms = Math.max(0, now - then);
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
};

export const ProjectsView: React.FC = () => {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const list = await invoke<ProjectMeta[]>("projects_list");
      setProjects(list);
    } catch (e) {
      setError(`Failed to list projects: ${(e as Error).message}`);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  const openProject = async (path: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_open", { path });
    } catch (e) {
      setError(`Open failed: ${(e as Error).message}`);
    }
  };

  // Move the project folder to the macOS Trash. Recoverable from
  // Trash if the user changes their mind. The Rust side uses the
  // `trash` crate, which routes through Finder's recycle path.
  const deleteProject = async (path: string) => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      await invoke("project_delete", { path });
      await refresh();
    } catch (e) {
      setError(`Delete failed: ${(e as Error).message}`);
    }
  };

  const createProject = async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const meta = await invoke<ProjectMeta>("projects_create", {
        name: newName,
      });
      setNewName("");
      await openProject(meta.path);
    } catch (e) {
      setError(`Create failed: ${(e as Error).message}`);
    }
  };

  const openFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true });
    if (typeof picked === "string") {
      await openProject(picked);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto bg-background p-10 text-muted-foreground">
      <h1 className="text-[22px] font-bold text-foreground">Kinetic Studio</h1>
      <div className="mb-6 mt-6 flex items-center gap-3">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          onKeyDown={(e) => {
            if (e.key === "Enter") void createProject();
          }}
          className="max-w-[320px] flex-1"
        />
        <Button onClick={() => void createProject()}>+ New project</Button>
        <Button variant="secondary" onClick={() => void openFolder()}>
          Open folder…
        </Button>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
        }}
      >
        {projects.map((p) => (
          <ProjectCard
            key={p.path}
            project={p}
            onOpen={openProject}
            onDelete={deleteProject}
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Square card with an optional video preview that plays on hover.
 * Stories render 9:16 portrait; the card uses `object-fit: cover` so
 * the portrait fills the square — its HEIGHT determines the scale and
 * the sides are cropped. Without a preview the card shows a gradient
 * placeholder with the project name.
 */
const ProjectCard: React.FC<{
  project: ProjectMeta;
  onOpen: (path: string) => void;
  onDelete: (path: string) => Promise<void>;
}> = ({ project, onOpen, onDelete }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Resolve the preview's file path → asset:// URL the webview can load.
  // Cache-busts on mtime so a re-rendered preview shows up immediately
  // (without ?v=… the webview would cache the old file forever).
  useEffect(() => {
    let cancelled = false;
    if (!project.previewPath) {
      setSrc(null);
      return;
    }
    void (async () => {
      try {
        const { convertFileSrc } = await import("@tauri-apps/api/core");
        const base = convertFileSrc(project.previewPath!);
        // lastOpened ≈ a per-card cache-bust token; close→render→new
        // lastOpened on next list.
        const url = `${base}?v=${encodeURIComponent(project.lastOpened)}`;
        if (!cancelled) {
          console.debug("[preview]", project.name, project.previewPath, "→", url);
          setSrc(url);
        }
      } catch (err) {
        console.warn("[preview] convertFileSrc failed", err);
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.previewPath, project.lastOpened, project.name]);

  // Seek to the middle of the video for the still-frame poster. The
  // user wanted "middle of the project" so there's a better chance of
  // showing visible content than the empty pre-animation frame 0.
  const seekToMiddle = (v: HTMLVideoElement) => {
    try {
      if (Number.isFinite(v.duration) && v.duration > 0) {
        v.currentTime = v.duration / 2;
      }
    } catch {
      /* ignore */
    }
  };

  const onEnter = () => {
    setHovered(true);
    const v = videoRef.current;
    if (!v) return;
    void v.play().catch(() => {
      /* autoplay-policy edge */
    });
  };
  const onLeave = () => {
    setHovered(false);
    setConfirmDelete(false);
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    seekToMiddle(v);
  };

  return (
    // Outer is a div role="button" rather than a real <button> so we can
    // nest the delete <button> inside without violating HTML or having
    // its click bubble up to "open project".
    <div
      role="button"
      tabIndex={0}
      onClick={() => void onOpen(project.path)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          void onOpen(project.path);
        }
      }}
      onMouseEnter={(e) => {
        onEnter();
        (e.currentTarget as HTMLDivElement).style.borderColor =
          color.border.hover;
      }}
      onMouseLeave={(e) => {
        onLeave();
        (e.currentTarget as HTMLDivElement).style.borderColor =
          color.border.line;
      }}
      style={{
        position: "relative",
        textAlign: "left",
        background: color.bg.hover,
        border: `1px solid ${color.border.line}`,
        borderRadius: radius.xl,
        padding: 0,
        color: color.text.secondary,
        cursor: "pointer",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* SQUARE preview region — aspect-ratio: 1 makes it a square
          regardless of the card's grid width. */}
      <div
        style={{
          width: "100%",
          aspectRatio: "1 / 1",
          background:
            "linear-gradient(135deg, #1c1432 0%, #0b0b14 60%, #14141c 100%)",
          overflow: "hidden",
          position: "relative",
        }}
      >
        {src ? (
          <video
            ref={videoRef}
            src={src}
            loop
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => {
              // Show the middle frame as a still while paused — first
              // frames of kinetic-type stories are often empty (text
              // hasn't entered yet), middle is where the action is.
              seekToMiddle(e.currentTarget as HTMLVideoElement);
            }}
            onError={(e) => {
              const err = (e.currentTarget as HTMLVideoElement).error;
              console.warn("[preview] video error", project.name, err);
            }}
            style={{
              display: "block",
              width: "100%",
              height: "100%",
              // cover: the 9:16 portrait fills the square — its HEIGHT
              // is the scale-driver, sides crop. This is the right
              // fit per the user's "whatever is bigger" requirement.
              objectFit: "cover",
              pointerEvents: "none",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: color.text.dim,
              fontSize: 32,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
              opacity: 0.6,
            }}
          >
            {project.name.slice(0, 2)}
          </div>
        )}
        {/* Stale-preview indicator: small amber dot, top-LEFT so it
            doesn't collide with the delete button (top-right). */}
        {project.previewStale && project.previewPath && (
          <div
            title="Preview is older than the story — will refresh on next close."
            style={{
              position: "absolute",
              top: 8,
              left: 8,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#facc15",
              boxShadow: "0 0 6px rgba(250,204,21,0.7)",
            }}
          />
        )}
        {/* Delete button — appears on hover. First click swaps to a
            "Delete?" confirm; second click within the same hover trashes
            the project. Mouse-leave resets the confirm state. */}
        {hovered && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (confirmDelete) {
                void onDelete(project.path);
              } else {
                setConfirmDelete(true);
              }
            }}
            title={
              confirmDelete
                ? "Click again to move to Trash"
                : "Move project to Trash"
            }
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              padding: confirmDelete ? "4px 10px" : "4px 8px",
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 4,
              border: "1px solid",
              borderColor: confirmDelete ? color.danger.text : color.border.strong,
              background: confirmDelete
                ? "rgba(255,92,92,0.85)"
                : "rgba(10,10,16,0.85)",
              color: confirmDelete ? "white" : color.text.secondary,
              cursor: "pointer",
              backdropFilter: "blur(6px)",
              boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            }}
          >
            {confirmDelete ? "Delete?" : "×"}
          </button>
        )}
      </div>

      <div
        style={{
          padding: 12,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {project.name}
        </div>
        <div style={{ fontSize: 11, color: color.text.dim }}>
          {project.beats} beats · {fmtAgo(project.lastOpened)}
        </div>
      </div>
    </div>
  );
};
