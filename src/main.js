/**
 * ImasD Trimble Connect Extension
 * Uses the Workspace API to integrate with Trimble Connect for Browser.
 */

async function init() {
  const statusEl = document.getElementById('status');
  if (!statusEl) return;

  try {
    const { WorkspaceAPI } = await import('trimble-connect-workspace-api');
    const api = await WorkspaceAPI.connect(window.parent);
    statusEl.textContent = 'Connected to Trimble Connect!';

    // Request permission for tokens if needed: await api.requestPermission();
  } catch (err) {
    console.error('ImasD Extension init error:', err);
    statusEl.textContent = `Error: ${err.message || 'Failed to connect'}`;
  }
}

init();
