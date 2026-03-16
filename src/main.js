/**
 * ImasD Trimble Connect Extension
 * Uses the Workspace API to integrate with Trimble Connect for Browser.
 */

import { SMARTPRINT_LOGO } from './logo.js';
import { connect } from 'trimble-connect-workspace-api';

// Trimble Connect has region-specific API endpoints (404 if wrong region):
// North America: app.connect.trimble.com | Europe: app21 | Asia: app31
// Always use same-origin proxy (e.g. /tc-api-na) to avoid CORS "Failed to fetch"
function getApiBases() {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (origin) {
    return [
      `${origin}/tc-api-na`,
      `${origin}/tc-api-eu`,
      `${origin}/tc-api-asia`,
    ];
  }
  return [
    'https://app.connect.trimble.com/tc/api/2.0',
    'https://app21.connect.trimble.com/tc/api/2.0',
    'https://app31.connect.trimble.com/tc/api/2.0',
  ];
}

async function findProjectRegion(projectId, headers) {
  const REGIONS = getApiBases();
  for (const base of REGIONS) {
    const res = await fetch(`${base}/projects/${projectId}`, { headers });
    if (res.ok) return base;
    const err = await res.json().catch(() => ({}));
    if (err?.errorcode === 'PROJECT_NOT_FOUND' || err?.Errorcode === 'PROJECT_NOT_FOUND') continue;
    if (res.status === 401 || res.status === 403) throw new Error('Access denied');
  }
  return null;
}

function parseFolderChildren(data) {
  const items = Array.isArray(data) ? data : data.data ?? data.items ?? [];
  return items
    .filter((f) => f.type === 'FOLDER')
    .map((f) => ({ id: f.id, name: f.name || 'Unnamed' }));
}

async function fetchFoldersInSmartprintPRO(projectId, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };

  const apiBase = await findProjectRegion(projectId, headers);
  if (!apiBase) {
    throw new Error('Project not found in any region. Ensure you have access.');
  }

  // Try sync endpoint first (returns full project structure - may have different permissions)
  const syncRes = await fetch(
    `${apiBase}/sync/${projectId}?excludeVersion=true`,
    { headers }
  );
  if (syncRes.ok) {
    const syncData = await syncRes.json();
    const nodes = syncData.data ?? syncData.items ?? syncData.folders ?? [];
    const findSmartprint = (list) =>
      Array.isArray(list)
        ? list.find((f) => f.type === 'FOLDER' && f.name?.toLowerCase() === 'smartprintpro')
        : null;
    const smartprint = findSmartprint(nodes) ?? findSmartprint(nodes?.children);
    if (smartprint?.children) {
      return parseFolderChildren(smartprint.children);
    }
    if (smartprint?.id) {
      const childRes = await fetch(
        `${apiBase}/folders/${smartprint.id}/items?projectId=${projectId}`,
        { headers }
      );
      if (childRes.ok) {
        const childData = await childRes.json();
        return parseFolderChildren(childData);
      }
    }
  }

  // Try search
  const searchRes = await fetch(
    `${apiBase}/search?query=smartprintPRO&projectId=${projectId}&type=FOLDER`,
    { headers }
  );
  if (searchRes.ok) {
    const searchData = await searchRes.json();
    const hits = searchData.data ?? searchData.items ?? searchData.results ?? [];
    const smartprint = hits.find(
      (f) => f.type === 'FOLDER' && f.name?.toLowerCase() === 'smartprintpro'
    );
    if (smartprint) {
      const childRes = await fetch(
        `${apiBase}/folders/${smartprint.id}/items?projectId=${projectId}`,
        { headers }
      );
      if (childRes.ok) {
        const childData = await childRes.json();
        return parseFolderChildren(childData);
      }
    }
  }

  // Try projects-scoped path (some APIs use this structure)
  const scopedRes = await fetch(
    `${apiBase}/projects/${projectId}/folders/${projectId}/items`,
    { headers }
  );
  if (scopedRes.ok) {
    const data = await scopedRes.json();
    const items = Array.isArray(data) ? data : data.data ?? data.items ?? [];
    const smartprint = items.find(
      (f) => f.type === 'FOLDER' && f.name?.toLowerCase() === 'smartprintpro'
    );
    if (smartprint) {
      const childRes = await fetch(
        `${apiBase}/projects/${projectId}/folders/${smartprint.id}/items`,
        { headers }
      );
      if (childRes.ok) {
        const childData = await childRes.json();
        return parseFolderChildren(childData);
      }
    }
  }

  // Standard folders path with projectId query
  const rootRes = await fetch(
    `${apiBase}/folders/${projectId}/items?projectId=${projectId}`,
    { headers }
  );
  if (!rootRes.ok) {
    throw new Error(
      `Could not load folders (${rootRes.status}). The extension access token may not have folder read permission.`
    );
  }

  const data = await rootRes.json();
  const items = Array.isArray(data) ? data : data.data ?? data.items ?? [];
  const smartprint = items.find(
    (f) => f.type === 'FOLDER' && f.name?.toLowerCase() === 'smartprintpro'
  );
  if (!smartprint) return [];

  const childRes = await fetch(
    `${apiBase}/folders/${smartprint.id}/items?projectId=${projectId}`,
    { headers }
  );
  if (!childRes.ok) return [];

  const childData = await childRes.json();
  return parseFolderChildren(childData);
}

