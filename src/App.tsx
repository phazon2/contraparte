import { useState, useRef, useCallback } from "react";
import {
  Send,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  AlertCircle,
  FileText,
  Layers,
} from "lucide-react";
import type { PanelResult, Verdict, CardState } from "./types";
import FullContractReview from "./FullContractReview";

// ─── Constants ────────────────────────────────────────────────────

const EDGE_FN_URL =
  "https://bmwqujfpnawflnkcsicm.supabase.co/functions/v1/review-clause";

const MODEL_ORDER = [
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

// ─── SSE consumer (POST + ReadableStream, EventSource can't POST) ─

async function consumeSSE(
  url: string,
  body: unknown,
  onEvent: (type: string, data: any) => void,
  signal: AbortSignal
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text ? `Error del panel: ${text}` : `Error ${response.status}`);
  }
  if (!response.body) {
    throw new Error("El panel no devolvió respuesta");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const block of blocks) {
      let type = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) type = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      let parsed: any = {};
      try {
        parsed = JSON.parse(dataLines.join("\n"));
      } catch {
        parsed = { raw: dataLines.join("\n") };
      }
      onEvent(type, parsed);
    }
  }
}

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

function PanelCard({ modelName, state }: { modelName: string; state: CardState }) {
  const { phase, result } = state;

  const cardBorder =
    result?.verdict === "red"
      ? "border-roja/20"
      : result?.verdict === "yellow"
        ? "border-amarilla/20"
        : result?.verdict === "green"
          ? "border-verde/20"
          : "border-border";

  const pillVerdict = phase === "done" ? (result?.verdict ?? null) : null;

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
            pillVerdict
          )}`}
        >
          {phase === "warming" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-foreground/30 animate-pulse" />
              calentando modelo…
            </>
          )}
          {phase === "analyzing" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-pulse" />
              analizando…
            </>
          )}
          {phase === "done" && result!.status === "error" && <>SIN VEREDICTO</>}
          {phase === "done" && result!.status === "success" && (
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

      {/* Loading skeleton */}
      {(phase === "warming" || phase === "analyzing") && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-3 bg-muted rounded w-full animate-pulse" />
          <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
        </div>
      )}

      {/* Error state */}
      {phase === "done" && result!.status === "error" && (
        <p className="text-xs text-foreground/50 italic">
          {result!.error || "El modelo no pudo emitir un veredicto"}
        </p>
      )}

      {/* Verdict content */}
      {phase === "done" && result!.status === "success" && (
        <div className="space-y-3">
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

          <p className="text-sm text-foreground/85 leading-relaxed">
            {result!.plain_reason_es}
          </p>

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

// ─── Mode Toggle ──────────────────────────────────────────────────

type Mode = "clause" | "contract";

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-0.5">
      <button
        onClick={() => onChange("clause")}
        className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
          mode === "clause"
            ? "bg-accent text-white shadow-sm"
            : "text-foreground/50 hover:text-foreground/70"
        }`}
      >
        <FileText className="w-3.5 h-3.5" />
        Una cláusula
      </button>
      <button
        onClick={() => onChange("contract")}
        className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
          mode === "contract"
            ? "bg-accent text-white shadow-sm"
            : "text-foreground/50 hover:text-foreground/70"
        }`}
      >
        <Layers className="w-3.5 h-3.5" />
        Contrato completo
      </button>
    </div>
  );
}

// ─── Single Clause Flow ───────────────────────────────────────────

function SingleClauseFlow() {
  const [clauseText, setClauseText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cards, setCards] = useState<Record<string, CardState> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(async () => {
    const text = clauseText.trim();
    if (!text || loading) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const initial: Record<string, CardState> = {};
    for (const m of MODEL_ORDER) {
      initial[m.id] = { phase: "warming", result: null };
    }

    setLoading(true);
    setSubmitted(true);
    setError(null);
    setCards(initial);

    try {
      await consumeSSE(
        EDGE_FN_URL,
        { clause_text: text },
        (type, data) => {
          setCards((prev) => {
            if (!prev) return prev;
            const name: string = data?.model_name;
            if (!name || !(name in prev)) return prev;

            if (type === "start") {
              return { ...prev, [name]: { phase: "analyzing", result: null } };
            }

            if (type === "result") {
              const result: PanelResult = {
                model_name: name,
                status: data.status ?? "error",
                verdict: data.verdict,
                risk_type: data.risk_type,
                plain_reason_es: data.plain_reason_es,
                plain_reason_en: data.plain_reason_en,
                suggested_redline: data.suggested_redline,
                error: data.error,
              };
              return { ...prev, [name]: { phase: "done", result } };
            }

            return prev;
          });
        },
        controller.signal
      );
    } catch (err: any) {
      if (err?.name === "AbortError") return;
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

  const orderedResults = MODEL_ORDER.map(
    (m) => cards?.[m.id]?.result ?? null
  ).filter(Boolean) as PanelResult[];

  return (
    <div className="flex flex-col gap-6">
      {/* ── Input ── */}
      <section className="max-w-3xl mx-auto w-full px-4">
        <textarea
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

      {/* ── Panel cards ── */}
      {submitted && cards && (
        <section className="max-w-3xl mx-auto w-full px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {MODEL_ORDER.map((m) => (
              <PanelCard key={m.id} modelName={m.id} state={cards[m.id]} />
            ))}
          </div>

          <ConsensusBadge results={orderedResults} />
        </section>
      )}

      {/* ── Error ── */}
      {error && (
        <section className="max-w-3xl mx-auto w-full px-4">
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive text-center">
            {error}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState<Mode>("clause");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="pt-8 pb-5 px-4 text-center flex flex-col items-center gap-4">
        <div className="flex items-center justify-center gap-3 mb-1">
          <FileText className="w-7 h-7 text-primary" />
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground tracking-tight">
            Contraparte
          </h1>
        </div>
        <p className="text-sm md:text-base text-foreground/60 max-w-lg mx-auto font-light">
          Tres IAs independientes leen tu contrato antes de que firmes.
        </p>

        {/* Mode toggle */}
        <ModeToggle mode={mode} onChange={setMode} />
      </header>

      {/* ── Content ── */}
      {mode === "clause" ? <SingleClauseFlow /> : <FullContractReview />}

      {/* ── Footer ── */}
      <footer className="mt-auto py-6 px-4 text-center">
        <p className="text-xs text-foreground/30 font-light">
          Contraparte explica y redacta. No es asesoría legal.
        </p>
      </footer>
    </div>
  );
}