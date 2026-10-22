export type MockupStage = "rough-mockups" | "refined-mockups";
export type MockupMapping = {
  screen: string;
  state: string;
  ac: string;
  asset: string;
  check: string;
};
export type MockupContract = {
  stage: MockupStage;
  path: string;
  sha256: string | null;
  parsing: "missing" | "invalid" | "legacy" | "supported" | "unknown";
  integrity: "unchecked" | "matched" | "mismatched";
  stageMark: string | null;
  message: string | null;
  assets: { path: string; sha256: string; actualSha256: string | null }[];
  mappings: MockupMapping[];
};
export type ExecutionContext = {
  space: string;
  activeIntent: string | null;
  currentStage: string | null;
  latestTurn: { id: string; seq: number } | null;
};
export type MockupReference = {
  intent: string;
  stage: MockupStage;
  contractSha256: string;
  assets: { path: string; sha256: string }[];
  mapping: MockupMapping;
};
export type ExpectedContext = ExecutionContext & {
  reference?: MockupReference;
  documents?: { path: string; sha256: string | null }[];
};
export type MockupsResponse = {
  space: string;
  intent: string;
  isActive: boolean;
  contracts: MockupContract[];
};

export type ChangeImpact = {
  intent: string;
  space: string;
  documents: { label: string; path: string; sha256: string | null }[];
};
