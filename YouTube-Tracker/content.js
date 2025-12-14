// console.log when script loads
console.log('YouTube Scrolling Tracker loaded');

// import ML prediction (not used in content script yet)
import { predictDoomscrollProbability } from './model.js';

// ---- READY HANDSHAKE ----
// Notify background script that content script is ready
let contentReady = false;
browser.runtime.sendMessage({ action: 'contentReady' }).then(() => {
  contentReady = true;
  console.log('Content script ready for nudges');
});

// ---- DOMAIN CHECK ----
// Only run on YouTube domain
if (!window.location.hostname.includes('youtube.com')) {
  console.log('Not on YouTube, script will not track');
  throw new Error('Not on YouTube domain');
}

// ---- INITIAL STATE ----
let scrollData = {
  startTime: Date.now(), // session start timestamp
  sessionId: 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9), // unique session ID
  scrollEvents: [], // array of scroll events
  videoClicks: 0, // count of regular video clicks
  shortsClicks: 0, // count of Shorts clicks
  totalScrollDistance: 0, // total scroll distance tracked
  lastScrollPosition: 0, // previous scroll position
  videoInteractions: [], // detailed video/short interactions
  currentVideo: null, // current video ID
  currentContext: 'unknown', // current page context
  timeInShorts: 0, // cumulative time in Shorts
  timeWatchingVideo: 0, // cumulative time watching videos
  lastContextChange: Date.now() // last time context changed
};

// ---- SCROLL TRACKING ----
let scrollTimeout; // timeout to detect scroll pause
let isActivelyScrolling = false; // whether user is actively scrolling
let scrollPauseCount = 0; // number of scroll pauses detected
let lastScrollSaveTime = Date.now(); // last timestamp scroll was saved

// Function to save meaningful scroll events
function saveScrollEvent(distance, y = window.scrollY) {
  const t = Date.now();
  if (distance > 50 || t - lastScrollSaveTime > 500) {
    scrollData.scrollEvents.push({ timestamp: t, scrollY: y, scrollDistance: distance });
    lastScrollSaveTime = t;
  }
}

// ---- WINDOW SCROLL EVENT ----
window.addEventListener('scroll', () => {
  const currentTime = Date.now();
  const scrollY = window.scrollY;
  const scrollDistance = Math.abs(scrollY - scrollData.lastScrollPosition);

  isActivelyScrolling = true;

  // Save scroll if significant or enough time passed
  saveScrollEvent(scrollDistance, scrollY);

  // Track total distance
  scrollData.totalScrollDistance += scrollDistance;
  scrollData.lastScrollPosition = scrollY;

  // Detect scroll pause
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    isActivelyScrolling = false;
    scrollPauseCount++;
    if (Date.now() - currentTime > 3000) {
      console.log('Significant scroll pause detected');
    }
  }, 2000);
});

// ---- WHEEL EVENT (Shorts) ----
window.addEventListener('wheel', (event) => {
  if (!scrollData.currentContext.includes('shorts')) return;

  const currentTime = Date.now();
  const deltaY = Math.abs(event.deltaY);

  // Only track meaningful movement
  if (deltaY > 10) {
    scrollData.totalScrollDistance += deltaY;

    if ((currentTime - lastScrollSaveTime) > 500) {
      scrollData.scrollEvents.push({
        timestamp: currentTime,
        scrollY: window.scrollY,
        scrollDistance: deltaY
      });
      lastScrollSaveTime = currentTime;
      console.log('Shorts wheel event saved, total events:', scrollData.scrollEvents.length);
    }
  }
}, { passive: true });

// ---- TOUCH EVENTS (Shorts mobile/touch) ----
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
      scrollData.scrollEvents.push({
        timestamp: currentTime,
        scrollY: 0, // Shorts don't have scrollY
        scrollDistance: touchDistance
      });
      lastScrollSaveTime = currentTime;
      console.log('Shorts touch event saved, total events:', scrollData.scrollEvents.length);
    }

    touchStartY = touchY; // update start for next move
  }
}, { passive: true });

