// console.log when script loads
console.log('YouTube Scrolling Tracker loaded');

// DOMAIN CHECK
if (!window.location.hostname.includes('youtube.com')) {
  console.log('Not on YouTube, script will not track');
  throw new Error('Not on YouTube domain');
}

// INITIAL STATE
let scrollData = {
  startTime: Date.now(),
  sessionId: null,          // assigned by background
  resumeOffset: 0,          // prior session duration carried over from snapshot
  scrollEvents: [],
  videoClicks: 0,
  shortsClicks: 0,
  totalScrollDistance: 0,
  lastScrollPosition: 0,
  videoInteractions: [],
  currentVideo: null,
  currentContext: 'unknown',
  timeInShorts: 0,
  timeWatchingVideo: 0,
  lastContextChange: Date.now()
};

// SESSION HANDSHAKE
// Background returns { sessionId, snapshot }
// snapshot is the last saveScrollData payload from a previous load of this tab
// If snapshot exists, restore counters so duration and scrolls continue from where they left off
let contentReady = false;

browser.runtime.sendMessage({ action: 'requestSessionId' })
  .then(response => {
    if (response && response.sessionId) {
      scrollData.sessionId = response.sessionId;
      console.log('Session ID received from background:', scrollData.sessionId);
    } else {
      scrollData.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      console.warn('No session ID from background, using fallback:', scrollData.sessionId);
    }

    // Restore state from snapshot if this is a resumed session
    if (response && response.snapshot) {
      const s = response.snapshot;
      console.log('Resuming from snapshot:', {
        duration: Math.round(s.sessionDuration / 1000) + 's',
        scrollDistance: s.totalScrollDistance,
        videoClicks: s.videoClicks,
        shortsClicks: s.shortsClicks,
        scrollEventsCount: s.scrollEvents ? s.scrollEvents.length : 0
      });

      // Carry over accumulated counters
      scrollData.resumeOffset        = s.sessionDuration || 0;
      scrollData.videoClicks         = s.videoClicks || 0;
      scrollData.shortsClicks        = s.shortsClicks || 0;
      scrollData.totalScrollDistance = s.totalScrollDistance || 0;
      scrollData.lastScrollPosition  = s.lastScrollPosition || 0;
      scrollData.videoInteractions   = s.videoInteractions || [];
      scrollData.timeInShorts        = s.timeInShorts || 0;
      scrollData.timeWatchingVideo   = s.timeWatchingVideo || 0;
      scrollData.currentVideo        = s.currentVideo || null;
      scrollData.scrollEvents        = s.scrollEvents || [];
      scrollPauseCount               = s.scrollPauseCount || 0;
    }

    contentReady = true;
    console.log('Content script ready for nudges');
  })
  .catch(err => {
    scrollData.sessionId = 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    contentReady = true;
    console.warn('requestSessionId failed, using fallback:', scrollData.sessionId, err);
  });


function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

// SCROLL TRACKING
let scrollTimeout;
let isActivelyScrolling = false;
let scrollPauseCount = 0;
let lastScrollSaveTime = Date.now();

function saveScrollEvent(distance, y = window.scrollY) {
  const t = Date.now();
  if (distance > 50 || t - lastScrollSaveTime > 500) {
    scrollData.scrollEvents.push({ timestamp: t, scrollY: y, scrollDistance: distance });
    lastScrollSaveTime = t;
  }
}

window.addEventListener('scroll', () => {
  if (scrollData.currentContext === 'watching_video') return;
  const currentTime = Date.now();
  const scrollY = window.scrollY;
  const scrollDistance = Math.abs(scrollY - scrollData.lastScrollPosition);

  isActivelyScrolling = true;
  saveScrollEvent(scrollDistance, scrollY);
  scrollData.totalScrollDistance += scrollDistance;
  scrollData.lastScrollPosition = scrollY;

  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    isActivelyScrolling = false;
    scrollPauseCount++;
    if (Date.now() - currentTime > 3000) {
      console.log('Significant scroll pause detected');
    }
  }, 2000);
});

