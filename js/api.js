// SignBridge API client. Add ?api=http://localhost:8000 or localStorage.setItem('sb.apiBase', 'http://localhost:8000').
const params = new URLSearchParams(location.search);
export const apiBase = (params.get('api') || localStorage.getItem('sb.apiBase') || 'http://localhost:8000').replace(/\/$/, '');
export const apiEnabled = true;

export function setApiBase(url) { localStorage.setItem('sb.apiBase', url.replace(/\/$/, '')); location.reload(); }
export function apiToken() { return localStorage.getItem('sb.apiToken') || ''; }

export async function apiRequest(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (apiToken()) headers.Authorization = `Bearer ${apiToken()}`;
  const res = await fetch(`${apiBase}${path}`, { ...options, headers });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.detail || `API ${res.status}`);
  return body;
}

export const health = () => apiRequest('/health');
export const registerRemote = (data) => apiRequest('/api/auth/register', { method: 'POST', body: JSON.stringify(data) });
export const loginRemote = (data) => apiRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(data) });
export const meRemote = () => apiRequest('/api/auth/me');
export const getClasses = () => apiRequest('/api/classes');
export const createClassRemote = (title) => apiRequest('/api/classes', { method: 'POST', body: JSON.stringify({ title }) });
export const endClassRemote = (id) => apiRequest(`/api/classes/${id}/end`, { method: 'POST' });
export const saveTranscriptRemote = (data) => apiRequest('/api/transcripts', { method: 'POST', body: JSON.stringify(data) });
export const saveRecognitionRemote = (data) => apiRequest('/api/recognitions', { method: 'POST', body: JSON.stringify(data) });
export const getActivityRemote = (id) => apiRequest(`/api/classes/${id}/activity`);
export const getRemoteDashboard = (teacherId) => apiRequest(`/api/teachers/${encodeURIComponent(teacherId)}/dashboard`);
