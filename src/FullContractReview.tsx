import { useState, useRef, useCallback } from "react";
import {
  Send,
  Shield,
  AlertTriangle,
  CheckCircle,
  Clock,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  FileText,
  Layers,
  Loader2,
} from "lucide-react";
import type { PanelResult, Verdict, CardState } from "./types";

// ─── Constants ────────────────────────────────────────────────────

const EDGE_FN_URL =
  "https://bmwqujfpnawflnkcsicm.supabase.co/functions/v1/review-clause";

const SEGMENT_FN_URL =
  "https://bmwqujfpnawflnkcsicm.supabase.co/functions/v1/segment-contract";

const ARTIFACT_FN_URL =
  "https://bmwqujfpnawflnkcsicm.supabase.co/functions/v1/generate-artifact";

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

// ─── Types ────────────────────────────────────────────────────────

interface SegmenterClause {
  clause_id: string;
  heading: string;
  clause_text: string;
}

interface SegmentResult {
  language: "es" | "en" | "mixed";
  doc_summary: string;
  signer_role: string;
  clauses: SegmenterClause[];
}

interface ClauseReviewState {
  cards: Record<string, CardState>;
  results: PanelResult[];
  clause: SegmenterClause;
  done: boolean;
  finalVerdict: Verdict | null;
  consensusLevel: "3/3" | "2/3" | "1/3";
  consensusText: string;
  chosenRedline: string;
}

interface ArtifactResult {
  redlined_contract: string;
  negotiation_email_en: string;
  negotiation_email_es: string;
  summary_card: {
    reds: number;
    yellows: number;
    greens: number;
    one_liner_es: string;
    one_liner_en: string;
  };
}

type ContractPhase =
  | "input"
  | "segmenting"
  | "segment_error"
  | "reviewing"
  | "artifact_loading"
  | "done"
  | "artifact_error";

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

function miniVerdictDot(v: Verdict | null) {
  switch (v) {
    case "red":
      return "bg-roja";
    case "yellow":
      return "bg-amarilla";
    case "green":
      return "bg-verde";
    default:
      return "bg-foreground/20";
  }
}

function computeConsensus(results: PanelResult[]): {
  level: "3/3" | "2/3" | "1/3";
  finalVerdict: Verdict | null;
  text: string;
  chosenRedline: string;
} {
  const done = results.filter(
    (r) => r && r.status === "success" && r.verdict
  );
  if (done.length === 0) {
    return { level: "1/3", finalVerdict: null, text: "sin resultados", chosenRedline: "" };
  }

  const reds = done.filter((r) => r.verdict === "red").length;
  const yellows = done.filter((r) => r.verdict === "yellow").length;
  const greens = done.filter((r) => r.verdict === "green").length;

  let level: "3/3" | "2/3" | "1/3";
  let finalVerdict: Verdict | null;
  let text: string;

  if (done.length === 3) {
    if (reds === 3) { level = "3/3"; finalVerdict = "red"; text = "3/3: alto riesgo"; }
    else if (yellows === 3) { level = "3/3"; finalVerdict = "yellow"; text = "3/3: requiere atención"; }
    else if (greens === 3) { level = "3/3"; finalVerdict = "green"; text = "3/3: cláusula segura"; }
    else if (reds >= 2) { level = "2/3"; finalVerdict = "red"; text = "2/3: riesgosa"; }
    else if (yellows >= 2) { level = "2/3"; finalVerdict = "yellow"; text = "2/3: revisar"; }
    else if (greens >= 2) { level = "2/3"; finalVerdict = "green"; text = "2/3: segura"; }
    else { level = "1/3"; finalVerdict = null; text = "opiniones divididas"; }
  } else {
    level = "2/3"; finalVerdict = null; text = `${done.length}/3 respondieron`;
  }

  // Choose redline from the majority side, prefer most specific (longest)
  let chosenRedline = "";
  if (finalVerdict && finalVerdict !== "green") {
    const majoritySide = done.filter((r) => r.verdict === finalVerdict);
    const withRedline = majoritySide.filter((r) => r.suggested_redline);
    if (withRedline.length > 0) {
      chosenRedline = withRedline.sort((a, b) =>
        (b.suggested_redline?.length || 0) - (a.suggested_redline?.length || 0)
      )[0].suggested_redline || "";
    }
  }

  return { level, finalVerdict, text, chosenRedline };
}

