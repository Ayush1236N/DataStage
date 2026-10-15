// API base: works locally and after deploy_website rewrites the placeholder.
const RAW = '__PORT_8000__';
export const API = RAW.startsWith('__') ? 'http://localhost:8000' : RAW.replace(/\/$/, '');

async function handle(res) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json();
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  health: () => fetch(`${API}/api/health`).then(handle),
  samples: () => fetch(`${API}/api/samples`).then(handle),
  chartTypes: () => fetch(`${API}/api/chart-types`).then(handle),
  upload: (file, onProgress) =>
    new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('file', file);
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API}/api/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
      };
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new Error(body.detail || `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error('The server returned an unreadable response.'));
        }
      };
      xhr.onerror = () => reject(new Error('Network error while uploading. Is the API running?'));
      xhr.send(form);
    }),
  sample: (name) => fetch(`${API}/api/sample/${encodeURIComponent(name)}`, { method: 'POST' }).then(handle),
  rows: (id, params) =>
    fetch(`${API}/api/rows/${id}?${new URLSearchParams(params)}`).then(handle),
  analyze: (body) => fetch(`${API}/api/analyze`, json(body)).then(handle),
  aggregate: (body) => fetch(`${API}/api/aggregate`, json(body)).then(handle),
  describe: (body) => fetch(`${API}/api/describe`, json(body)).then(handle),
  exportUrl: (id, sheet, format) =>
    `${API}/api/export/${id}?${new URLSearchParams({ sheet: sheet || '', format })}`,
  pngUrl: (id, slideId, sheet) =>
    `${API}/api/export/png/${id}/${slideId}?${new URLSearchParams({ sheet: sheet || '' })}`,
  // SSE pipeline progress; resolves when the stream reports done.
  progress: (id, sheet, onEvent) =>
    new Promise((resolve, reject) => {
      const jobId = Math.random().toString(36).slice(2, 10);
      const url = `${API}/api/progress/${jobId}?${new URLSearchParams({ dataset_id: id, sheet: sheet || '' })}`;
      const es = new EventSource(url);
      es.onmessage = (e) => {
        let payload;
        try {
          payload = JSON.parse(e.data);
        } catch {
          return;
        }
        onEvent?.(payload);
        if (payload.stage === 'done') {
          es.close();
          resolve(payload);
        } else if (payload.stage === 'error') {
          es.close();
          reject(new Error(payload.detail || 'The analysis pipeline failed.'));
        }
      };
      es.onerror = () => {
        es.close();
        reject(new Error('Lost connection to the analysis stream.'));
      };
    }),
};

export function downloadUrl(url) {
  // The sandbox proxy blocks blob downloads, so hand the URL to the browser directly.
  window.open(url, '_blank', 'noopener,noreferrer');
}
