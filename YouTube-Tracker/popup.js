console.log('Popup opened');

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup DOM loaded, fetching data...');
  await loadScrollData();
  setupEventListeners();
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


// Export data to CSV (old version)
/*
function exportToCSV(sessions) {
  const headers = [
    'Session ID','Date','Duration (minutes)','Total Scroll Distance','Total Clicks','Scroll Events Count','URL'
  ];

  const rows = sessions.map(s => [
    s.sessionId,
    new Date(s.timestamp || s.savedAt).toISOString(),
    Math.round((s.sessionDuration || 0)/1000/60),
    s.totalScrollDistance || 0,
    s.totalClicks || 0,
    s.scrollEvents?.length || 0,
    s.url || 'unknown'
  ]);

  const csv = [headers, ...rows].map(r => r.map(f => `"${f}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `youtube_scrolling_data_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export data to CSV (for ML features)
const headers = [
    'Session ID',
    'Date',
    'Duration (minutes)',
    'Duration (seconds)',
    'Total Scroll Distance',
    'Video Clicks',
    'Shorts Clicks',
    'Total Clicks',
    'Scroll Events Count',
    'Context',
    'Time in Shorts (seconds)',
    'Time Watching Video (seconds)',
    'URL',
    'Scroll Intensity (px/min)',
    'Click Rate (clicks/min)',
    'Scroll per Click',
    'Avg Scroll Speed (px/event)',
    'Engagement Score'
  ];
  
  // Create CSV rows with calculated features
  const rows = sessions.map(session => {
    const durationSec = (session.sessionDuration || 0) / 1000;
    const durationMin = durationSec / 60;
    const scrollDistance = session.totalScrollDistance || 0;
    const videoClicks = session.videoClicks || 0;
    const shortsClicks = session.shortsClicks || 0;
    const totalClicks = videoClicks + shortsClicks;
    const scrollEvents = session.scrollEvents ? session.scrollEvents.length : 0;
    
    // Calculate ML features
    const scrollIntensity = durationMin > 0 ? Math.round(scrollDistance / durationMin) : 0;
    const clickRate = durationMin > 0 ? (totalClicks / durationMin).toFixed(2) : 0;
    const scrollPerClick = totalClicks > 0 ? Math.round(scrollDistance / totalClicks) : scrollDistance;
    const avgScrollSpeed = scrollEvents > 0 ? Math.round(scrollDistance / scrollEvents) : 0;
    
    // Engagement score: higher clicks and lower scroll = more engaged
    const engagementScore = scrollDistance > 0 ? (totalClicks * 1000 / scrollDistance).toFixed(3) : 0;
    
    const date = new Date(session.timestamp || session.savedAt).toISOString();
    const timeInShorts = Math.round((session.timeInShorts || 0) / 1000);
    const timeWatchingVideo = Math.round((session.timeWatchingVideo || 0) / 1000);
    
    return [
      session.sessionId || 'unknown',
      date,
      durationMin.toFixed(1),
      Math.round(durationSec),
      scrollDistance.toFixed(2),
      videoClicks,
      shortsClicks,
      totalClicks,
      scrollEvents,
      session.currentContext || 'unknown',
      timeInShorts,
      timeWatchingVideo,
      session.url || 'unknown',
      scrollIntensity,
      clickRate,
      scrollPerClick,
      avgScrollSpeed,
      engagementScore
    ];
  });
  
  // Combine headers and rows
  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `youtube_ml_data_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
}
*/