// WHEEL EVENT (Shorts)
window.addEventListener('wheel', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return;

  const currentTime = Date.now();
  const deltaY = Math.abs(event.deltaY);

  if (deltaY > 10) {
    scrollData.totalScrollDistance += deltaY;
    if ((currentTime - lastScrollSaveTime) > 500) {
      scrollData.scrollEvents.push({ timestamp: currentTime, scrollY: window.scrollY, scrollDistance: deltaY });
      lastScrollSaveTime = currentTime;
      console.log('Shorts wheel event saved, total events:', scrollData.scrollEvents.length);
    }
  }
}, { passive: true });

// TOUCH EVENTS (Shorts)
let touchStartY = 0;
window.addEventListener('touchstart', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return;
  touchStartY = event.touches[0].clientY;
}, { passive: true });

window.addEventListener('touchmove', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return;

  const currentTime = Date.now();
  const touchY = event.touches[0].clientY;
  const touchDistance = Math.abs(touchY - touchStartY);

  if (touchDistance > 50) {
    scrollData.totalScrollDistance += touchDistance;
    if ((currentTime - lastScrollSaveTime) > 500) {
      scrollData.scrollEvents.push({ timestamp: currentTime, scrollY: 0, scrollDistance: touchDistance });
      lastScrollSaveTime = currentTime;
      console.log('Shorts touch event saved, total events:', scrollData.scrollEvents.length);
    }
    touchStartY = touchY;
  }
}, { passive: true });

// VIDEO & SHORTS TRACKING
let lastWatchedVideoId = null;
let lastWatchedShortId = null;

function trackVideoNavigation() {
  const url = window.location.href;

  if (url.includes('/watch?v=')) {
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (videoId && videoId !== lastWatchedVideoId) {
      scrollData.videoClicks++;
      lastWatchedVideoId = videoId;

      setTimeout(() => {
        const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                             document.querySelector('h1.title yt-formatted-string') ||
                             document.querySelector('h1 yt-formatted-string');
        const title = titleElement ? titleElement.textContent.trim() : 'Unknown Video';

        scrollData.videoInteractions.push({
          timestamp: Date.now(),
          videoUrl: url,
          videoTitle: title.substring(0, 100),
          scrollPosition: window.scrollY,
          type: 'video',
          context: scrollData.currentContext
        });

        console.log('Video opened (count: ' + scrollData.videoClicks + '):', title.substring(0, 50));
        saveScrollData();
      }, 1500);
    }
  }

  else if (url.includes('/shorts/')) {
    const shortId = url.split('/shorts/')[1]?.split('?')[0];
    if (shortId && shortId !== lastWatchedShortId) {
      scrollData.shortsClicks++;
      lastWatchedShortId = shortId;

      setTimeout(() => {
        const titleElement = document.querySelector('h2.style-scope.ytd-reel-video-renderer') ||
                             document.querySelector('#shorts-player ytd-rich-grid-media h3');
        const title = titleElement ? titleElement.textContent.trim() : 'YouTube Short';

        scrollData.videoInteractions.push({
          timestamp: Date.now(),
          videoUrl: url,
          videoTitle: title.substring(0, 100),
          scrollPosition: window.scrollY,
          type: 'short',
          context: scrollData.currentContext
        });

        console.log('Short opened (Videos: ' + scrollData.videoClicks + ', Shorts: ' + scrollData.shortsClicks + ') -', title);
        saveScrollData();
      }, 1500);
    }
  }
}

function trackCurrentVideo() {
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v');

  if (videoId && videoId !== scrollData.currentVideo) {
    scrollData.currentVideo = videoId;
    setTimeout(() => {
      const titleElement = document.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
                           document.querySelector('h1.title yt-formatted-string') ||
                           document.querySelector('h1 yt-formatted-string');
      const title = titleElement ? titleElement.textContent.trim() : 'Unknown Video';
      scrollData.videoInteractions.push({
        timestamp: Date.now(),
        type: 'video_watch',
        videoId: videoId,
        videoTitle: title,
        url: window.location.href
      });
      console.log('Now watching:', title);
    }, 1500);
  }
}

