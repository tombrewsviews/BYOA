import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder } from "../../icons";
import { ChartView } from "./Chart";
import type {
  ChartSpec,
  ChartType,
  GraphDoc,
  GraphNode,
  SemanticOp,
  SemanticSpec,
  SourceSpec,
} from "../../../src/data/schema";

/** Per-node evaluation result, mirroring the `data_evaluate` command's camelCase shape. */
type NodeResult = {
  columns: { name: string; type: string }[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  error: string | null;
};

const SEMANTIC_OPS: SemanticOp[] = ["filter", "classify", "extract", "label"];
const CHART_TYPES: ChartType[] = ["table", "bar", "line", "scatter"];

const FIELD_LABEL = "mb-1 block text-xs font-medium text-foreground";
const SECTION = "flex flex-col gap-3";
const SELECT_CLASS =
  "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const TEXTAREA_CLASS =
  "min-h-20 w-full rounded-md border border-input bg-transparent p-2 font-mono text-xs text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

const FILE_KINDS: Record<string, SourceSpec["fileKind"]> = {
  csv: "csv",
  parquet: "parquet",
  json: "json",
};

const fileKindFromPath = (path: string): SourceSpec["fileKind"] => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return FILE_KINDS[ext] ?? "csv";
};

/** Read-only schema/row-count summary from a node's result. */
const ResultSummary: React.FC<{ result: NodeResult | null }> = ({ result }) => {
  if (!result) return <div className="text-xs text-muted-foreground">Not run yet.</div>;
  if (result.error) return <div className="text-xs text-destructive">{result.error}</div>;
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs text-muted-foreground">
        {result.rowCount} rows{result.truncated ? " (truncated)" : ""}
      </div>
      <div className="flex flex-col rounded-md border border-border">
        {result.columns.map((c) => (
          <div key={c.name} className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
            <span className="truncate text-foreground">{c.name}</span>
            <span className="text-muted-foreground">{c.type}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SourceBody: React.FC<{
  node: GraphNode;
  result: NodeResult | null;
  patch: (next: Partial<GraphNode>) => void;
}> = ({ node, result, patch }) => {
  const source = node.source ?? { path: "", fileKind: "csv" as const };
  const choose = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "Data", extensions: ["csv", "parquet", "json"] }],
    });
    if (typeof picked !== "string") return;
    patch({ source: { path: picked, fileKind: fileKindFromPath(picked) } });
  };
  return (
    <div className={SECTION}>
      <div>
        <span className={FIELD_LABEL}>File</span>
        <Button variant="secondary" size="sm" onClick={() => void choose()}>
          <Folder className="size-4" />
          Choose file…
        </Button>
        {source.path ? (
          <div className="mt-1 break-all text-xs text-muted-foreground">
            {source.path} <span className="uppercase">({source.fileKind})</span>
          </div>
        ) : null}
      </div>
      <div>
        <span className={FIELD_LABEL}>Result</span>
        <ResultSummary result={result} />
      </div>
    </div>
  );
};

