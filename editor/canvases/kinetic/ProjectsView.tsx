/**
 * Home view: lists projects under ~/KineticStudio, supports creating
 * new projects, opening an arbitrary folder, and basic context-menu
 * actions per card.
 */
import React, { useEffect, useState } from "react";

export type ProjectMeta = {
  name: string;
  path: string;
  beats: number;
  lastOpened: string;
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
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#08080c",
        color: "#e4e4ee",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        padding: 40,
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 22 }}>Kinetic Studio</h1>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 24,
          marginBottom: 24,
        }}
      >
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New project name"
          onKeyDown={(e) => {
            if (e.key === "Enter") void createProject();
          }}
          style={{
            flex: 1,
            maxWidth: 320,
            background: "#1c1c26",
            border: "1px solid #2e2e3c",
            borderRadius: 6,
            color: "#e4e4ee",
            fontSize: 13,
            padding: "8px 12px",
          }}
        />
        <button
          onClick={() => void createProject()}
          style={{
            background: "#7c5cff",
            color: "white",
            border: "none",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          + New project
        </button>
        <button
          onClick={() => void openFolder()}
          style={{
            background: "#1c1c26",
            color: "#e4e4ee",
            border: "1px solid #2e2e3c",
            borderRadius: 6,
            padding: "8px 16px",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Open folder…
        </button>
      </div>

      {error && (
        <div
          style={{
            background: "#3a1c20",
            color: "#ff8b8b",
            padding: "8px 12px",
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 12,
          }}
        >
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
          <button
            key={p.path}
            onClick={() => void openProject(p.path)}
            style={{
              textAlign: "left",
              background: "#14141c",
              border: "1px solid #232330",
              borderRadius: 10,
              padding: 16,
              color: "#e4e4ee",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</div>
            <div
              style={{
                fontSize: 11,
                color: "#6b6b80",
                marginTop: 4,
              }}
            >
              {p.beats} beats · {fmtAgo(p.lastOpened)}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "#4b4b5a",
                marginTop: 8,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {p.path}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