function renderMainView(api) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h2>smartprintPRO</h2>
    <p id="status">Connected to Trimble Connect!</p>
  `;
}

function renderProcessesView(api, folders, error) {
  const app = document.getElementById('app');
  const gridContent =
    error != null
      ? `<p class="error">${escapeHtml(error)}</p>`
      : folders.length === 0
        ? '<p class="empty">No folders found in smartprintPRO. Create a smartprintPRO folder in the project Data and add subfolders.</p>'
        : `
    <div class="processes-grid">
      ${folders.map((f) => `<div class="process-card" data-id="${f.id}">${escapeHtml(f.name)}</div>`).join('')}
    </div>
  `;
  app.innerHTML = `
    <h2>Processes</h2>
    <p class="subtitle">Folders inside smartprintPRO</p>
    ${gridContent}
  `;
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

async function showProcesses(api) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h2>Processes</h2>
    <p class="subtitle">Folders inside smartprintPRO</p>
    <p class="loading">Loading...</p>
  `;

  try {
    const project = await api.project.getProject();
    const token = await api.extension.requestPermission('accesstoken');
    if (!token || token === 'denied') throw new Error('Access token not granted');
    const folders = await fetchFoldersInSmartprintPRO(project.id, token);
    renderProcessesView(api, folders, null);
  } catch (err) {
    console.error('Processes load error:', err);
    let msg = err.message || 'Could not load folders. Ensure smartprintPRO folder exists in project Data.';
    if (err.message?.includes('Failed to fetch') || err.name === 'TypeError') {
      msg =
        'Failed to fetch: API request blocked. Run "npm run dev" and add the extension from http://localhost:3000/manifest.json so the proxy can forward requests.';
    }
    renderProcessesView(api, [], msg);
  }
}

async function init() {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    const api = await connect(window.parent, async (event, data) => {
      if (event === 'extension.command') {
        const cmd = data?.data;
        if (cmd === 'processes') {
          await showProcesses(api);
          await api.ui.setActiveMenuItem('processes');
        } else if (cmd === 'smartprint_main') {
          renderMainView(api);
          await api.ui.setActiveMenuItem('smartprint_main');
        }
      }
    });

    await api.ui.setMenu({
      title: 'smartprintPRO',
      icon: SMARTPRINT_LOGO,
      command: 'smartprint_main',
      subMenus: [
        { title: 'smartprintPRO', command: 'smartprint_main' },
        { title: 'Processes', command: 'processes' },
      ],
    });

    const hash = (window.location.hash || '').replace(/^#/, '');
    if (hash === 'processes') {
      await showProcesses(api);
      await api.ui.setActiveMenuItem('processes');
    } else {
      renderMainView(api);
    }
  } catch (err) {
    console.error('ImasD Extension init error:', err);
    app.innerHTML = `<h2>smartprintPRO</h2><p id="status" class="error">Error: ${err.message || 'Failed to connect'}</p>`;
  }
}

init();
