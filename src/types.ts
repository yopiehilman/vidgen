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
  geminiApiKey?: string;
  geminiModel?: string;
}

export interface ScheduleItem {
  id: string;
  time: string;
  color: string;
  title: string;
  desc: string;
  status: 'Active' | 'Pending';
}

export interface ProductionJobInput {
  title: string;
  description?: string;
  prompt: string;
  source: 'generate' | 'schedule' | 'manual';
  category?: string;
  scheduledTime?: string;
  status?: 'pending' | 'queued' | 'processing' | 'completed' | 'failed';
  metadata?: Record<string, unknown>;
}

export type PageId = 'generate' | 'schedule' | 'clipper' | 'trends' | 'analytics' | 'history' | 'agents' | 'settings' | 'jobs';
