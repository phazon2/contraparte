import { useState, useRef, useCallback } from "react";
import {
  Send,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────

type Verdict = "red" | "yellow" | "green";

interface PanelResult {
  model_name: string;
  status: string;
  verdict?: Verdict;
  risk_type?: string;
  plain_reason_es?: string;
  plain_reason_en?: string;
  suggested_redline?: string;
  error?: string;
}

interface PanelCardData {
  modelName: string;
  loading: boolean;
  result: PanelResult | null;
}

// ─── Constants ────────────────────────────────────────────────────

const EDGE_FN_URL =
  "https://bmwqujfpnawflnkcsicm.supabase.co/functions/v1/review-clause";

const MODEL_ORDER: { id: string }[] = [
  { id: "Hermes 3 (Llama 70B)" },
  { id: "Qwen 2.5 72B" },
  { id: "Mistral Small 3.2" },
];

const RISK_TYPE_MAP: Record<string, string> = {
  payment: "Pago",
  ip: "Propiedad intelectual",
  liability: "Responsabilidad",
  termination: "Terminación",
  exclusivity: "Exclusividad",
  jurisdiction: "Jurisdicción",
  confidentiality: "Confidencialidad",
  scope: "Alcance",
  non_compete: "No competencia",
  other: "Otro",
};

// ─── Helpers ──────────────────────────────────────────────────────

function verdictIcon(v: Verdict | null) {
  switch (v) {
    case "red":
      return <AlertTriangle className="w-4 h-4 shrink-0" />;
    case "yellow":
      return <AlertCircle className="w-4 h-4 shrink-0" />;
    case "green":
      return <CheckCircle className="w-4 h-4 shrink-0" />;
    default:
      return <Clock className="w-4 h-4 shrink-0" />;
  }
}

function verdictPillClasses(v: Verdict | null) {
  switch (v) {
    case "red":
      return "bg-roja-bg text-roja border-roja/40";
    case "yellow":
      return "bg-amarilla-bg text-amarilla border-amarilla/40";
    case "green":
      return "bg-verde-bg text-verde border-verde/40";
    default:
      return "bg-muted text-foreground/40 border-border";
  }
}

// ─── PanelCard ────────────────────────────────────────────────────

function PanelCard({ data: { modelName, loading, result } }: { data: PanelCardData }) {
  const showSkeleton = loading && !result;
  const showAnalyzing = loading && result;
  const showResult = !loading && result;

  // Determine card border color based on verdict
  const cardBorder =
    result?.verdict === "red"
      ? "border-roja/20"
      : result?.verdict === "yellow"
        ? "border-amarilla/20"
        : result?.verdict === "green"
          ? "border-verde/20"
          : "border-border";

  return (
    <div
      className={`rounded-xl border ${cardBorder} bg-card p-5 flex flex-col gap-3 transition-all duration-500 ${
        result ? "animate-[cardIn_0.4s_ease-out]" : ""
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="w-4 h-4 text-primary shrink-0" />
          <h3 className="font-heading text-[15px] font-semibold text-foreground truncate">
            {modelName}
          </h3>
        </div>
        <span
          className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider border transition-all duration-300 ${verdictPillClasses(
            showSkeleton ? null : result?.verdict ?? null
          )}`}
        >
          {showSkeleton && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-pulse" />
              calentando modelo…
            </>
          )}
          {showAnalyzing && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse" />
              analizando…
            </>
          )}
          {showResult && result!.status === "error" && <>SIN VEREDICTO</>}
          {showResult && result!.status === "success" && (
            <>
              {verdictIcon(result!.verdict!)}
              {result!.verdict === "red"
                ? "ROJA"
                : result!.verdict === "yellow"
                  ? "AMARILLA"
                  : "VERDE"}
            </>
          )}
        </span>
      </div>

      {/* Skeleton loader */}
      {showSkeleton && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-3 bg-muted rounded w-full animate-pulse" />
          <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
        </div>
      )}

      {/* Analyzing pulse */}
      {showAnalyzing && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-3 bg-muted/60 rounded w-full animate-pulse" />
          <div className="h-3 bg-muted/60 rounded w-3/4 animate-pulse" />
        </div>
      )}

      {/* Error state */}
      {showResult && result!.status === "error" && (
        <p className="text-xs text-foreground/50 italic">
          {result!.error || "Error al procesar la cláusula"}
        </p>
      )}

      {/* Verdict content */}
      {showResult && result!.status === "success" && (
        <div className="space-y-3">
          {/* Verdict + risk type badge */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-bold uppercase tracking-wider ${verdictPillClasses(
                result!.verdict!
              )}`}
            >
              {verdictIcon(result!.verdict!)}
              {result!.verdict === "red"
                ? "ROJA"
                : result!.verdict === "yellow"
                  ? "AMARILLA"
                  : "VERDE"}
            </span>
            {result!.risk_type && (
              <span className="text-[11px] text-foreground/50 uppercase tracking-wider">
                {RISK_TYPE_MAP[result!.risk_type] || result!.risk_type}
              </span>
            )}
          </div>

          {/* Reason */}
          <p className="text-sm text-foreground/85 leading-relaxed">
            {result!.plain_reason_es}
          </p>

          {/* Suggested redline */}
          {result!.suggested_redline && (
            <div className="border border-accent/25 rounded-lg bg-accent/5 p-3">
              <p className="text-[11px] font-bold text-accent uppercase tracking-wider mb-1.5">
                PROPUESTA →
              </p>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {result!.suggested_redline}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Consensus badge ──────────────────────────────────────────────

function ConsensusBadge({ results }: { results: PanelResult[] }) {
  const done = results.filter(
    (r) => r && r.status === "success" && r.verdict
  );
  if (done.length < 2) return null;

  const reds = done.filter((r) => r.verdict === "red").length;
  const yellows = done.filter((r) => r.verdict === "yellow").length;
  const greens = done.filter((r) => r.verdict === "green").length;

  let text = "";
  if (done.length === 3) {
    if (reds === 3) text = "3/3 coinciden: cláusula de alto riesgo";
    else if (yellows === 3) text = "3/3 coinciden: requiere atención";
    else if (greens === 3) text = "3/3 coinciden: cláusula segura";
    else if (reds >= 2) text = "2/3 la marcan como riesgosa";
    else if (yellows >= 2) text = "2/3 recomiendan revisarla";
    else if (greens >= 2) text = "2/3 la consideran segura";
    else text = "opiniones divididas";
  } else {
    text = `${done.length}/3 han respondido…`;
  }

  return (
    <div className="mt-6 text-center animate-[fadeIn_0.3s_ease-out]">
      <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border text-sm text-foreground/70 font-medium">
        {text}
      </span>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────

export default function App() {
  const [clauseText, setClauseText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Record<string, PanelResult> | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = useCallback(async () => {
    const text = clauseText.trim();
    if (!text || loading) return;

    setLoading(true);
    setSubmitted(true);
    setError(null);
    setResults(null);

    try {
      const response = await fetch(EDGE_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clause_text: text }),
      });

      if (!response.ok) {
        const errBody = await response.text().catch(() => "");
        throw new Error(
          errBody ? `Error del panel: ${errBody}` : `Error ${response.status}`
        );
      }

      const data = await response.json();
      if (!data.panel || !Array.isArray(data.panel)) {
        throw new Error("Respuesta inválida del panel de revisión");
      }

      // Build result map for lookup
      const map: Record<string, PanelResult> = {};
      for (const r of data.panel) {
        map[r.model_name] = r;
      }

      // Stagger reveal by 500ms per card for natural feel
      const stagger: PanelResult[] = data.panel;
      for (let i = 0; i < stagger.length; i++) {
        const partial = { ...map };

        // reveal first one immediately, then stagger the rest
        if (i === 0) {
          setResults(partial);
        } else {
          await new Promise((r) => setTimeout(r, 500));
          // include previously revealed ones + this one
          const revealed: Record<string, PanelResult> = {};
          for (let j = 0; j <= i; j++) {
            revealed[stagger[j].model_name] = stagger[j];
          }
          setResults(revealed);
        }
      }

      // Final set with all
      setResults(map);
    } catch (err: any) {
      setError(err.message || "Error al conectar con el panel de revisión");
    } finally {
      setLoading(false);
    }
  }, [clauseText, loading]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
    }
  };

  const orderedResults = MODEL_ORDER.map((m) =>
    results?.[m.id] ?? null
  ).filter(Boolean) as PanelResult[];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ──────────────────────────────────────────── */}
      <header className="pt-10 pb-6 px-4 text-center">
        <div className="flex items-center justify-center gap-3 mb-2">
          <FileText className="w-7 h-7 text-primary" />
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            Contraparte
          </h1>
        </div>
        <p className="text-sm md:text-base text-foreground/60 max-w-lg mx-auto font-light">
          Tres IAs independientes leen tu contrato antes de que firmes.
        </p>
      </header>

      {/* ── Input ────────────────────────────────────────────── */}
      <section className="px-4 pb-6 max-w-3xl mx-auto w-full">
        <textarea
          ref={textareaRef}
          value={clauseText}
          onChange={(e) => setClauseText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Pega aquí una cláusula de tu contrato…"
          rows={5}
          className="w-full resize-none rounded-xl border border-border bg-card px-5 py-4 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-all duration-200 focus:border-primary focus:ring-1 focus:ring-primary/30 disabled:opacity-50"
          disabled={loading}
        />
        <button
          onClick={handleSubmit}
          disabled={!clauseText.trim() || loading}
          className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-accent text-white font-semibold px-6 py-3 text-sm transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-accent disabled:active:scale-100 cursor-pointer"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              Analizando…
            </>
          ) : (
            <>
              <Send className="w-4 h-4" />
              Revisar cláusula
            </>
          )}
        </button>
      </section>

      {/* ── Panel cards ─────────────────────────────────────── */}
      {submitted && (
        <section className="px-4 pb-8 max-w-3xl mx-auto w-full">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {MODEL_ORDER.map((m) => (
              <PanelCard
                key={m.id}
                data={{
                  modelName: m.id,
                  loading: !results?.[m.id],
                  result: results?.[m.id] ?? null,
                }}
              />
            ))}
          </div>

          <ConsensusBadge results={orderedResults} />
        </section>
      )}

      {/* ── Error ────────────────────────────────────────────── */}
      {error && (
        <section className="px-4 pb-4 max-w-3xl mx-auto w-full">
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive text-center">
            {error}
          </div>
        </section>
      )}

      {/* ── Footer ──────────────────────────────────────────── */}
      <footer className="mt-auto py-6 px-4 text-center">
        <p className="text-xs text-foreground/30 font-light">
          Contraparte explica y redacta. No es asesoría legal.
        </p>
      </footer>
    </div>
  );
}