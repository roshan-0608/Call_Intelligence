export type PromptVersion = 'v1' | 'v2' | 'v3' | 'v4';

export interface PromptMessages {
  system?: string;
  user: string;
}

export interface PromptTemplate {
  version: PromptVersion;
  /** Shown in eval output so a results table is self-describing. */
  description: string;
  /** Whether this version is safe to run with `response_format: json_object`. */
  jsonMode: boolean;
  build(transcript: string): PromptMessages;
}
