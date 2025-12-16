console.log('Background script loaded and ready');

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Message received from content script:', message.action);

  if (message.action === 'saveScrollData') {
    console.log('Saving scroll data:', {
      duration: Math.round(message.data.sessionDuration / 1000) + 's',
      totalClicks: message.data.totalClicks,
      scrolls: message.data.scrollEvents?.length || 0
    });
    saveSessionData(message.data);

    analyzeSession(message.data);

    sendResponse({success: true, saved: true});
    return false;
  } else if (message.action === 'getScrollData') {
    console.log('Fetching stored data');
    getStoredData().then(data => {
      console.log('Returning', data.length, 'sessions');
      sendResponse({data: data});
    });
    return true; // Keep message channel open for async
  }

  return false;
});

// Save session data
async function saveSessionData(sessionData) {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    const sessions = result.scrollSessions || [];

    const existingIndex = sessions.findIndex(s => s.sessionId === sessionData.sessionId);

    if (existingIndex >= 0) {
      sessions[existingIndex] = {...sessionData, savedAt: Date.now()};
      console.log('Replaced session:', sessionData.sessionId, 'Total clicks:', sessionData.totalClicks);
    } else {
      sessions.push({...sessionData, savedAt: Date.now()});
      console.log('Added new session:', sessionData.sessionId);
    }

    const recentSessions = sessions.slice(-100);
    await browser.storage.local.set({scrollSessions: recentSessions});
    console.log('Total unique sessions in storage:', recentSessions.length);
  } catch (error) {
    console.error('Error saving session data:', error);
  }
}

// Get stored sessions
async function getStoredData() {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    return result.scrollSessions || [];
  } catch (error) {
    console.error('Error retrieving data:', error);
    return [];
  }
}

// Cleanup old data
browser.runtime.onInstalled.addListener(() => cleanupOldData());
async function cleanupOldData() {
  try {
    const result = await browser.storage.local.get(['scrollSessions']);
    const sessions = result.scrollSessions || [];
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const recentSessions = sessions.filter(s => s.savedAt > thirtyDaysAgo);
    await browser.storage.local.set({scrollSessions: recentSessions});
    console.log(`Cleaned up old data. Kept ${recentSessions.length} sessions.`);
  } catch (error) {
    console.error('Error cleaning up data:', error);
  }
}

// NUDGE SYSTEM (newest additions for Version 1.1)

let nudgeLevel = 0;
let nudgeCount = 0;
let lastNudgeTime = 0;
const NUDGE_COOLDOWN = 5 * 60 * 1000; // 5 minutes between nudges