// CONTEXT TRACKING
function updateContext() {
  const url = window.location.href;
  const previousContext = scrollData.currentContext;
  const now = Date.now();

  if (url.includes('/watch')) scrollData.currentContext = 'watching_video';
  else if (url.includes('/shorts/')) scrollData.currentContext = 'shorts_feed';
  else if (url === 'https://www.youtube.com/' || url === 'https://www.youtube.com') scrollData.currentContext = 'homepage';
  else if (url.includes('/results')) scrollData.currentContext = 'search_results';
  else if (url.includes('/feed/subscriptions')) scrollData.currentContext = 'subscriptions';
  else scrollData.currentContext = 'other';

  if (previousContext === 'watching_video') scrollData.timeWatchingVideo += now - scrollData.lastContextChange;
  if (previousContext === 'shorts_feed') scrollData.timeInShorts += now - scrollData.lastContextChange;

  scrollData.lastContextChange = now;

  if (previousContext !== scrollData.currentContext) {
    console.log('Context changed:', previousContext, 'to', scrollData.currentContext);
  }
}

// SPA URL CHANGE DETECTION
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    updateContext();
    trackVideoNavigation();
    setTimeout(trackCurrentVideo, 1000);
  }
}).observe(document, { subtree: true, childList: true });

updateContext();
trackVideoNavigation();
trackCurrentVideo();

// AUTO-SAVE
// sessionDuration = time elapsed this load + any prior duration carried from snapshot
function saveScrollData() {
  if (!scrollData.sessionId) {
    console.warn('saveScrollData called before session ID assigned, skipping');
    return;
  }

  updateContext();

  const totalClicks = scrollData.videoClicks + scrollData.shortsClicks;
  const elapsedThisLoad = Date.now() - scrollData.startTime;
  const sessionDuration = scrollData.resumeOffset + elapsedThisLoad;

  const sessionData = {
    sessionId: scrollData.sessionId,
    startTime: scrollData.startTime,
    scrollEvents: scrollData.scrollEvents,
    videoClicks: scrollData.videoClicks,
    shortsClicks: scrollData.shortsClicks,
    totalClicks: totalClicks,
    totalScrollDistance: scrollData.totalScrollDistance,
    lastScrollPosition: scrollData.lastScrollPosition,
    videoInteractions: scrollData.videoInteractions,
    currentVideo: scrollData.currentVideo,
    currentContext: scrollData.currentContext,
    timeInShorts: scrollData.timeInShorts,
    timeWatchingVideo: scrollData.timeWatchingVideo,
    sessionDuration: sessionDuration,   // accurate running total
    url: window.location.href,
    timestamp: Date.now(),
    scrollPauseCount: scrollPauseCount,
    isActivelyScrolling: isActivelyScrolling
  };

  console.log('Attempting to save data:', {
    sessionId: scrollData.sessionId,
    duration: Math.round(sessionDuration / 1000) + 's',
    context: scrollData.currentContext,
    scrolls: scrollData.scrollEvents.length,
    videos: scrollData.videoClicks,
    shorts: scrollData.shortsClicks
  });

  browser.runtime.sendMessage({ action: 'saveScrollData', data: sessionData })
    .then(response => console.log('Data saved successfully:', response))
    .catch(error => console.error('Failed to save data:', error));
}

console.log('Setting up auto-save interval (every 30 seconds)');
setInterval(() => {
  console.log('Auto-save triggered');
  saveScrollData();
}, 30000);