/*console.log('Popup opened');

document.addEventListener('DOMContentLoaded', async () => {
  console.log('Popup DOM loaded, fetching data...');
  await loadScrollData();
  setupEventListeners();
});

// Load and display scroll data
async function loadScrollData() {
  try {
    console.log('Requesting scroll data from background...');
    const response = await browser.runtime.sendMessage({action: 'getScrollData'});
    console.log('Received response:', response);
    
    const sessions = response.data || [];
    console.log('Total sessions:', sessions.length);
    
    displayStats(sessions);
    displayRecentActivity(sessions);
    
  } catch (error) {
    console.error('Error loading data:', error);
    document.getElementById('recentList').innerHTML = '<div class="activity-item">Error loading data</div>';
  }
}

// Display summary statistics
function displayStats(sessions) {
  console.log('Displaying stats for', sessions.length, 'sessions');
  console.log('Raw sessions data:', sessions);
  
  if (sessions.length === 0) {
    console.log('No sessions to display');
    document.getElementById('totalTime').textContent = '0';
    document.getElementById('totalSessions').textContent = '0';
    document.getElementById('avgDuration').textContent = '0m';
    document.getElementById('videoClicks').textContent = '0';
    return;
  }
  
  // Calculate totals WITHOUT grouping (sessions are already unique now)
  const totalDuration = sessions.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
  const totalVideoClicks = sessions.reduce((sum, s) => sum + (s.videoClicks || 0), 0);
  
  const totalMinutes = Math.round(totalDuration / 1000 / 60);
  const avgDurationMinutes = Math.round((totalDuration / sessions.length) / 1000 / 60);
  
  console.log('Stats calculated:', { 
    totalSessions: sessions.length, 
    totalMinutes, 
    avgDurationMinutes, 
    totalVideoClicks 
  });
  
  // Update display
  document.getElementById('totalTime').textContent = totalMinutes;
  document.getElementById('totalSessions').textContent = sessions.length;
  document.getElementById('avgDuration').textContent = avgDurationMinutes + 'm';
  document.getElementById('videoClicks').textContent = totalVideoClicks;
  
  console.log('Display updated with:', {
    totalTime: totalMinutes,
    sessions: sessions.length,
    avgDuration: avgDurationMinutes + 'm',
    clicks: totalVideoClicks
  });
}

// Group sessions into "visits" (sessions within 5 minutes of each other = same visit)
function groupSessionsIntoVisits(sessions) {
  if (sessions.length === 0) return [];
  
  const sortedSessions = [...sessions].sort((a, b) => 
    (a.timestamp || a.savedAt) - (b.timestamp || b.savedAt)
  );
  
  const visits = [];
  let currentVisit = [sortedSessions[0]];
  
  for (let i = 1; i < sortedSessions.length; i++) {
    const prevTime = sortedSessions[i - 1].timestamp || sortedSessions[i - 1].savedAt;
    const currTime = sortedSessions[i].timestamp || sortedSessions[i].savedAt;
    const timeDiff = currTime - prevTime;
    
    // If less than 5 minutes apart, same visit
    if (timeDiff < 5 * 60 * 1000) {
      currentVisit.push(sortedSessions[i]);
    } else {
      visits.push(currentVisit);
      currentVisit = [sortedSessions[i]];
    }
  }
  visits.push(currentVisit);
  
  return visits;
}

// Display recent activity
function displayRecentActivity(sessions) {
  const recentList = document.getElementById('recentList');
  
  if (sessions.length === 0) {
    recentList.innerHTML = '<div class="activity-item">No data yet. Visit YouTube to start tracking!</div>';
    return;
  }
  
  // Group into visits
  const visits = groupSessionsIntoVisits(sessions);
  
  // Get last 5 visits
  const recentVisits = visits.slice(-5).reverse();
  
  const activityHtml = recentVisits.map(visit => {
    // Sum up duration and clicks across all sessions in this visit
    const totalDuration = visit.reduce((sum, s) => sum + (s.sessionDuration || 0), 0);
    const totalClicks = visit.reduce((sum, s) => sum + (s.videoClicks || 0), 0);
    
    const duration = Math.round(totalDuration / 1000 / 60);
    const lastSession = visit[visit.length - 1];
    const timeAgo = formatTimeAgo(lastSession.savedAt || lastSession.timestamp);
    
    return `
      <div class="activity-item">
        <strong>${duration}m</strong> browsing • ${totalClicks} clicks • ${timeAgo}
      </div>
    `;
  }).join('');
  
  recentList.innerHTML = activityHtml;
}

// Format time ago helper
function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.round(diff / (1000 * 60));
  const hours = Math.round(diff / (1000 * 60 * 60));
  const days = Math.round(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 60) {
    return minutes <= 1 ? 'just now' : `${minutes}m ago`;
  } else if (hours < 24) {
    return hours === 1 ? '1h ago' : `${hours}h ago`;
  } else {
    return days === 1 ? '1d ago' : `${days}d ago`;
  }
}

// Setup event listeners
function setupEventListeners() {
  // Clear data button
  document.getElementById('clearData').addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all tracking data?')) {
      await browser.storage.local.clear();
      await loadScrollData(); // Refresh display
      alert('Data cleared successfully!');
    }
  });
  
  // Export data button
  document.getElementById('exportData').addEventListener('click', async () => {
    try {
      const response = await browser.runtime.sendMessage({action: 'getScrollData'});
      const sessions = response.data || [];
      
      if (sessions.length === 0) {
        alert('No data to export!');
        return;
      }
      
      exportToCSV(sessions);
      
    } catch (error) {
      console.error('Error exporting data:', error);
      alert('Error exporting data');
    }
  });
}

// Export data to CSV
function exportToCSV(sessions) {
  const headers = [
    'Session ID',
    'Date',
    'Duration (minutes)',
    'Total Scroll Distance',
    'Video Clicks',
    'Scroll Events Count',
    'Average Scroll Speed',
    'URL'
  ];
  
  // Create CSV rows
  const rows = sessions.map(session => {
    const date = new Date(session.timestamp || session.savedAt).toISOString();
    const duration = Math.round((session.sessionDuration || 0) / 1000 / 60);
    const scrollEvents = session.scrollEvents ? session.scrollEvents.length : 0;
    const avgScrollSpeed = scrollEvents > 0 ? 
      Math.round(session.totalScrollDistance / scrollEvents) : 0;
    
    return [
      session.id || 'unknown',
      date,
      duration,
      session.totalScrollDistance || 0,
      session.videoClicks || 0,
      scrollEvents,
      avgScrollSpeed,
      session.url || 'unknown'
    ];
  });
  
  // Combine headers and rows
  const csvContent = [headers, ...rows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  // Download CSV
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `youtube_scrolling_data_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
}
*/