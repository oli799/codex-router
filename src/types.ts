export interface CodexAuthFile {
  tokens: {
    access_token: string;
    refresh_token: string;
    id_token: string;
    account_id?: string;
  };
  last_refresh: string;
  auth_mode?: string;
  OPENAI_API_KEY?: string;
}

export interface AccountMetadata {
  name: string;
  savedAt: string;
  auth: CodexAuthFile;
}

export interface AccountSummary {
  name: string;
  savedAt: string;
  isActive: boolean;
}

export interface TokenRefreshResult {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
}
