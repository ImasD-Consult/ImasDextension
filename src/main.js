/**
 * ImasD Trimble Connect Extension (Browser)
 * Project Extension with Processes and Info submenus.
 * Uses Workspace API: connect, setMenu, extension.requestPermission, project.getProject.
 * @see https://developer.trimble.com/docs/connect/tools/api/workspace
 * @see https://components.connect.trimble.com/trimble-connect-workspace-api/
 */

import { SMARTPRINT_LOGO } from './logo.js';
import { connect } from 'trimble-connect-workspace-api';

// Connect API: Europe region. Try v2.1 first (folders/items), fallback v2.0 (files).
const API_EU_21 = '/tc-api-eu-21';
const API_EU_20 = '/tc-api-eu';

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function renderMainView(api) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h2>smartprintPRO</h2>
    <p id="status">Connected to Trimble Connect!</p>
  `;
}

/** Processes: list folders at project root (simplified test). */
async function showProcesses(api) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h2>Processes</h2>
    <p class="subtitle">Folders at project root</p>
    <p class="loading">Loading...</p>
  `;

  try {
    const project = await api.project.getProject();
    const projectId = project?.id;
    if (!projectId) {
      app.innerHTML = `
        <h2>Processes</h2>
        <p class="subtitle">Folders at project root</p>
        <p class="error error-banner">No project selected.</p>
      `;
      return;
    }

    const token = await api.extension.requestPermission('accesstoken');
    if (token === 'denied' || token === 'pending') {
      app.innerHTML = `
        <h2>Processes</h2>
        <p class="subtitle">Folders at project root</p>
        <p class="error error-banner">Access token ${escapeHtml(token || 'denied')}. Please grant permission in extension settings.</p>
      `;
      return;
    }

    const folders = await fetchRootFolders(token, projectId, api);
    if (folders.error) {
      app.innerHTML = `
        <h2>Processes</h2>
        <p class="subtitle">Folders at project root</p>
        <p class="error error-banner">${escapeHtml(folders.error)}</p>
        <div class="processes-grid"></div>
      `;
      return;
    }

    if (!folders.items || folders.items.length === 0) {
      app.innerHTML = `
        <h2>Processes</h2>
        <p class="subtitle">${folders.source === 'viewer' ? 'Models from file tree' : 'Folders at project root'}</p>
        <p class="empty">No items found.</p>
        <div class="processes-grid"></div>
      `;
      return;
    }

    app.innerHTML = `
      <h2>Processes</h2>
      <p class="subtitle">${folders.source === 'viewer' ? 'Models from file tree (Viewer API)' : 'Folders at project root'}</p>
      <div class="processes-grid">
        ${folders.items.map((f) => `<div class="process-card" data-id="${escapeHtml(f.id || '')}">${escapeHtml(f.name || '')}</div>`).join('')}
      </div>
    `;
  } catch (err) {
    console.error('Processes load error:', err);
    app.innerHTML = `
      <h2>Processes</h2>
      <p class="subtitle">Folders at project root</p>
      <p class="error error-banner">${escapeHtml(err.message || 'Error loading folders')}</p>
      <div class="processes-grid"></div>
    `;
  }
}

/** Fetches folders at project root. Tries Core API v2.1, v2.0, then ViewerAPI.getModels() as fallback. */
async function fetchRootFolders(accessToken, projectId, api) {
  try {
    const rootId = await getProjectRootId(accessToken, projectId);
    if (!rootId) return { error: 'Could not get project root.' };

    let items = await listFolderItemsV21(accessToken, rootId);
    if (items === null) items = await listFolderItemsV20(accessToken, rootId, projectId);

    if (items === null && api?.viewer?.getModels) {
      try {
        const models = await api.viewer.getModels();
        if (models?.length) {
          return {
            items: models.map((m) => ({ id: m.id || m.versionId, name: m.name || 'Model' })),
            source: 'viewer',
          };
        }
      } catch (_) {}
    }

    if (items === null) {
      return {
        error: 'Core API folder endpoints (v2.0/v2.1) return 404/405 from extensions. Use the Data view (left panel) to browse smartprintPRO.',
      };
    }

    const folders = (items || []).filter((i) => (i.type || '').toUpperCase() === 'FOLDER');
    return { items: folders.map((f) => ({ id: f.id || f.versionId, name: f.name })) };
  } catch (e) {
    return { error: e.message || 'Failed to load folders' };
  }
}

async function apiGet(accessToken, base, path) {
  const url = `${base}${path.startsWith('/') ? path : '/' + path}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

async function getProjectRootId(accessToken, projectId) {
  let p;
  try {
    p = await apiGet(accessToken, API_EU_21, `/projects/${encodeURIComponent(projectId)}`);
  } catch (_) {
    p = await apiGet(accessToken, API_EU_20, `/projects/${encodeURIComponent(projectId)}?fullyLoaded=true`);
  }
  return p?.rootId || p?.rootFolderId || p?.rootFolderIdentifier || projectId;
}

async function listFolderItemsV21(accessToken, folderId) {
  try {
    const data = await apiGet(accessToken, API_EU_21, `/folders/${encodeURIComponent(folderId)}/items?pageSize=100`);
    return data?.items ?? (Array.isArray(data) ? data : []);
  } catch (_) {
    return null;
  }
}

async function listFolderItemsV20(accessToken, folderId, projectId) {
  try {
    const params = new URLSearchParams({ parentId: folderId });
    if (projectId) params.set('projectId', projectId);
    const data = await apiGet(accessToken, API_EU_20, `/files?${params}`);
    return data?.items ?? data?.files ?? data?.children ?? (Array.isArray(data) ? data : []);
  } catch (_) {
    return null;
  }
}

/** Info: placeholders for contacts, logos, web links. */
function showInfo(api) {
  const app = document.getElementById('app');
  app.innerHTML = `
    <h2>Info</h2>
    <p class="subtitle">About smartprintPRO</p>
    <div class="info-section">
      <h3>Contacts</h3>
      <p class="placeholder">[Contact placeholders – email, phone, support]</p>
    </div>
    <div class="info-section">
      <h3>Logos</h3>
      <p class="placeholder">[Logo placeholders]</p>
    </div>
    <div class="info-section">
      <h3>Web links</h3>
      <p class="placeholder">[Links to your pages]</p>
    </div>
  `;
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
        } else if (cmd === 'info') {
          showInfo(api);
          await api.ui.setActiveMenuItem('info');
        } else if (cmd === 'smartprint_main') {
          await showProcesses(api);
          await api.ui.setActiveMenuItem('processes');
        }
      }
    });

    await api.ui.setMenu({
      title: 'smartprintPRO',
      icon: SMARTPRINT_LOGO,
      command: 'smartprint_main',
      subMenus: [
        { title: 'Processes', command: 'processes' },
        { title: 'Info', command: 'info' },
      ],
    });

    const hash = (window.location.hash || '').replace(/^#/, '');
    if (hash === 'processes') {
      await showProcesses(api);
      await api.ui.setActiveMenuItem('processes');
    } else if (hash === 'info') {
      showInfo(api);
      await api.ui.setActiveMenuItem('info');
    } else {
      await showProcesses(api);
      await api.ui.setActiveMenuItem('processes');
    }
  } catch (err) {
    console.error('ImasD Extension init error:', err);
    app.innerHTML = `<h2>smartprintPRO</h2><p id="status" class="error">Error: ${escapeHtml(err.message || 'Failed to connect')}</p>`;
  }
}

init();