// Enhanced doomscrolling detection with nudge triggers
function analyzeSession(sessionData) {
  const durationMinutes = sessionData.sessionDuration / 1000 / 60;
  const scrollDistance = sessionData.totalScrollDistance;
  const videoClicks = sessionData.videoClicks || 0;
  const shortsClicks = sessionData.shortsClicks || 0;
  const totalClicks = videoClicks + shortsClicks;
  const scrollEvents = sessionData.scrollEvents ? sessionData.scrollEvents.length : 0;
  
  // Calculate engagement metrics
  const scrollIntensity = durationMinutes > 0 ? scrollDistance / durationMinutes : 0;
  const clickRate = durationMinutes > 0 ? totalClicks / durationMinutes : 0;
  const engagementScore = scrollDistance > 0 ? (totalClicks * 1000 / scrollDistance) : 0;
  
  const mlFeatures = {
  scrollIntensity: scrollIntensity,
  engagementScore: engagementScore,
  durationMinutes: durationMinutes
  };

  const doomProb = predictDoomscrollProbability(mlFeatures);

  console.log('ML doomscroll probability:', doomProb.toFixed(3));

  let bayesDoom = false;

  // Simple likelihood logic - edit later
  if (doomProb === null) {
    const pScroll = scrollIntensity > 2000 ? 0.7 : 0.3;
    const pDuration = durationMinutes > 20 ? 0.7 : 0.3;
    const pEngagement = engagementScore < 0.5 ? 0.6 : 0.4;

    const posterior = (pScroll + pDuration + pEngagement) / 3;
    bayesDoom = posterior >= 0.6;

    console.log('Bayesian fallback:', posterior);
  }

  // Multi-signal doomscrolling detection
  /*const signals = {
    longDuration: durationMinutes > 15,
    highScrolling: scrollDistance > 15000,
    lowEngagement: engagementScore < 0.5,
    fastScrolling: scrollIntensity > 2000,
    shortsOverload: sessionData.currentContext === 'shorts_feed' && shortsClicks > 20,
    lowClickRate: clickRate < 0.3 && durationMinutes > 10
  };
  */
  const signals = {
    longDuration: durationMinutes > 2,  // Test
    highScrolling: scrollDistance > 3000,  // Lower threshold
    lowEngagement: engagementScore < 0.5,
    fastScrolling: scrollIntensity > 1000,
    shortsOverload: sessionData.currentContext === 'shorts_feed' && shortsClicks > 5,
    lowClickRate: clickRate < 0.3 && durationMinutes > 2
  };
  
  const signalCount = Object.values(signals).filter(Boolean).length;
  //const isDoomscrolling = signalCount >= 3; - old logic
  const ruleBased = signalCount >= 3;
  const mlBased = doomProb >= 0.65;

  //const isDoomscrolling = ruleBased || mlBased; - old logic
  const isDoomscrolling = ruleBased || mlBased || bayesDoom;
  
  console.log('Hybrid decision:', {
    ruleBased: ruleBased,
    ml: mlBased,
    bayesian: bayesDoom,
    mlProbability: doomProb.toFixed(3),
    final: isDoomscrolling
  });

  console.log('Session Analysis:', {
    duration: durationMinutes.toFixed(1) + 'min',
    scrollDistance: Math.round(scrollDistance),
    totalClicks: totalClicks,
    scrollIntensity: Math.round(scrollIntensity),
    engagementScore: engagementScore.toFixed(3),
    signals: signals,
    signalCount: signalCount,
    isDoomscrolling: isDoomscrolling
  });
  
  // Trigger nudges if doomscrolling detected
  if (isDoomscrolling) {
    console.log('Doomscrolling detected! Triggering nudge...');
    triggerNudge(sessionData, signals, durationMinutes);
  }
  
  return isDoomscrolling;
}

function triggerNudge(sessionData, signals, durationMinutes) {
  const now = Date.now();
  
  // Don't spam nudges
  if (now - lastNudgeTime < NUDGE_COOLDOWN) {
    console.log('Nudge on cooldown, skipping...');
    return;
  }
  
  lastNudgeTime = now;
  nudgeCount++;
  
  // Escalate based on duration and nudge count
  if (durationMinutes >= 25 && nudgeCount >= 2) {
    // Level 3: Scroll resistance (high friction)
    nudgeLevel = 3;
    activateScrollResistance(sessionData, durationMinutes);
    
  } else if (durationMinutes >= 20 || nudgeCount >= 2) {
    // Level 2: Suggestion prompts
    nudgeLevel = 2;
    showSuggestionNudge(sessionData, signals, durationMinutes);
    
  } else {
    // Level 1: Gentle awareness
    nudgeLevel = 1;
    showAwarenessNudge(sessionData, signals, durationMinutes);
  }
  
  logNudge(sessionData.sessionId, nudgeLevel, nudgeCount, durationMinutes);
}

