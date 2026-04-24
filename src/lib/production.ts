import { AppSettings, ProductionJobInput } from '../types';
import { postJson } from './api';

interface ProductionJobResponse {
  ok: boolean;
  count?: number;
  jobId?: string;
  jobs?: Array<{
    jobId: string;
    title: string;
    status: string;
  }>;
  dispatched?: boolean;
  status?: string;
  message?: string;
}

interface RetryProductionJobResponse {
  ok: boolean;
  jobId: string;
  status: string;
  scheduledTime: string;
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
        comfyWorkflowFile: settings?.comfyWorkflowFile || '',
      },
    },
    { auth: true },
  );
}

export async function enqueueProductionJobs(
  jobs: ProductionJobInput[],
  settings?: Partial<AppSettings>,
) {
  return postJson<ProductionJobResponse>(
    '/api/production-jobs',
    {
      jobs: jobs.map((input) => ({
        ...input,
        integration: {
          webhookUrl: settings?.webhookUrl || '',
          secret: settings?.n8nToken || '',
          hfToken: settings?.hfToken || '',
          comfyApiUrl: settings?.comfyApiUrl || '',
          comfyApiKey: settings?.comfyApiKey || '',
          comfyWorkflowFile: settings?.comfyWorkflowFile || '',
        },
      })),
    },
    { auth: true },
  );
}

export async function retryProductionJob(jobId: string, scheduledTime: string) {
  return postJson<RetryProductionJobResponse>(
    `/api/production-jobs/${encodeURIComponent(jobId)}/retry`,
    { scheduledTime },
    { auth: true },
  );
}
