/**
 * main.js — App Orchestrator
 *
 * Wires together: file upload → parser → sender selection → renderer → search.
 */

// ---- CSS Imports ----
import './styles/index.css';
import './styles/landing.css';
import './styles/header.css';
import './styles/chat.css';
import './styles/media-card.css';
import './styles/modal.css';
import './styles/search.css';
import './styles/animations.css';

// ---- Module Imports ----
import { parseChat, markOutgoing } from './parser.js';
import { renderChatHeader, renderMessages, scrollToBottom } from './renderer.js';
import { initTheme, toggleTheme } from './theme.js';
import { getInitials, getSenderColor, debounce, escapeHtml } from './utils.js';

/* ================================================================
   State
   ================================================================ */
let chatData = null;     // { messages, senders, isGroup }
let myName = null;       // Selected sender name
let searchMatches = [];  // Array of message elements matching search
let searchIndex = -1;    // Current search match index

/* ================================================================
   DOM References
   ================================================================ */
const landingPage       = document.getElementById('landing-page');
const dropZone          = document.getElementById('drop-zone');
const fileInput         = document.getElementById('file-input');
const senderModal       = document.getElementById('sender-modal');
const senderList        = document.getElementById('sender-list');
const senderConfirmBtn  = document.getElementById('sender-confirm-btn');
const chatView          = document.getElementById('chat-view');
const backBtn           = document.getElementById('back-btn');
const themeToggleBtn    = document.getElementById('theme-toggle-btn');
const searchToggleBtn   = document.getElementById('search-toggle-btn');
const searchBar         = document.getElementById('search-bar');
const searchInput       = document.getElementById('search-input');
const searchCloseBtn    = document.getElementById('search-close-btn');
const searchResultsInfo = document.getElementById('search-results-info');
const searchResultsCount= document.getElementById('search-results-count');
const searchPrevBtn     = document.getElementById('search-prev-btn');
const searchNextBtn     = document.getElementById('search-next-btn');
const scrollBottomBtn   = document.getElementById('scroll-bottom-btn');
const chatCanvas        = document.getElementById('chat-canvas');

/* ================================================================
   Initialize
   ================================================================ */
initTheme();
setupEventListeners();

/* ================================================================
   Event Listeners
   ================================================================ */
function setupEventListeners() {
  // ---- File Upload ----
  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleFile(e.target.files[0]);
    }
  });

  // Drag & Drop
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      handleFile(e.dataTransfer.files[0]);
    }
  });

  // ---- Sender Selection ----
  senderConfirmBtn.addEventListener('click', confirmSender);

  // ---- Header Actions ----
  backBtn.addEventListener('click', resetToLanding);
  themeToggleBtn.addEventListener('click', () => toggleTheme());
  searchToggleBtn.addEventListener('click', toggleSearch);

  // ---- Search ----
  searchInput.addEventListener('input', debounce(performSearch, 250));
  searchCloseBtn.addEventListener('click', closeSearch);
  searchPrevBtn.addEventListener('click', () => navigateSearch(-1));
  searchNextBtn.addEventListener('click', () => navigateSearch(1));

  // Keyboard shortcuts for search
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      navigateSearch(e.shiftKey ? -1 : 1);
    }
    if (e.key === 'Escape') {
      closeSearch();
    }
  });

  // ---- Scroll to Bottom Button ----
  chatCanvas.addEventListener('scroll', handleScroll);
  scrollBottomBtn.addEventListener('click', () => scrollToBottom(true));
}

/* ================================================================
   File Handling
   ================================================================ */
