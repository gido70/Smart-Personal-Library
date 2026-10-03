export type AnswerValue = string | number | string[] | null;
export type Answers = Record<string, AnswerValue>;

export type ShowIf = { code: string; eq?: string; ne?: string; min_count?: number };

export type Item = {
  code: string;
  type: "single" | "multi" | "likert" | "text" | "number" | "rank" | "country";
  text: string | null;
  text_en?: string;
  options?: string[];
  options_from_used?: string[];
  required: boolean;
  other?: boolean;
  scale?: { min: number; max: number; labels: string[] };
  reverse?: boolean;
  attention?: number;
  na?: string;
  min_words?: number;
  min?: number;
  max?: number;
  from_code?: string;
  pick?: number;
  show_if?: ShowIf;
};

export type Section = {
  id: string;
  title: string;
  items?: Item[];
  blocks?: [string, string][];
  pending?: boolean;
  timed?: boolean;
  source?: { name: string; cite?: string; status?: string }[];
};

export type Instrument = {
  key: "consent" | "pre" | "post" | "followup";
  version: string;
  title: string;
  minutes?: string;
  instructions?: string;
  sections: Section[];
  checks?: { code: string; text: string; required: boolean }[];
};

export type ParticipantStatus = "invited" | "consented" | "pre_done" | "using" | "post_done" | "followup_done" | "withdrawn";

export type Participant = {
  code: string;
  status: ParticipantStatus;
  is_test: boolean;
  consented_at: string | null;
  use_started_at: string | null;
  post_due_at: string | null;
  followup_due_at: string | null;
};
