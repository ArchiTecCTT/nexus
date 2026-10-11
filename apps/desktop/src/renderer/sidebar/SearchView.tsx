// Recherche de fichiers par nom (barre latérale) : résultats au fil de la frappe, navigation clavier, ouverture.
import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toNexusError, type NexusError } from "../api.ts";
import { useT } from "../i18n/index.ts";
import { FileIcon } from "../lib/file-icons.tsx";
import { matchIndices, type FuzzyHit } from "../lib/fuzzy.ts";
import { searchFiles } from "../lib/search.ts";
import { useProjectStore } from "../stores/project.ts";
import { EmptyState, ErrorNotice, SectionTitle, Spinner, cx } from "../ui/primitives.tsx";
import { openFile } from "../workbench/dock.ts";

export function Highlight({ text, query }: { text: string; query: string }) {
  const hits = matchIndices(query, text);
  if (hits.size === 0) return <>{text}</>;
  return (
    <>
      {Array.from(text).map((c, i) =>
        hits.has(i) ? (
          <mark key={i} className="hl">
            {c}
          </mark>
        ) : (
          <span key={i}>{c}</span>
        ),
      )}
    </>
  );
}

export function SearchView() {
  const t = useT();
  const projectId = useProjectStore((s) => s.current?.projectId);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<FuzzyHit[]>([]);
  const [error, setError] = useState<NexusError>();
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    if (!projectId || !query.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const timer = setTimeout(() => {
      searchFiles(projectId, query, 200).then(
        (r) => {
          if (!alive) return;
          setHits(r);
          setActive(0);
          setError(undefined);
          setLoading(false);
        },
        (e: unknown) => {
          if (!alive) return;
          setError(toNexusError(e, "files.search"));
          setLoading(false);
        },
      );
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [projectId, query]);

  return (
    <div className="sidebar-view" aria-label={t("view.search")}>
      <SectionTitle>{t("view.search")}</SectionTitle>
      <div className="px-3 pb-2">
        <div className="search-box">
          <Search size={14} aria-hidden className="text-fg-subtle" />
          <input
            ref={input}
            className="search-input"
            placeholder={t("search.placeholder")}
            aria-label={t("search.placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(hits.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter" && hits[active]) {
                openFile(hits[active].path, { preview: !e.altKey });
              }
            }}
          />
        </div>
        <div className="h-5 mt-1 flex items-center text-[11px] text-fg-subtle">
          {loading ? <Spinner /> : query.trim() ? t("search.results", { n: hits.length }) : ""}
        </div>
      </div>
      <div className="scroll-area flex-1" role="listbox" aria-label={t("search.results", { n: hits.length })}>
        <div className="px-2">
          <ErrorNotice error={error} compact />
        </div>
        {!query.trim() && (
          <EmptyState icon={<Search size={22} />} title={t("search.emptyTitle")}>
            {t("search.emptyBody")}
          </EmptyState>
        )}
        {query.trim() && !loading && hits.length === 0 && !error && (
          <p className="px-4 text-[12.5px] text-fg-subtle">{t("search.none")}</p>
        )}
        {hits.map((h, i) => {
          const name = h.path.split("/").pop() ?? h.path;
          const dir = h.path.slice(0, Math.max(0, h.path.length - name.length - 1));
          return (
            <button
              key={h.path}
              type="button"
              role="option"
              aria-selected={i === active}
              className={cx("result-row", i === active && "is-active")}
              onClick={() => {
                setActive(i);
                openFile(h.path, { preview: true });
              }}
              onDoubleClick={() => openFile(h.path, { preview: false })}
            >
              <FileIcon name={name} size={14} />
              <span className="truncate">
                <Highlight text={name} query={query} />
              </span>
              <span className="result-dir truncate">{dir}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