// Level 1: Awareness notification (gentle)
function showAwarenessNudge(sessionData, signals, durationMinutes) {
  let message = '';
  let nudgeType = '';
  
  if (signals.shortsOverload) {
    nudgeType = 'shorts_awareness';
    message = `You've watched ${sessionData.shortsClicks} Shorts in ${Math.round(durationMinutes)} minutes. Still enjoying?`;
  } else if (signals.lowEngagement) {
    nudgeType = 'low_engagement';
    message = `${Math.round(durationMinutes)} minutes of scrolling. Finding what you need?`;
  } else {
    nudgeType = 'time_awareness';
    message = `You've been on YouTube for ${Math.round(durationMinutes)} minutes.`;
  }
  
  // Browser notification
  browser.notifications.create({
    type: 'basic',
    title: 'YouTube Time Check',
    message: message,
    priority: 1
  });
  
  // Send to content script for visual banner
  sendToActiveTab({
    action: 'showAwarenessBanner',
    message: message,
    nudgeType: nudgeType
  });
}

// Level 2: Suggestion prompts (medium friction)
function showSuggestionNudge(sessionData, signals, durationMinutes) {
  const suggestions = [];
  let nudgeType = '';
  
  if (sessionData.currentContext === 'shorts_feed') {
    nudgeType = 'shorts_redirect';
    suggestions.push('Watch a full video instead?');
    suggestions.push('Check your subscriptions');
    suggestions.push('Take a 5-minute break');
  } else if (signals.lowEngagement) {
    nudgeType = 'search_prompt';
    suggestions.push('Search for something specific?');
    suggestions.push('Browse your Watch Later');
    suggestions.push('Close YouTube for now');
  } else {
    nudgeType = 'general_break';
    suggestions.push('Take a short break');
    suggestions.push('Find something specific to watch');
    suggestions.push('Switch to a different activity');
  }
  
  sendToActiveTab({
    action: 'showSuggestionPrompt',
    suggestions: suggestions,
    duration: Math.round(durationMinutes),
    nudgeType: nudgeType
  });
}

// Level 3: Scroll resistance (high friction)
function activateScrollResistance(sessionData, durationMinutes) {
  console.log('LEVEL 3 TRIGGERED', durationMinutes);

  sendToActiveTab({
    action: 'activateScrollResistance',
    duration: Math.round(durationMinutes),
    context: sessionData.currentContext
  });
}
window.testNudge = (x) => triggerNudge(x); // test
// Helper: Send message to active YouTube tab
/*function sendToActiveTab(message) {
  browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
    if (tabs[0] && tabs[0].url && tabs[0].url.includes('youtube.com')) {
      browser.tabs.sendMessage(tabs[0].id, message)
        .catch(err => console.log('Could not send message to tab:', err));
    }
  });
}*/
function sendToActiveTab(message) {
  browser.tabs.query({ active: true, currentWindow: true }).then(tabs => {
    if (tabs[0] && tabs[0].url.includes('youtube.com')) {
      // Send only if content script is ready
      browser.tabs.sendMessage(tabs[0].id, message)
        .catch(err => console.log('Could not send message to tab:', err));
    }
  });
}
let readyTabs = new Set();

browser.runtime.onMessage.addListener((msg, sender) => {
  if (msg.action === 'contentReady' && sender.tab) {
    readyTabs.add(sender.tab.id);
    console.log('Tab ready for nudges:', sender.tab.id);
  }
});


// Log nudges for effectiveness analysis
async function logNudge(sessionId, nudgeLevel, nudgeCount, durationMinutes) {
  try {
    const result = await browser.storage.local.get(['nudgeHistory']);
    const history = result.nudgeHistory || [];
    
    history.push({
      timestamp: Date.now(),
      sessionId: sessionId,
      nudgeLevel: nudgeLevel,
      nudgeCount: nudgeCount,
      sessionDuration: durationMinutes
    });
    
    // Keep last 100 nudges
    const recentHistory = history.slice(-100);
    await browser.storage.local.set({ nudgeHistory: recentHistory });
    
    console.log('Nudge logged - Level:', nudgeLevel, 'Count:', nudgeCount);
  } catch (error) {
    console.error('Error logging nudge:', error);
  }
}