// ─── SSE consumer (same as App) ──────────────────────────────────

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

// ─── PanelCard (reused from App) ──────────────────────────────────

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

      {(phase === "warming" || phase === "analyzing") && (
        <div className="space-y-2" aria-hidden="true">
          <div className="h-3 bg-muted rounded w-full animate-pulse" />
          <div className="h-3 bg-muted rounded w-3/4 animate-pulse" />
          <div className="h-3 bg-muted rounded w-1/2 animate-pulse" />
        </div>
      )}

      {phase === "done" && result!.status === "error" && (
        <p className="text-xs text-foreground/50 italic">
          {result!.error || "El modelo no pudo emitir un veredicto"}
        </p>
      )}

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

// ─── ClauseRow (collapsed row) ────────────────────────────────────

function ClauseRow({
  clauseId,
  heading,
  reviewState,
  isExpanded,
  onToggle,
}: {
  clauseId: string;
  heading: string;
  reviewState: ClauseReviewState | null;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const done = reviewState?.done ?? false;
  const verdict = reviewState?.finalVerdict ?? null;
  const consensusText = reviewState?.consensusText ?? "";

  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 bg-card hover:bg-card-hover transition-colors text-left cursor-pointer"
      >
        <span className="shrink-0 w-7 h-7 rounded-lg bg-muted flex items-center justify-center text-[11px] font-bold text-foreground/60">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </span>
        <span className="text-[11px] font-bold text-foreground/50 uppercase tracking-wider shrink-0 w-12">
          {clauseId}
        </span>
        <span className="text-sm text-foreground/80 font-medium truncate flex-1">
          {heading}
        </span>
        {done && (
          <div className="flex items-center gap-2 shrink-0">
            {MODEL_ORDER.map((m) => {
              const modelResult = reviewState?.results?.find(
                (r) => r.model_name === m.id
              );
              return (
                <span
                  key={m.id}
                  className={`w-2.5 h-2.5 rounded-full ${miniVerdictDot(
                    modelResult?.verdict ?? null
                  )}`}
                  title={`${m.id}: ${modelResult?.verdict ?? "—"}`}
                />
              );
            })}
            <span
              className={`ml-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                verdict === "red"
                  ? "text-roja border-roja/30 bg-roja-bg"
                  : verdict === "yellow"
                    ? "text-amarilla border-amarilla/30 bg-amarilla-bg"
                    : verdict === "green"
                      ? "text-verde border-verde/30 bg-verde-bg"
                      : "text-foreground/40 border-border bg-muted"
              }`}
            >
              {consensusText || "—"}
            </span>
          </div>
        )}
        {!done && (
          <span className="shrink-0 text-[10px] text-foreground/40 italic">
            pendiente
          </span>
        )}
      </button>
      {isExpanded && done && reviewState && (
        <div className="px-4 pb-4 pt-0">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {MODEL_ORDER.map((m) => (
              <PanelCard
                key={m.id}
                modelName={m.id}
                state={reviewState.cards[m.id]}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab switcher for artifact ────────────────────────────────────

function ArtifactTabs({
  result,
}: {
  result: ArtifactResult;
}) {
  const [activeTab, setActiveTab] = useState<"redlined" | "email_es" | "email_en">("redlined");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const text =
      activeTab === "redlined"
        ? result.redlined_contract
        : activeTab === "email_es"
          ? result.negotiation_email_es
          : result.negotiation_email_en;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [activeTab, result]);

  const tabs = [
    { key: "redlined" as const, label: "Contrato con propuestas" },
    { key: "email_es" as const, label: "Email ES" },
    { key: "email_en" as const, label: "Email EN" },
  ];

  return (
    <div className="mt-6">
      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border pb-1 mb-4">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider rounded-t-lg transition-all cursor-pointer ${
              activeTab === t.key
                ? "text-accent border-b-2 border-accent"
                : "text-foreground/40 hover:text-foreground/60"
            }`}
          >
            {t.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-foreground/60 hover:text-foreground hover:bg-card-hover border border-border transition-all cursor-pointer"
        >
          {copied ? (
            <><Check className="w-3.5 h-3.5" /> Copiado</>
          ) : (
            <><Copy className="w-3.5 h-3.5" /> Copiar</>
          )}
        </button>
      </div>

      {/* Tab content */}
      <div className="rounded-xl border border-border bg-card p-5 max-h-[60vh] overflow-y-auto">
        {activeTab === "redlined" && (
          <pre className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap font-sans">
            {result.redlined_contract}
          </pre>
        )}
        {activeTab === "email_es" && (
          <pre className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap font-sans">
            {result.negotiation_email_es}
          </pre>
        )}
        {activeTab === "email_en" && (
          <pre className="text-sm text-foreground/85 leading-relaxed whitespace-pre-wrap font-sans">
            {result.negotiation_email_en}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── FullContractReview ───────────────────────────────────────────

export default function FullContractReview() {
  const [contractText, setContractText] = useState("");
  const [phase, setPhase] = useState<ContractPhase>("input");
  const [segmentResult, setSegmentResult] = useState<SegmentResult | null>(null);
  const [segmentError, setSegmentError] = useState<string | null>(null);
  const [clauseReviews, setClauseReviews] = useState<Record<string, ClauseReviewState>>({});
  const [currentClauseIndex, setCurrentClauseIndex] = useState(0);
  const [expandedClauseId, setExpandedClauseId] = useState<string | null>(null);
  const [artifactResult, setArtifactResult] = useState<ArtifactResult | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stats
  const totalClauses = segmentResult?.clauses?.length ?? 0;
  const reviewedClauses = Object.values(clauseReviews).filter((r) => r.done).length;
  const totalReds = Object.values(clauseReviews).filter((r) => r.finalVerdict === "red").length;
  const totalYellows = Object.values(clauseReviews).filter((r) => r.finalVerdict === "yellow").length;

  // ── Segment ────────────────────────────────────────────────────
  const handleSegment = useCallback(async () => {
    const text = contractText.trim();
    if (!text) return;

    setPhase("segmenting");
    setSegmentError(null);
    setSegmentResult(null);
    setClauseReviews({});
    setCurrentClauseIndex(0);
    setArtifactResult(null);
    setArtifactError(null);

    try {
      const response = await fetch(SEGMENT_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_text: text }),
      });

      const data = await response.json();

      if (data.status === "error" || !data.clauses) {
        setSegmentError(data.error || "No pude segmentar este documento");
        setPhase("segment_error");
        return;
      }

      const seg: SegmentResult = {
        language: data.language || "es",
        doc_summary: data.doc_summary || "",
        signer_role: data.signer_role || "",
        clauses: data.clauses,
      };

      // Cap at 25 clauses
      if (seg.clauses.length > 25) {
        seg.clauses = seg.clauses.slice(0, 25);
      }

      setSegmentResult(seg);

      // Initialize review states for all clauses
      const initial: Record<string, ClauseReviewState> = {};
      for (const cl of seg.clauses) {
        const initialCards: Record<string, CardState> = {};
        for (const m of MODEL_ORDER) {
          initialCards[m.id] = { phase: "warming", result: null };
        }
        initial[cl.clause_id] = {
          cards: initialCards,
          results: [],
          clause: cl,
          done: false,
          finalVerdict: null,
          consensusLevel: "1/3",
          consensusText: "",
          chosenRedline: "",
        };
      }
      setClauseReviews(initial);

      // Start reviewing clauses sequentially
      setPhase("reviewing");
      setCurrentClauseIndex(0);

      // Use a closure to process clauses sequentially
      await processClausesSequentially(seg, initial);
    } catch (err: any) {
      setSegmentError(err.message || "Error al segmentar el documento");
      setPhase("segment_error");
    }
  }, [contractText]);

  // ── Sequential clause review ────────────────────────────────────
  const processClausesSequentially = useCallback(
    async (seg: SegmentResult, initialReviews: Record<string, ClauseReviewState>) => {
      const controller = new AbortController();
      abortRef.current = controller;

      const reviews = { ...initialReviews };

      for (let i = 0; i < seg.clauses.length; i++) {
        if (controller.signal.aborted) return;

        const cl = seg.clauses[i];
        setCurrentClauseIndex(i + 1);

        // Reset cards for this clause to warming
        const warmedCards: Record<string, CardState> = {};
        for (const m of MODEL_ORDER) {
          warmedCards[m.id] = { phase: "warming", result: null };
        }
        reviews[cl.clause_id] = {
          ...reviews[cl.clause_id],
          cards: warmedCards,
          results: [],
        };
        setClauseReviews({ ...reviews });

        // Wait for all 3 model results via SSE
        const results: PanelResult[] = await new Promise<PanelResult[]>(
          (resolve, reject) => {
            const collected: PanelResult[] = [];

            consumeSSE(
              EDGE_FN_URL,
              {
                clause_text: cl.clause_text,
                clause_id: cl.clause_id,
                heading: cl.heading,
                doc_summary: seg.doc_summary,
                signer_role: seg.signer_role,
                language: seg.language,
              },
              (type, data) => {
                if (type === "start") {
                  const name: string = data?.model_name;
                  if (name && name in reviews[cl.clause_id].cards) {
                    reviews[cl.clause_id].cards[name] = {
                      phase: "analyzing",
                      result: null,
                    };
                    setClauseReviews({ ...reviews });
                  }
                }

                if (type === "result") {
                  const name: string = data?.model_name;
                  if (!name || !(name in reviews[cl.clause_id].cards)) return;

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

                  collected.push(result);
                  reviews[cl.clause_id].cards[name] = {
                    phase: "done",
                    result,
                  };
                  setClauseReviews({ ...reviews });

                  if (collected.length === 3) {
                    resolve(collected);
                  }
                }
              },
              controller.signal
            ).catch(reject);
          }
        );

        // Compute consensus for this clause
        const consensus = computeConsensus(results);
        reviews[cl.clause_id] = {
          ...reviews[cl.clause_id],
          results,
          done: true,
          finalVerdict: consensus.finalVerdict,
          consensusLevel: consensus.level,
          consensusText: consensus.text,
          chosenRedline: consensus.chosenRedline,
        };
        setClauseReviews({ ...reviews });
      }

      // All clauses reviewed — phase remains "reviewing" until user clicks "Generar artifacto"
      // (the generate button becomes visible)
    },
    []
  );

  // ── Generate artifact ──────────────────────────────────────────
  const handleGenerateArtifact = useCallback(async () => {
    if (!segmentResult) return;

    setPhase("artifact_loading");
    setArtifactError(null);

    // Build the panel_results and consensus arrays for the generator
    const panelResults: Record<string, any> = {};
    const consensusList: any[] = [];

    for (const cl of segmentResult.clauses) {
      const review = clauseReviews[cl.clause_id];
      if (!review) continue;

      // Build per-clause panel results
      panelResults[cl.clause_id] = {};
      for (const r of review.results) {
        panelResults[cl.clause_id][r.model_name] = r;
      }

      consensusList.push({
        clause_id: cl.clause_id,
        level: review.consensusLevel,
        final_verdict: review.finalVerdict,
        chosen_redline: review.chosenRedline,
      });
    }

    const totalClausesShown = segmentResult.clauses.length;
    const totalOriginal = segmentResult.clauses.length;
    const capped = totalClausesShown < totalOriginal;

    try {
      const response = await fetch(ARTIFACT_FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_summary: segmentResult.doc_summary,
          signer_role: segmentResult.signer_role,
          language: segmentResult.language,
          clauses: segmentResult.clauses.map((c) => ({
            clause_id: c.clause_id,
            heading: c.heading,
            clause_text: c.clause_text,
          })),
          panel_results: panelResults,
          consensus: consensusList,
          capped: capped,
          total_clauses: totalOriginal,
        }),
      });

      const data = await response.json();

      if (data.status === "error") {
        setArtifactError(data.error || "No se pudo generar el artifacto");
        setPhase("artifact_error");
        return;
      }

      setArtifactResult({
        redlined_contract: data.redlined_contract,
        negotiation_email_en: data.negotiation_email_en,
        negotiation_email_es: data.negotiation_email_es,
        summary_card: data.summary_card,
      });
      setPhase("done");
    } catch (err: any) {
      setArtifactError(err.message || "Error al generar el artifacto");
      setPhase("artifact_error");
    }
  }, [segmentResult, clauseReviews]);

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* ── Phase: input ── */}
      {phase === "input" && (
        <section className="max-w-3xl mx-auto w-full px-4">
          <textarea
            value={contractText}
            onChange={(e) => setContractText(e.target.value)}
            placeholder="Pega aquí el contrato completo (español o inglés)…"
            rows={10}
            className="w-full resize-none rounded-xl border border-border bg-card px-5 py-4 text-sm text-foreground placeholder:text-foreground/30 outline-none transition-all duration-200 focus:border-primary focus:ring-1 focus:ring-primary/30"
          />
          <button
            onClick={handleSegment}
            disabled={!contractText.trim()}
            className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl bg-accent text-white font-semibold px-6 py-3 text-sm transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Layers className="w-4 h-4" />
            Segmentar contrato
          </button>
          <p className="mt-2 text-[11px] text-foreground/30 text-center">
            Hasta 25 cláusulas. El contrato se segmenta, analiza y genera un artifacto propuesta.
          </p>
        </section>
      )}

      {/* ── Phase: segmenting ── */}
      {phase === "segmenting" && (
        <section className="max-w-3xl mx-auto w-full px-4 text-center">
          <div className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="w-8 h-8 text-primary animate-spin" />
            <p className="text-sm text-foreground/60">Segmentando contrato en cláusulas…</p>
          </div>
        </section>
      )}

      {/* ── Phase: segment_error ── */}
      {phase === "segment_error" && (
        <section className="max-w-3xl mx-auto w-full px-4">
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive text-center">
            {segmentError || "No pude segmentar este documento"}
          </div>
          <button
            onClick={() => setPhase("input")}
            className="mt-3 w-full rounded-xl border border-border bg-card text-foreground/70 font-semibold px-6 py-3 text-sm transition-all hover:bg-card-hover cursor-pointer"
          >
            Intentar de nuevo
          </button>
        </section>
      )}

      {/* ── Phase: reviewing / artifact_loading / artifact_error / done ── */}
      {(phase === "reviewing" ||
        phase === "artifact_loading" ||
        phase === "artifact_error" ||
        phase === "done") && segmentResult && (
        <>
          {/* Stats bar */}
          <section className="max-w-3xl mx-auto w-full px-4">
            <div className="flex items-center justify-center gap-6 flex-wrap text-xs text-foreground/50">
              <span className="flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                3 modelos
              </span>
              <span className="flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                {totalClauses} cláusula{totalClauses !== 1 ? "s" : ""}
              </span>
              {totalReds > 0 && (
                <span className="flex items-center gap-1.5 text-roja">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {totalReds} roja{totalReds !== 1 ? "s" : ""}
                </span>
              )}
              {totalYellows > 0 && (
                <span className="flex items-center gap-1.5 text-amarilla">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {totalYellows} amarilla{totalYellows !== 1 ? "s" : ""}
                </span>
              )}
            </div>
          </section>

          {/* Doc summary */}
          <section className="max-w-3xl mx-auto w-full px-4">
            <div className="rounded-xl border border-border/50 bg-card/50 p-4">
              <p className="text-[11px] font-bold text-foreground/40 uppercase tracking-wider mb-1">
                Resumen del documento
              </p>
              <p className="text-sm text-foreground/70 leading-relaxed">
                {segmentResult.doc_summary}
              </p>
              {segmentResult.signer_role && (
                <p className="text-xs text-foreground/50 mt-2 italic">
                  Firma como: {segmentResult.signer_role}
                </p>
              )}
            </div>
          </section>

          {/* Progress bar */}
          {phase === "reviewing" && (
            <section className="max-w-3xl mx-auto w-full px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-foreground/50">
                  Revisando cláusula {currentClauseIndex} de {totalClauses}…
                </span>
                <span className="text-xs text-foreground/40">
                  {Math.round((reviewedClauses / totalClauses) * 100)}%
                </span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-accent rounded-full transition-all duration-500"
                  style={{ width: `${(reviewedClauses / totalClauses) * 100}%` }}
                />
              </div>
            </section>
          )}

          {/* Clause list */}
          <section className="max-w-3xl mx-auto w-full px-4">
            <div className="flex flex-col gap-2">
              {segmentResult.clauses.map((cl, idx) => {
                const review = clauseReviews[cl.clause_id];
                const isCurrent = idx + 1 === currentClauseIndex && phase === "reviewing";
                const isPending = idx + 1 > currentClauseIndex && phase === "reviewing";

                return (
                  <div key={cl.clause_id} className="relative">
                    {/* If this is the current clause being reviewed, show the live cards */}
                    {isCurrent && review && (
                      <div className="mb-4">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-[11px] font-bold text-foreground/50 uppercase tracking-wider">
                            {cl.clause_id}
                          </span>
                          <span className="text-sm text-foreground/80 font-medium">
                            {cl.heading}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          {MODEL_ORDER.map((m) => (
                            <PanelCard
                              key={m.id}
                              modelName={m.id}
                              state={review.cards[m.id]}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* For reviewed or pending clauses: collapsed row */}
                    {(!isCurrent || review?.done) && (
                      <ClauseRow
                        clauseId={cl.clause_id}
                        heading={cl.heading}
                        reviewState={review?.done ? review : null}
                        isExpanded={expandedClauseId === cl.clause_id}
                        onToggle={() =>
                          review?.done
                            ? setExpandedClauseId(
                                expandedClauseId === cl.clause_id ? null : cl.clause_id
                              )
                            : undefined
                        }
                      />
                    )}
                    {isPending && (
                      <div className="border border-border/30 rounded-xl bg-card/30 px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-[11px] font-bold text-foreground/20 uppercase tracking-wider w-12">
                            {cl.clause_id}
                          </span>
                          <span className="text-sm text-foreground/30 italic">
                            {cl.heading}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Capped notice */}
          {segmentResult.clauses.length === 25 && segmentResult.clauses.length > 0 && (
            <section className="max-w-3xl mx-auto w-full px-4">
              <p className="text-xs text-foreground/40 text-center italic">
                Se revisaron las primeras 25 cláusulas. El documento original tiene más.
              </p>
            </section>
          )}

          {/* Generate artifact button */}
          {phase === "reviewing" && reviewedClauses === totalClauses && (
            <section className="max-w-3xl mx-auto w-full px-4 text-center">
              <button
                onClick={handleGenerateArtifact}
                className="inline-flex items-center gap-2 rounded-xl bg-accent text-white font-semibold px-8 py-3 text-sm transition-all duration-200 hover:bg-accent-hover active:scale-[0.98] cursor-pointer"
              >
                <Send className="w-4 h-4" />
                Generar artifacto
              </button>
            </section>
          )}

          {/* Artifact loading */}
          {phase === "artifact_loading" && (
            <section className="max-w-3xl mx-auto w-full px-4 text-center">
              <div className="flex flex-col items-center gap-4 py-8">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-foreground/60">Generando artifacto de negociación…</p>
              </div>
            </section>
          )}

          {/* Artifact error */}
          {phase === "artifact_error" && (
            <section className="max-w-3xl mx-auto w-full px-4">
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive text-center">
                {artifactError || "Error al generar el artifacto"}
              </div>
              <button
                onClick={handleGenerateArtifact}
                className="mt-3 w-full rounded-xl border border-border bg-card text-foreground/70 font-semibold px-6 py-3 text-sm transition-all hover:bg-card-hover cursor-pointer"
              >
                Intentar de nuevo
              </button>
            </section>
          )}

          {/* Artifact result */}
          {phase === "done" && artifactResult && (
            <>
              {/* Summary card */}
              <section className="max-w-3xl mx-auto w-full px-4">
                <div className="rounded-xl border border-accent/20 bg-accent/5 p-5 text-center">
                  <div className="flex items-center justify-center gap-6 mb-3">
                    {artifactResult.summary_card.reds > 0 && (
                      <span className="flex items-center gap-1.5 text-roja font-bold text-lg">
                        <AlertTriangle className="w-5 h-5" />
                        {artifactResult.summary_card.reds} roja{artifactResult.summary_card.reds !== 1 ? "s" : ""}
                      </span>
                    )}
                    {artifactResult.summary_card.yellows > 0 && (
                      <span className="flex items-center gap-1.5 text-amarilla font-bold text-lg">
                        <AlertCircle className="w-5 h-5" />
                        {artifactResult.summary_card.yellows} amarilla{artifactResult.summary_card.yellows !== 1 ? "s" : ""}
                      </span>
                    )}
                    {artifactResult.summary_card.greens > 0 && (
                      <span className="flex items-center gap-1.5 text-verde font-bold text-lg">
                        <CheckCircle className="w-5 h-5" />
                        {artifactResult.summary_card.greens} verde{artifactResult.summary_card.greens !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/70 font-medium">
                    {artifactResult.summary_card.one_liner_es}
                  </p>
                  <p className="text-xs text-foreground/50 italic mt-1">
                    {artifactResult.summary_card.one_liner_en}
                  </p>
                  <p className="text-[10px] text-foreground/30 mt-3">
                    Contraparte explica y redacta. No es asesoría legal.
                  </p>
                </div>
              </section>

              {/* Tabs */}
              <section className="max-w-3xl mx-auto w-full px-4">
                <ArtifactTabs result={artifactResult} />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}