function handleFile(file) {
  // Validate file type
  if (!file.name.endsWith('.txt')) {
    showError('Please upload a .txt file');
    return;
  }

  // Show processing state
  showProcessing(true);

  const reader = new FileReader();

  reader.onload = (e) => {
    const rawText = e.target.result;

    try {
      chatData = parseChat(rawText);

      if (chatData.messages.length === 0) {
        showError('No messages found. Please check the file format.');
        showProcessing(false);
        return;
      }

      if (chatData.senders.length === 0) {
        showError('No senders detected. Please check the file format.');
        showProcessing(false);
        return;
      }

      showProcessing(false);
      showSenderModal();
    } catch (err) {
      console.error('Parse error:', err);
      showError('Failed to parse the chat file. Please check the format.');
      showProcessing(false);
    }
  };

  reader.onerror = () => {
    showError('Failed to read the file.');
    showProcessing(false);
  };

  reader.readAsText(file);
}

/* ================================================================
   Processing Overlay
   ================================================================ */
function showProcessing(show) {
  const existing = document.querySelector('.processing-overlay');
  if (show) {
    if (existing) return;
    const overlay = document.createElement('div');
    overlay.className = 'processing-overlay';
    overlay.innerHTML = `
      <div class="loading-spinner"></div>
      <span class="processing-text">Parsing your chat...</span>
    `;
    const card = document.querySelector('.landing-card');
    if (card) {
      card.style.position = 'relative';
      card.appendChild(overlay);
    }
  } else {
    if (existing) existing.remove();
  }
}

/* ================================================================
   Error Toast
   ================================================================ */
function showError(message) {
  let toast = document.querySelector('.error-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'error-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  // Trigger reflow for re-animation
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');

  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

/* ================================================================
   Sender Selection Modal
   ================================================================ */
function showSenderModal() {
  senderList.innerHTML = '';
  myName = null;
  senderConfirmBtn.disabled = true;

  // Count messages per sender
  const msgCounts = {};
  chatData.messages.forEach((msg) => {
    if (msg.sender) {
      msgCounts[msg.sender] = (msgCounts[msg.sender] || 0) + 1;
    }
  });

  chatData.senders.forEach((sender) => {
    const item = document.createElement('div');
    item.className = 'sender-item';
    item.dataset.sender = sender;

    const avatar = document.createElement('div');
    avatar.className = 'sender-item-avatar';
    avatar.textContent = getInitials(sender);
    avatar.style.backgroundColor = getSenderColor(sender);

    const name = document.createElement('span');
    name.className = 'sender-item-name';
    name.textContent = sender;

    const count = document.createElement('span');
    count.className = 'sender-item-count';
    count.textContent = `${msgCounts[sender] || 0} msgs`;

    const check = document.createElement('div');
    check.className = 'sender-item-check';
    check.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

    item.appendChild(avatar);
    item.appendChild(name);
    item.appendChild(count);
    item.appendChild(check);

    item.addEventListener('click', () => selectSender(sender));
    senderList.appendChild(item);
  });

  // Show modal, hide landing
  landingPage.classList.add('fade-out');
  setTimeout(() => {
    senderModal.hidden = false;
  }, 300);
}

function selectSender(sender) {
  myName = sender;
  senderConfirmBtn.disabled = false;

  // Update visual selection
  document.querySelectorAll('.sender-item').forEach((item) => {
    item.classList.toggle('selected', item.dataset.sender === sender);
  });
}

function confirmSender() {
  if (!myName || !chatData) return;

  // Mark outgoing messages
  markOutgoing(chatData.messages, myName);

  // Hide modal, show chat
  senderModal.hidden = true;
  landingPage.hidden = true;
  chatView.hidden = false;

  // Render
  renderChatHeader(chatData, myName);
  renderMessages(chatData.messages, chatData.isGroup);

  // Scroll to bottom after rendering
  requestAnimationFrame(() => {
    scrollToBottom(false);
  });
}

/* ================================================================
   Search
   ================================================================ */
function toggleSearch() {
  const isHidden = searchBar.hidden;
  searchBar.hidden = !isHidden;

  if (!isHidden) {
    closeSearch();
  } else {
    searchInput.focus();
  }
}

function closeSearch() {
  searchBar.hidden = true;
  searchInput.value = '';
  searchResultsInfo.hidden = true;
  clearSearchHighlights();
  searchMatches = [];
  searchIndex = -1;
}

function performSearch() {
  const query = searchInput.value.trim().toLowerCase();
  clearSearchHighlights();
  searchMatches = [];
  searchIndex = -1;

  if (!query) {
    searchResultsInfo.hidden = true;
    return;
  }

  // Find all message-text elements that contain the query
  const textEls = document.querySelectorAll('.message-text');

  textEls.forEach((textEl) => {
    const originalText = textEl.textContent;
    if (originalText.toLowerCase().includes(query)) {
      // Highlight matches
      const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
      const highlighted = escapeHtml(originalText).replace(regex, '<mark class="search-highlight">$1</mark>');
      textEl.innerHTML = highlighted;
      searchMatches.push(textEl);
    }
  });

  // Also search system messages
  const systemEls = document.querySelectorAll('.system-message');
  systemEls.forEach((sysEl) => {
    if (sysEl.textContent.toLowerCase().includes(query)) {
      searchMatches.push(sysEl);
    }
  });

  // Show results info
  searchResultsInfo.hidden = false;
  if (searchMatches.length > 0) {
    searchIndex = 0;
    searchResultsCount.textContent = `1 of ${searchMatches.length}`;
    highlightCurrentMatch();
  } else {
    searchResultsCount.textContent = 'No results';
  }
}

function navigateSearch(direction) {
  if (searchMatches.length === 0) return;

  // Remove active class from current
  removeActiveHighlight();

  searchIndex += direction;
  if (searchIndex >= searchMatches.length) searchIndex = 0;
  if (searchIndex < 0) searchIndex = searchMatches.length - 1;

  searchResultsCount.textContent = `${searchIndex + 1} of ${searchMatches.length}`;
  highlightCurrentMatch();
}

function highlightCurrentMatch() {
  if (searchIndex < 0 || searchIndex >= searchMatches.length) return;

  const el = searchMatches[searchIndex];
  const highlights = el.querySelectorAll('.search-highlight');
  if (highlights.length > 0) {
    highlights[0].classList.add('active');
  }

  // Scroll to the matched element
  el.closest('.message-row, .system-message')?.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  });
}

