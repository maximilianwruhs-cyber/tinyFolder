export type DoctorProfile = "fast" | "standard" | "deep";

export type StepStatus = "PASS" | "FAIL" | "WARN" | "SKIP";

export interface DoctorStepResult {
  id: string;
  title: string;
  status: StepStatus;
  durationMs: number;
  summary?: string;
  details?: string;
  evidencePaths?: string[];
  fix?: DoctorFixSuggestion[];
}

export interface DoctorFixSuggestion {
  id: string;
  title: string;
  severity: "info" | "warn" | "error";
  rationale?: string;
  commands?: string[];
  fileEdits?: Array<{
    path: string;
    description: string;
  }>;
  docs?: string[];
}

export interface DoctorEnvironment {
  cwd: string;
  vaultPath: string;
  inboxPath: string;
  thoughtCabinetPath: string;
  embeddingsPath: string;
  ollamaUrlV1?: string;
  ollamaBaseUrl?: string;
  model?: string;
  proxy?: {
    http?: string;
    https?: string;
    noProxy?: string;
  };
}

export interface DoctorReport {
  generatedAt: string;
  profile: DoctorProfile;
  readonly: boolean;
  writeReports: boolean;
  runLegacy?: string;
  env: DoctorEnvironment;
  steps: DoctorStepResult[];
}