const SqlBody: React.FC<{
  node: GraphNode;
  doc: GraphDoc;
  result: NodeResult | null;
  patch: (next: Partial<GraphNode>) => void;
}> = ({ node, doc, result, patch }) => {
  const upstream = doc.edges
    .filter((e) => e.to === node.id)
    .map((e) => doc.nodes.find((n) => n.id === e.from))
    .filter((n): n is GraphNode => !!n);
  return (
    <div className={SECTION}>
      <div>
        <span className={FIELD_LABEL}>SQL</span>
        <textarea
          className={TEXTAREA_CLASS}
          value={node.sql ?? ""}
          spellCheck={false}
          onChange={(e) => patch({ sql: e.target.value })}
          placeholder="SELECT * FROM {{upstream_id}}"
        />
      </div>
      {upstream.length ? (
        <div>
          <span className={FIELD_LABEL}>Reference upstream as</span>
          <div className="flex flex-col gap-1">
            {upstream.map((u) => (
              <div key={u.id} className="text-xs text-muted-foreground">
                <code className="text-foreground">{`{{${u.id}}}`}</code>
                {u.title ? ` — ${u.title}` : ""}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {result ? (
        <div>
          <span className={FIELD_LABEL}>Result columns</span>
          <ResultSummary result={result} />
        </div>
      ) : null}
    </div>
  );
};

const SemanticBody: React.FC<{
  node: GraphNode;
  result: NodeResult | null;
  patch: (next: Partial<GraphNode>) => void;
}> = ({ node, result, patch }) => {
  const spec: SemanticSpec = node.semantic ?? {
    op: "classify",
    inputColumn: "",
    outputColumn: "",
    instruction: "",
    labels: [],
    sampleLimit: 100,
  };
  const setSpec = (next: Partial<SemanticSpec>) => patch({ semantic: { ...spec, ...next } });
  // Column options come from the selected node's own result when available; otherwise
  // fall back to a free-text input so the field always works without an upstream schema.
  const columns = result && !result.error ? result.columns.map((c) => c.name) : [];
  return (
    <div className={SECTION}>
      <div>
        <span className={FIELD_LABEL}>Operation</span>
        <select
          className={SELECT_CLASS}
          value={spec.op}
          onChange={(e) => setSpec({ op: e.target.value as SemanticOp })}
        >
          {SEMANTIC_OPS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
      </div>
      <div>
        <span className={FIELD_LABEL}>Input column</span>
        {columns.length ? (
          <select
            className={SELECT_CLASS}
            value={spec.inputColumn}
            onChange={(e) => setSpec({ inputColumn: e.target.value })}
          >
            <option value="">Select column…</option>
            {columns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <Input
            value={spec.inputColumn}
            onChange={(e) => setSpec({ inputColumn: e.target.value })}
            placeholder="Column name"
          />
        )}
      </div>
      <div>
        <span className={FIELD_LABEL}>Output column</span>
        <Input
          value={spec.outputColumn}
          onChange={(e) => setSpec({ outputColumn: e.target.value })}
          placeholder="New column name"
        />
      </div>
      <div>
        <span className={FIELD_LABEL}>Instruction</span>
        <textarea
          className={TEXTAREA_CLASS}
          value={spec.instruction}
          onChange={(e) => setSpec({ instruction: e.target.value })}
          placeholder="What should the model do with each row?"
        />
      </div>
      <div>
        <span className={FIELD_LABEL}>Labels (comma-separated)</span>
        <Input
          value={spec.labels.join(", ")}
          onChange={(e) =>
            setSpec({
              labels: e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="positive, negative, neutral"
        />
      </div>
      <div>
        <span className={FIELD_LABEL}>Sample limit</span>
        <Input
          type="number"
          value={spec.sampleLimit}
          onChange={(e) => setSpec({ sampleLimit: Number(e.target.value) || 0 })}
        />
      </div>
    </div>
  );
};

const ChartBody: React.FC<{
  node: GraphNode;
  result: NodeResult | null;
  patch: (next: Partial<GraphNode>) => void;
}> = ({ node, result, patch }) => {
  const spec: ChartSpec = node.chart ?? { type: "table", x: null, y: null, color: null };
  const setSpec = (next: Partial<ChartSpec>) => patch({ chart: { ...spec, ...next } });
  const columns = result && !result.error ? result.columns.map((c) => c.name) : [];

  const colSelect = (
    label: string,
    key: "x" | "y" | "color",
    allowNone: boolean,
  ) => (
    <div>
      <span className={FIELD_LABEL}>{label}</span>
      <select
        className={SELECT_CLASS}
        value={spec[key] ?? ""}
        onChange={(e) => setSpec({ [key]: e.target.value || null } as Partial<ChartSpec>)}
      >
        <option value="">{allowNone ? "None" : "Select column…"}</option>
        {columns.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={SECTION}>
      <div>
        <span className={FIELD_LABEL}>Type</span>
        <select
          className={SELECT_CLASS}
          value={spec.type}
          onChange={(e) => setSpec({ type: e.target.value as ChartType })}
        >
          {CHART_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {spec.type !== "table" ? (
        <>
          {colSelect("X", "x", false)}
          {colSelect("Y", "y", false)}
          {colSelect("Color", "color", true)}
          <div>
            <span className={FIELD_LABEL}>Preview</span>
            {result && !result.error ? (
              <ChartView
                viz={spec}
                columns={result.columns.map((c) => c.name)}
                rows={result.rows}
              />
            ) : (
              <div className="text-xs text-muted-foreground">No result to preview.</div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
};

export const Inspector: React.FC<{
  doc: GraphDoc;
  result: NodeResult | null;
  onChange: (next: GraphDoc) => void;
}> = ({ doc, result, onChange }) => {
  const node = doc.nodes.find((n) => n.id === doc.selected);
  if (!node) return <div className="text-sm text-muted-foreground">Select a node.</div>;

  // Replace the selected node with an edited copy, immutably.
  const patch = (next: Partial<GraphNode>) => {
    const edited = { ...node, ...next };
    onChange({ ...doc, nodes: doc.nodes.map((n) => (n.id === node.id ? edited : n)) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className={FIELD_LABEL}>Title</span>
        <Input value={node.title} onChange={(e) => patch({ title: e.target.value })} />
      </div>
      {node.kind === "source" ? (
        <SourceBody node={node} result={result} patch={patch} />
      ) : node.kind === "sql" ? (
        <SqlBody node={node} doc={doc} result={result} patch={patch} />
      ) : node.kind === "semantic" ? (
        <SemanticBody node={node} result={result} patch={patch} />
      ) : (
        <ChartBody node={node} result={result} patch={patch} />
      )}
    </div>
  );
};