function removeActiveHighlight() {
  document.querySelectorAll('.search-highlight.active').forEach((el) => {
    el.classList.remove('active');
  });
}

function clearSearchHighlights() {
  // Re-render text content to remove highlights
  const highlighted = document.querySelectorAll('.message-text');
  highlighted.forEach((el) => {
    const marks = el.querySelectorAll('mark.search-highlight');
    if (marks.length > 0) {
      // Restore original text
      el.textContent = el.textContent;
    }
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ================================================================
   Scroll Handling
   ================================================================ */
function handleScroll() {
  const canvas = chatCanvas;
  const distanceFromBottom = canvas.scrollHeight - canvas.scrollTop - canvas.clientHeight;

  if (distanceFromBottom > 200) {
    scrollBottomBtn.hidden = false;
    requestAnimationFrame(() => scrollBottomBtn.classList.add('visible'));
  } else {
    scrollBottomBtn.classList.remove('visible');
    setTimeout(() => {
      if (!scrollBottomBtn.classList.contains('visible')) {
        scrollBottomBtn.hidden = true;
      }
    }, 300);
  }
}

/* ================================================================
   Reset / Back to Landing
   ================================================================ */
function resetToLanding() {
  chatView.hidden = true;
  senderModal.hidden = true;
  landingPage.hidden = false;
  landingPage.classList.remove('fade-out');

  // Reset state
  chatData = null;
  myName = null;
  searchMatches = [];
  searchIndex = -1;
  fileInput.value = '';

  // Clear chat
  document.getElementById('messages-container').innerHTML = '';

  // Close search if open
  closeSearch();
}
