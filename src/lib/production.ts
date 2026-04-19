import { AppSettings, ProductionJobInput } from '../types';
import { postJson } from './api';

interface ProductionJobResponse {
  ok: boolean;
  jobId: string;
  dispatched: boolean;
  status: string;
  message?: string;
}

export async function enqueueProductionJob(
  input: ProductionJobInput,
  settings?: Partial<AppSettings>,
) {
  return postJson<ProductionJobResponse>(
    '/api/production-jobs',
    {
      ...input,
      integration: {
        webhookUrl: settings?.webhookUrl || '',
        secret: settings?.n8nToken || '',
        hfToken: settings?.hfToken || '',
        comfyApiUrl: settings?.comfyApiUrl || '',
        comfyApiKey: settings?.comfyApiKey || '',
      },
    },
    { auth: true },
  );
}
