// Affichage lisible d'un diff unifié (texte brut, jamais interprété comme HTML) : fichiers repliables,
// lignes ajoutées/supprimées colorées, numéros de ligne.
import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { FileIcon } from "../lib/file-icons.tsx";
import { cx } from "./primitives.tsx";

interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface DiffFile {
  path: string;
  lines: DiffLine[];
  added: number;
  removed: number;
}

export function parseUnified(unified: string): DiffFile[] {
  const files: DiffFile[] = [];
  let cur: DiffFile | undefined;
  let oldNo = 0;
  let newNo = 0;
  for (const raw of unified.split("\n").slice(0, 20_000)) {
    if (raw.startsWith("diff --git ")) {
      const m = / b\/(.+)$/.exec(raw);
      cur = { path: m?.[1] ?? raw.slice(11), lines: [], added: 0, removed: 0 };
      files.push(cur);
      continue;
    }
    if (!cur) {
      cur = { path: "", lines: [], added: 0, removed: 0 };
      files.push(cur);
    }
    if (raw.startsWith("+++ ") || raw.startsWith("--- ")) {
      if (raw.startsWith("+++ ") && !cur.path) cur.path = raw.slice(4).replace(/^b\//, "");
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
      cur.lines.push({ kind: "hunk", text: raw });
      continue;
    }
    if (raw.startsWith("+")) {
      cur.lines.push({ kind: "add", text: raw.slice(1), newNo: newNo++ });
      cur.added++;
    } else if (raw.startsWith("-")) {
      cur.lines.push({ kind: "del", text: raw.slice(1), oldNo: oldNo++ });
      cur.removed++;
    } else if (raw.startsWith(" ")) {
      cur.lines.push({ kind: "ctx", text: raw.slice(1), oldNo: oldNo++, newNo: newNo++ });
    } else if (raw.trim()) {
      cur.lines.push({ kind: "meta", text: raw });
    }
  }
  return files.filter((f) => f.path || f.lines.length > 0);
}

function FileBlock({ file, onOpen }: { file: DiffFile; onOpen?: (path: string) => void }) {
  const [open, setOpen] = useState(true);
  const name = file.path.split("/").pop() ?? file.path;
  return (
    <section className="diff-file">
      <header className="diff-file-header">
        <button
          type="button"
          className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <FileIcon name={name} size={14} />
          <span className="truncate font-medium">{file.path}</span>
        </button>
        <span className="diff-stat-add">+{file.added}</span>
        <span className="diff-stat-del">−{file.removed}</span>
        {onOpen && file.path && (
          <button type="button" className="link-btn" onClick={() => onOpen(file.path)}>
            ↔
          </button>
        )}
      </header>
      {open && (
        <div className="diff-lines" role="table">
          {file.lines.map((l, i) => (
            <div key={i} className={cx("diff-line", `diff-${l.kind}`)} role="row">
              <span className="diff-no" aria-hidden>
                {l.oldNo ?? ""}
              </span>
              <span className="diff-no" aria-hidden>
                {l.newNo ?? ""}
              </span>
              <span className="diff-sign" aria-hidden>
                {l.kind === "add" ? "+" : l.kind === "del" ? "−" : ""}
              </span>
              <span className="diff-text">{l.text || " "}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function UnifiedDiff({
  unified,
  onOpen,
  only,
}: {
  unified: string;
  onOpen?: (path: string) => void;
  only?: string;
}) {
  const files = useMemo(() => parseUnified(unified), [unified]);
  const shown = only ? files.filter((f) => f.path === only) : files;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((f, i) => (
        <FileBlock key={`${f.path}-${i}`} file={f} onOpen={onOpen} />
      ))}
    </div>
  );
}
