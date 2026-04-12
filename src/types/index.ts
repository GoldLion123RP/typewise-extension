// src/types/index.ts
export interface Snippet {
  id: string;
  shortcut: string;
  content: string;
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  isActive: boolean;
}

export interface User {
  githubToken?: string;
  githubUsername?: string;
  gistId?: string;
  email?: string;
  settings: UserSettings;
}

export interface UserSettings {
  theme: 'light' | 'dark' | 'system';
  triggerKey: string;
  caseSensitive: boolean;
  showNotifications: boolean;
  syncEnabled: boolean;
  autoBackup: boolean;
  expandDelay: number;
}

export interface StorageData {
  snippets: Snippet[];
  user: User;
  lastSync?: string;
  encryptionEnabled: boolean;
}

export interface GistFile {
  filename: string;
  type: string;
  language: string;
  raw_url: string;
  size: number;
  content?: string;
}

export interface GitHubGist {
  id: string;
  description: string;
  public: boolean;
  files: { [key: string]: GistFile };
  created_at: string;
  updated_at: string;
}