// ---- VIDEO & SHORTS TRACKING ----
let lastWatchedVideoId = null;
let lastWatchedShortId = null;

// Detect navigation to new video or Shorts
function trackVideoNavigation() {
  const url = window.location.href;

  // Regular video
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

  // Shorts
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

// ---- TRACK CURRENT VIDEO ----
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

// ---- CONTEXT TRACKING ----
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

// ---- SPA URL CHANGE DETECTION ----
let lastUrl = location.href;
new MutationObserver(() => {
  const url = location.href;
  if (url !== lastUrl) {
    lastUrl = url;
    updateContext();
    trackVideoNavigation();
    setTimeout(trackCurrentVideo, 1000);
  }
}).observe(document, {subtree: true, childList: true});

// ---- INITIAL CALLS ----
updateContext();
trackVideoNavigation();
trackCurrentVideo();

// ---- AUTO-SAVE FUNCTION ----
function saveScrollData() {
  updateContext();

  const totalClicks = scrollData.videoClicks + scrollData.shortsClicks;

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
    sessionDuration: Date.now() - scrollData.startTime,
    url: window.location.href,
    timestamp: Date.now(),
    scrollPauseCount: scrollPauseCount,
    isActivelyScrolling: isActivelyScrolling
  };

  console.log('Attempting to save data:', {
    sessionId: scrollData.sessionId,
    duration: Math.round(sessionData.sessionDuration / 1000) + 's',
    context: scrollData.currentContext,
    scrolls: scrollData.scrollEvents.length,
    videos: scrollData.videoClicks,
    shorts: scrollData.shortsClicks
  });

  browser.runtime.sendMessage({ action: 'saveScrollData', data: sessionData })
    .then(response => console.log('Data saved successfully:', response))
    .catch(error => console.error('Failed to save data:', error));
}

// ---- AUTO-SAVE INTERVAL ----
console.log('Setting up auto-save interval (every 30 seconds)');
setInterval(() => {
  console.log('Auto-save triggered');
  saveScrollData();
}, 30000);

// ---- SAVE ON UNLOAD ----
window.addEventListener('beforeunload', () => {
  console.log('Page closing, saving data');
  saveScrollData();
});

// ---- NUDGE SYSTEM ----
browser.runtime.onMessage.addListener((message) => {
  if (message.action === 'showAwarenessBanner') showAwarenessBanner(message.message, message.nudgeType);
  else if (message.action === 'showSuggestionPrompt') showSuggestionPrompt(message.suggestions, message.duration, message.nudgeType);
  else if (message.action === 'activateScrollResistance') activateScrollResistance(message.duration, message.context);
});

// ---- NUDGE LEVEL 1: AWARENESS BANNER ----
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

  document.getElementById('banner-close').addEventListener('click', () => {
    banner.remove();
  });

  setTimeout(() => {
    if (banner.parentElement) banner.remove();
  }, 8000);
}

// ---- NUDGE LEVEL 2: SUGGESTION PROMPT ----
function showSuggestionPrompt(suggestions, duration, nudgeType) {
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
        You've been here ${duration} minutes
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
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
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

// ---- NUDGE LEVEL 3: SCROLL RESISTANCE ----
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
  overlayElem.style.position = 'fixed';
  overlayElem.style.top = '0';
  overlayElem.style.left = '0';
  overlayElem.style.right = '0';
  overlayElem.style.bottom = '0';
  overlayElem.style.background = 'rgba(255,255,255,0.3)';
  overlayElem.style.backdropFilter = 'blur(4px)';
  overlayElem.style.zIndex = '9999999';
  overlayElem.style.display = 'flex';
  overlayElem.style.alignItems = 'center';
  overlayElem.style.justifyContent = 'center';
  overlayElem.style.fontSize = '28px';
  overlayElem.style.fontWeight = '700';
  overlayElem.style.color = '#e74c3c';
  overlayElem.style.fontFamily = 'Segoe UI, sans-serif';
  overlayElem.innerText = 'Slow down! You’ve been scrolling too much';
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

// ---- END OF SCRIPT ----
console.log('YouTube Scrolling Tracker fully initialized');
