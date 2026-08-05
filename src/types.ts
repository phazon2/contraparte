export type Verdict = "red" | "yellow" | "green";
export type Phase = "warming" | "analyzing" | "done";

export interface PanelResult {
  model_name: string;
  status: string;
  verdict?: Verdict;
  risk_type?: string;
  plain_reason_es?: string;
  plain_reason_en?: string;
  suggested_redline?: string;
  error?: string;
}

export interface CardState {
  phase: Phase;
  result: PanelResult | null;
}