// SAVE & NOTIFY ON UNLOAD
window.addEventListener('beforeunload', () => {
  console.log('Page closing, notifying background and saving data');

  updateContext();
  const totalClicks = scrollData.videoClicks + scrollData.shortsClicks;
  const elapsedThisLoad = Date.now() - scrollData.startTime;
  const sessionDuration = scrollData.resumeOffset + elapsedThisLoad;

  const snapshot = {
    sessionId: scrollData.sessionId,
    startTime: scrollData.startTime,
    scrollEvents: scrollData.scrollEvents,
    videoClicks: scrollData.videoClicks,
    shortsClicks: scrollData.shortsClicks,
    totalClicks: totalClicks,
    totalScrollDistance: scrollData.totalScrollDistance,
    lastScrollPosition: scrollData.lastScrollPosition,
    videoInteractions: scrollData.videoInteractions,
    currentVideo: scrollData.currentVideo,
    currentContext: scrollData.currentContext,
    timeInShorts: scrollData.timeInShorts,
    timeWatchingVideo: scrollData.timeWatchingVideo,
    sessionDuration: sessionDuration,
    url: window.location.href,
    timestamp: Date.now(),
    scrollPauseCount: scrollPauseCount,
    isActivelyScrolling: isActivelyScrolling
  };

  // Send snapshot to background for pause storage, then save
  browser.runtime.sendMessage({ action: 'youtubeClosed', snapshot }).catch(() => {});
  browser.runtime.sendMessage({ action: 'saveScrollData', data: snapshot }).catch(() => {});
});

// NUDGE SYSTEM
browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'showAwarenessBanner') showAwarenessBanner(message.message, message.nudgeType);
  else if (message.action === 'showSuggestionPrompt') showSuggestionPrompt(message.suggestions, message.duration, message.nudgeType);
  else if (message.action === 'activateScrollResistance') activateScrollResistance(message.duration, message.context);
});

