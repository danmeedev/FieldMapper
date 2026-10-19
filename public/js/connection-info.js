async function refreshConnectionInfo() {
  const target = document.getElementById('connection-info');
  if (!target) return;
  try {
    const response = await fetch('/api/status', { cache: 'no-store' });
    if (!response.ok) throw new Error('Server unavailable');
    const status = await response.json(); target.replaceChildren();
    for (const entry of status.connectionUrls || []) {
      const row = document.createElement('p'); row.style.marginBottom = '8px';
      row.textContent = `${entry.interface}: ${entry.url}`; target.appendChild(row);
    }
    if (!target.childNodes.length) target.textContent = 'Connect this PC to Wi-Fi or your phone hotspot, then refresh.';
  } catch (e) { target.textContent = 'Could not load addresses. Check that the startup window is still open.'; }
}
refreshConnectionInfo();
