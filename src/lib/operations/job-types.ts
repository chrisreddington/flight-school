/**
 * Shared job response shape used by the polling layer and manager.
 */
export interface JobResponse {
  id: string;
  type: string;
  targetId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  result?: unknown;
  error?: string;
}
