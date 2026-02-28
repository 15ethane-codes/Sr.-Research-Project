console.log('Popup opened');

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup DOM loaded, fetching data...');
  await loadScrollData();
  setupEventListeners();
  setupMLIntervalControls();
});

async function loadScrollData() {
  try {
    console.log('Requesting scroll data from background...');
    const response = await browser.runtime.sendMessage({action: 'getScrollData'});
    const sessions = response.data || [];
    console.log('Total sessions:', sessions.length);

    displayStats(sessions);
    displayRecentActivity(sessions);
  } catch (error) {
    console.error('Error loading data:', error);
    document.getElementById('recentList').innerHTML = '<div class="activity-item">Error loading data</div>';
  }
}

function displayStats(sessions) {
  if (sessions.length === 0) {
    document.getElementById('totalTime').textContent = '0';
    document.getElementById('totalSessions').textContent = '0';
    document.getElementById('avgDuration').textContent = '0m';
    document.getElementById('videoClicks').textContent = '0';
    return;
  }

  const totalDuration = sessions.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
  const totalClicks = sessions.reduce((sum, s) => sum + (s.totalClicks || 0), 0);

  const totalMinutes = Math.round(totalDuration / 1000 / 60);
  const avgDurationMinutes = Math.round((totalDuration / sessions.length) / 1000 / 60);

  document.getElementById('totalTime').textContent = totalMinutes;
  document.getElementById('totalSessions').textContent = sessions.length;
  document.getElementById('avgDuration').textContent = avgDurationMinutes + 'm';
  document.getElementById('videoClicks').textContent = totalClicks;
}


function groupSessionsIntoVisits(sessions) {
  if (!sessions.length) return [];
  const sorted = [...sessions].sort((a, b) => (a.timestamp || a.savedAt) - (b.timestamp || b.savedAt));
  const visits = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prevTime = sorted[i-1].timestamp || sorted[i-1].savedAt;
    const currTime = sorted[i].timestamp || sorted[i].savedAt;
    if (currTime - prevTime < 5*60*1000) current.push(sorted[i]);
    else { visits.push(current); current = [sorted[i]]; }
  }
  visits.push(current);
  return visits;
}

function displayRecentActivity(sessions) {
  const recentList = document.getElementById('recentList');
  if (!sessions.length) {
    recentList.innerHTML = '<div class="activity-item">No data yet. Visit YouTube to start tracking!</div>';
    return;
  }

  const visits = groupSessionsIntoVisits(sessions);
  const recentVisits = visits.slice(-5).reverse();

  const activityHtml = recentVisits.map(visit => {
    const totalDuration = visit.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
    const totalClicks = visit.reduce((sum, s) => sum + (s.totalClicks || 0), 0);
    const duration = Math.round(totalDuration / 1000 / 60);
    const lastSession = visit[visit.length-1];
    const timeAgo = formatTimeAgo(lastSession.savedAt || lastSession.timestamp);

    return `<div class="activity-item">
      <strong>${duration}m</strong> browsing • ${totalClicks} clicks • ${timeAgo}
    </div>`;
  }).join('');

  recentList.innerHTML = activityHtml;
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60000);
  const hours = Math.round(diff / 3600000);
  const days = Math.round(diff / 86400000);

  if (minutes < 60) return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  if (hours < 24) return hours === 1 ? '1h ago' : `${hours}h ago`;
  return days === 1 ? '1d ago' : `${days}d ago`;
}

function setupEventListeners() {
  document.getElementById('clearData').addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all tracking data?')) {
      await browser.storage.local.clear();
      await loadScrollData();
      alert('Data cleared successfully!');
    }
  });

  document.getElementById('exportData').addEventListener('click', async () => {
    try {
      const response = await browser.runtime.sendMessage({action: 'getScrollData'});
      const sessions = response.data || [];
      if (!sessions.length) { alert('No data to export!'); return; }
      exportToCSV(sessions);
    } catch (error) {
      console.error('Error exporting data:', error);
      alert('Error exporting data');
    }
  });
}

// Export data to CSV (for ML purposes)
function exportToCSV(sessions) {
  if (!sessions || !sessions.length) {
    alert('No data available to export');
    return;
  }

  const headers = [
    "Session ID",
    "Date",
    "Duration (minutes)",
    "Total Scroll Distance",
    "Total Clicks",
    "Scroll Events Count",
    "URL"
  ];

  const csvRows = [headers.join(",")];

  for (const s of sessions) {
    const durationMinutes = (s.sessionDuration || 0) / 1000 / 60;
    const row = [
      `"${s.sessionId || ''}"`,
      `"${new Date(s.timestamp || s.savedAt).toISOString()}"`,
      `"${durationMinutes.toFixed(0)}"`,
      `"${s.totalScrollDistance || 0}"`,
      `"${s.totalClicks || 0}"`,
      `"${Array.isArray(s.scrollEvents) ? s.scrollEvents.length : s.scrollEvents || 0}"`,
      `"${s.url || ''}"`
    ];
    csvRows.push(row.join(","));
  }

  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `scroll_data_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


function setupMLIntervalControls() {
  const radios = document.querySelectorAll('input[name="mlInterval"]');
  const slider = document.getElementById('customSlider');
  const customValue = document.getElementById('customValue');

  // Load saved preference
  browser.storage.local.get('mlInterval').then(result => {
    const saved = result.mlInterval || 5;
    if ([5,10,20].includes(saved)) {
      document.querySelector(`input[name="mlInterval"][value="${saved}"]`).checked = true;
      slider.disabled = true;
    } else {
      document.querySelector('input[name="mlInterval"][value="custom"]').checked = true;
      slider.disabled = false;
      slider.value = saved;
      customValue.textContent = saved;
    }
  });

  // Radio change handler
  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'custom') {
        slider.disabled = false;
        saveMLInterval(parseInt(slider.value));
      } else {
        slider.disabled = true;
        saveMLInterval(parseInt(radio.value));
      }
    });
  });

  // Slider input handler
  slider.addEventListener('input', () => {
    customValue.textContent = slider.value;
    if (document.querySelector('input[name="mlInterval"][value="custom"]').checked) {
      saveMLInterval(parseInt(slider.value));
    }
  });
}

// Save ML interval to local storage
function saveMLInterval(value) {
  console.log('Saving ML interval:', value);
  browser.storage.local.set({ mlInterval: value });
  // Send message to background to update ML calculation interval if needed
  browser.runtime.sendMessage({ action: 'updateMLInterval', value });
}