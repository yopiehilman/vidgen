export interface User {
  username: string;
  name: string;
  role: string;
  avatar: string;
}

export interface VideoSlot {
  time: string;
  label: string;
  emoji: string;
  color: string;
  kategori?: string;
}

export interface HistoryItem {
  desc: string;
  kategori: string;
  slots: any[];
  result: string;
  time: string;
}

export interface AppSettings {
  hfToken: string;
  webhookUrl: string;
  n8nUrl: string;
  n8nToken: string;
  autoSendN8n: boolean;
  notifications: boolean;
}

export type PageId = 'generate' | 'schedule' | 'clipper' | 'trends' | 'analytics' | 'history' | 'agents' | 'settings';