// NUDGE LEVEL 1: AWARENESS BANNER
function showAwarenessBanner(message, nudgeType) {
  const existing = document.getElementById('awareness-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.id = 'awareness-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      top: 20px;
      right: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 16px 20px;
      border-radius: 10px;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      z-index: 99999;
      max-width: 320px;
      font-family: 'Segoe UI', sans-serif;
      animation: slideIn 0.3s ease-out;
    ">
      <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
        <div style="font-weight: 600; font-size: 15px;">Time Check</div>
        <button id="banner-close" style="
          background: none;
          border: none;
          color: white;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          line-height: 1;
        ">×</button>
      </div>
      <div style="font-size: 13px; opacity: 0.95;">
        ${message}
      </div>
    </div>
    <style>
      @keyframes slideIn {
        from { transform: translateX(400px); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
    </style>
  `;
  document.body.appendChild(banner);
  document.getElementById('banner-close').addEventListener('click', () => banner.remove());
  setTimeout(() => { if (banner.parentElement) banner.remove(); }, 8000);
}

// NUDGE LEVEL 2: SUGGESTION PROMPT
function showSuggestionPrompt(suggestions, duration, nudgeType) {
  let safeDuration = 0;

  if (typeof duration === 'number') {
    safeDuration = duration;
  } else if (typeof duration === 'string') {
    safeDuration = duration.endsWith('s') ? parseInt(duration, 10) * 1000 : Number(duration);
  }

  if (isNaN(safeDuration) || !safeDuration) {
    console.warn('Invalid duration received:', duration);
    safeDuration = 0;
  }

  const existing = document.getElementById('suggestion-prompt');
  if (existing) existing.remove();

  const prompt = document.createElement('div');
  prompt.id = 'suggestion-prompt';

  const suggestionButtons = suggestions.map((s, i) => `
    <button class="suggestion-btn" data-index="${i}" style="
      width: 100%;
      padding: 12px;
      background: rgba(102, 126, 234, 0.1);
      border: 2px solid #667eea;
      border-radius: 8px;
      color: #667eea;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      margin-bottom: 8px;
      transition: all 0.2s;
    " onmouseover="this.style.background='#667eea'; this.style.color='white';"
       onmouseout="this.style.background='rgba(102, 126, 234, 0.1)'; this.style.color='#667eea';">
      ${s}
    </button>
  `).join('');

  prompt.innerHTML = `
    <div style="
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.4);
      z-index: 999999;
      max-width: 380px;
      width: 90%;
      font-family: 'Segoe UI', sans-serif;
    ">
      <div style="font-size: 20px; font-weight: 600; margin-bottom: 8px; color: #333;">
        You've been here ${formatDuration(safeDuration)}!
      </div>
      <div style="font-size: 14px; margin-bottom: 20px; color: #666;">
        What would you like to do?
      </div>
      ${suggestionButtons}
      <button id="prompt-dismiss" style="
        width: 100%;
        padding: 10px;
        background: #f5f5f5;
        border: none;
        border-radius: 6px;
        color: #666;
        cursor: pointer;
        font-size: 13px;
      ">Keep browsing</button>
    </div>
    <div id="prompt-backdrop" style="
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.6);
      z-index: 999998;
    "></div>
  `;
  document.body.appendChild(prompt);

  prompt.querySelectorAll('.suggestion-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      handleSuggestionClick(suggestions[parseInt(btn.dataset.index)]);
      prompt.remove();
    });
  });

  document.getElementById('prompt-dismiss').addEventListener('click', () => prompt.remove());
  document.getElementById('prompt-backdrop').addEventListener('click', () => prompt.remove());
}

function handleSuggestionClick(suggestion) {
  console.log('User selected suggestion:', suggestion);
  if (suggestion.includes('break') || suggestion.includes('Close')) window.close();
  else if (suggestion.includes('Search')) {
    const searchBox = document.querySelector('input#search');
    if (searchBox) searchBox.focus();
  } else if (suggestion.includes('subscriptions')) window.location.href = 'https://www.youtube.com/feed/subscriptions';
  else if (suggestion.includes('Watch Later')) window.location.href = 'https://www.youtube.com/playlist?list=WL';
}

// NUDGE LEVEL 3: SCROLL RESISTANCE
let scrollResistanceActive = false;
let scrollAccumulator = 0;
const SCROLL_THRESHOLD = 100;

function activateScrollResistance(duration, context) {
  if (scrollResistanceActive) return;
  scrollResistanceActive = true;
  console.log('SCROLL RESISTANCE ACTIVATED');

  showScrollResistanceOverlay(duration, context);
  window.addEventListener('wheel', resistScroll, { passive: false });
  window.addEventListener('touchmove', resistScrollTouch, { passive: false });

  setTimeout(() => {
    scrollResistanceActive = false;
    removeScrollResistanceOverlay();
    window.removeEventListener('wheel', resistScroll);
    window.removeEventListener('touchmove', resistScrollTouch);
    console.log('SCROLL RESISTANCE DEACTIVATED');
  }, duration * 1000);
}

function resistScroll(e) {
  scrollAccumulator += Math.abs(e.deltaY);
  if (scrollAccumulator > SCROLL_THRESHOLD) {
    e.preventDefault();
    shakeScrollOverlay();
  }
}

let touchResistanceStartY = 0;
function resistScrollTouch(e) {
  const touchY = e.touches[0].clientY;
  const dist = Math.abs(touchY - touchResistanceStartY);
  scrollAccumulator += dist;
  if (scrollAccumulator > SCROLL_THRESHOLD) {
    e.preventDefault();
    shakeScrollOverlay();
  }
  touchResistanceStartY = touchY;
}

let overlayElem;
function showScrollResistanceOverlay(duration, context) {
  overlayElem = document.createElement('div');
  overlayElem.id = 'scroll-resistance-overlay';
  overlayElem.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(255,255,255,0.3);
    backdrop-filter: blur(4px);
    z-index: 9999999;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px; font-weight: 700; color: #e74c3c;
    font-family: Segoe UI, sans-serif;
  `;
  overlayElem.innerText = "Slow down! You've been scrolling too much";
  document.body.appendChild(overlayElem);
}

function shakeScrollOverlay() {
  if (!overlayElem) return;
  overlayElem.style.transform = 'translateX(-5px)';
  setTimeout(() => overlayElem.style.transform = 'translateX(5px)', 50);
  setTimeout(() => overlayElem.style.transform = 'translateX(0)', 100);
}

function removeScrollResistanceOverlay() {
  if (overlayElem) overlayElem.remove();
}

console.log('YouTube Scrolling Tracker fully initialized');