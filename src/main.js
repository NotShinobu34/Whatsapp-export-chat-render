/**
 * main.js — App Orchestrator (v2 — Web Worker parsing + Virtual Scrolling)
 *
 * Flow: File upload → Worker parse → Sender modal → Virtual-scroll render → Search
 */

/* ── CSS Imports ──────────────────────────────────────────── */
import './styles/index.css';
import './styles/landing.css';
import './styles/header.css';
import './styles/chat.css';
import './styles/media-card.css';
import './styles/modal.css';
import './styles/search.css';
import './styles/animations.css';

/* ── Module Imports ───────────────────────────────────────── */
import { markOutgoing } from './parser.js';
import {
  prepareRows,
  estimateRowHeight,
  renderRow,
  renderChatHeader,
} from './renderer.js';
import { initTheme, toggleTheme } from './theme.js';
import { getInitials, getSenderColor, resetSenderColors, debounce } from './utils.js';
import { VirtualScroller } from './virtual-scroller.js';

/* ================================================================
   State
   ================================================================ */
let chatData = null;        // { messages, senders, isGroup }
let myName = null;
let allRows = [];           // pre-computed row array (date-seps + messages)
let scroller = null;        // VirtualScroller instance
let searchQuery = '';
let searchHits = [];        // indices into allRows that match search
let searchCursor = -1;

/* ================================================================
   DOM References
   ================================================================ */
const $landing        = document.getElementById('landing-page');
const $dropZone       = document.getElementById('drop-zone');
const $fileInput      = document.getElementById('file-input');
const $modal          = document.getElementById('sender-modal');
const $senderList     = document.getElementById('sender-list');
const $senderConfirm  = document.getElementById('sender-confirm-btn');
const $chatView       = document.getElementById('chat-view');
const $backBtn        = document.getElementById('back-btn');
const $themeBtn       = document.getElementById('theme-toggle-btn');
const $searchBtn      = document.getElementById('search-toggle-btn');
const $searchBar      = document.getElementById('search-bar');
const $searchInput    = document.getElementById('search-input');
const $searchClose    = document.getElementById('search-close-btn');
const $searchInfo     = document.getElementById('search-results-info');
const $searchCount    = document.getElementById('search-results-count');
const $searchPrev     = document.getElementById('search-prev-btn');
const $searchNext     = document.getElementById('search-next-btn');
const $scrollBtn      = document.getElementById('scroll-bottom-btn');
const $chatCanvas     = document.getElementById('chat-canvas');
const $msgContainer   = document.getElementById('messages-container');

/* ================================================================
   Init
   ================================================================ */
initTheme();
wireEvents();

/* ================================================================
   Event Wiring
   ================================================================ */
function wireEvents() {
  /* File upload */
  $dropZone.addEventListener('click', () => $fileInput.click());
  $fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });

  $dropZone.addEventListener('dragover', e => { e.preventDefault(); $dropZone.classList.add('dragover'); });
  $dropZone.addEventListener('dragleave', () => $dropZone.classList.remove('dragover'));
  $dropZone.addEventListener('drop', e => {
    e.preventDefault();
    $dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  /* Sender modal */
  $senderConfirm.addEventListener('click', confirmSender);

  /* Header */
  $backBtn.addEventListener('click', resetToLanding);
  $themeBtn.addEventListener('click', () => {
    toggleTheme();
    // Re-render visible rows for theme-dependent rendering
    if (scroller) scroller.rerender();
  });
  $searchBtn.addEventListener('click', toggleSearch);

  /* Search */
  $searchInput.addEventListener('input', debounce(doSearch, 200));
  $searchClose.addEventListener('click', closeSearch);
  $searchPrev.addEventListener('click', () => navSearch(-1));
  $searchNext.addEventListener('click', () => navSearch(1));
  $searchInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); navSearch(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') closeSearch();
  });

  /* Scroll-to-bottom button */
  $chatCanvas.addEventListener('scroll', handleScroll, { passive: true });
  $scrollBtn.addEventListener('click', () => { if (scroller) scroller.scrollToBottom('smooth'); });
}

/* ================================================================
   File Handling → Web Worker Parse
   ================================================================ */
function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.txt')) {
    showError('Please upload a .txt file'); return;
  }

  showProcessing(true, 'Reading file…');

  const reader = new FileReader();

  reader.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.floor((e.loaded / e.total) * 100);
      updateProcessingText(`Reading file… ${pct}%`);
    }
  };

  reader.onload = (e) => {
    updateProcessingText('Parsing messages…');
    parseInWorker(e.target.result);
  };

  reader.onerror = () => {
    showError('Failed to read the file.');
    showProcessing(false);
  };

  reader.readAsText(file);
}

function parseInWorker(rawText) {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });

  worker.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === 'progress') {
      updateProcessingText(`${msg.stage} (${msg.percent}%)`);
      return;
    }

    if (msg.type === 'error') {
      showError('Parse failed: ' + msg.error);
      showProcessing(false);
      worker.terminate();
      return;
    }

    if (msg.type === 'complete') {
      worker.terminate();
      chatData = msg.data;

      if (chatData.messages.length === 0) {
        showError('No messages found. Check the file format.');
        showProcessing(false);
        return;
      }
      if (chatData.senders.length === 0) {
        showError('No senders detected. Check the file format.');
        showProcessing(false);
        return;
      }

      showProcessing(false);
      showSenderModal();
    }
  };

  worker.onerror = (err) => {
    console.error('Worker error:', err);
    showError('Parsing failed unexpectedly.');
    showProcessing(false);
    worker.terminate();
  };

  worker.postMessage({ rawText });
}

/* ================================================================
   Processing Overlay
   ================================================================ */
function showProcessing(show, text) {
  let overlay = document.querySelector('.processing-overlay');
  if (show) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'processing-overlay';
      overlay.innerHTML = `<div class="loading-spinner"></div><span class="processing-text">${text || 'Processing…'}</span>`;
      const card = document.querySelector('.landing-card');
      if (card) { card.style.position = 'relative'; card.appendChild(overlay); }
    }
  } else {
    if (overlay) overlay.remove();
  }
}

function updateProcessingText(text) {
  const el = document.querySelector('.processing-text');
  if (el) el.textContent = text;
}

/* ================================================================
   Error Toast
   ================================================================ */
function showError(msg) {
  let toast = document.querySelector('.error-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'error-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.remove('show');
  void toast.offsetWidth;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 4000);
}

/* ================================================================
   Sender Modal
   ================================================================ */
function showSenderModal() {
  $senderList.innerHTML = '';
  myName = null;
  $senderConfirm.disabled = true;

  // Count messages per sender
  const counts = {};
  for (const m of chatData.messages) {
    if (m.sender) counts[m.sender] = (counts[m.sender] || 0) + 1;
  }

  for (const sender of chatData.senders) {
    const item = document.createElement('div');
    item.className = 'sender-item';
    item.dataset.sender = sender;

    const av = document.createElement('div');
    av.className = 'sender-item-avatar';
    av.textContent = getInitials(sender);
    av.style.backgroundColor = getSenderColor(sender);

    const nm = document.createElement('span');
    nm.className = 'sender-item-name';
    nm.textContent = sender;

    const ct = document.createElement('span');
    ct.className = 'sender-item-count';
    ct.textContent = `${(counts[sender] || 0).toLocaleString()} msgs`;

    const chk = document.createElement('div');
    chk.className = 'sender-item-check';
    chk.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;

    item.append(av, nm, ct, chk);
    item.addEventListener('click', () => selectSender(sender));
    $senderList.appendChild(item);
  }

  $landing.classList.add('fade-out');
  setTimeout(() => { $modal.hidden = false; }, 300);
}

function selectSender(sender) {
  myName = sender;
  $senderConfirm.disabled = false;
  document.querySelectorAll('.sender-item').forEach(el => {
    el.classList.toggle('selected', el.dataset.sender === sender);
  });
}

function confirmSender() {
  if (!myName || !chatData) return;

  $modal.hidden = true;
  $landing.hidden = true;
  $chatView.hidden = false;

  /* Mark outgoing */
  markOutgoing(chatData.messages, myName);

  /* Render header */
  renderChatHeader(chatData, myName);

  /* Prepare row data & launch virtual scroller */
  resetSenderColors();
  allRows = prepareRows(chatData.messages, chatData.isGroup);

  initVirtualScroller();
}

/* ================================================================
   Virtual Scroller
   ================================================================ */
function initVirtualScroller() {
  if (scroller) scroller.destroy();
  $msgContainer.innerHTML = '';

  scroller = new VirtualScroller({
    scrollContainer: $chatCanvas,
    contentContainer: $msgContainer,
    rows: allRows,
    renderRow: (index) => renderRow(allRows[index], searchQuery),
    estimateHeight: estimateRowHeight,
    overscan: 40,
  });

  // Scroll to bottom after first paint
  requestAnimationFrame(() => scroller.scrollToBottom('instant'));
}

/* ================================================================
   Search (data-model, not DOM-based)
   ================================================================ */
function toggleSearch() {
  $searchBar.hidden = !$searchBar.hidden;
  if (!$searchBar.hidden) { $searchInput.focus(); }
  else { closeSearch(); }
}

function closeSearch() {
  $searchBar.hidden = true;
  $searchInput.value = '';
  $searchInfo.hidden = true;
  if (searchQuery) {
    searchQuery = '';
    searchHits = [];
    searchCursor = -1;
    if (scroller) scroller.rerender();
  }
}

function doSearch() {
  const q = $searchInput.value.trim().toLowerCase();
  searchQuery = q;
  searchHits = [];
  searchCursor = -1;

  if (!q) {
    $searchInfo.hidden = true;
    if (scroller) scroller.rerender();
    return;
  }

  /* Scan all rows for text matches */
  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    let text = '';
    if (row.type === 'message' || row.type === 'system') {
      text = row.message.text;
    }
    if (text && text.toLowerCase().includes(q)) {
      searchHits.push(i);
    }
  }

  $searchInfo.hidden = false;
  if (searchHits.length > 0) {
    searchCursor = 0;
    $searchCount.textContent = `1 of ${searchHits.length.toLocaleString()}`;
    scroller.rerender();
    scroller.scrollToRow(searchHits[0]);
  } else {
    $searchCount.textContent = 'No results';
    scroller.rerender();
  }
}

function navSearch(dir) {
  if (!searchHits.length) return;
  searchCursor += dir;
  if (searchCursor >= searchHits.length) searchCursor = 0;
  if (searchCursor < 0) searchCursor = searchHits.length - 1;
  $searchCount.textContent = `${(searchCursor + 1).toLocaleString()} of ${searchHits.length.toLocaleString()}`;
  scroller.scrollToRow(searchHits[searchCursor]);
}

/* ================================================================
   Scroll-to-bottom button
   ================================================================ */
function handleScroll() {
  const dist = $chatCanvas.scrollHeight - $chatCanvas.scrollTop - $chatCanvas.clientHeight;
  if (dist > 300) {
    $scrollBtn.hidden = false;
    requestAnimationFrame(() => $scrollBtn.classList.add('visible'));
  } else {
    $scrollBtn.classList.remove('visible');
    setTimeout(() => { if (!$scrollBtn.classList.contains('visible')) $scrollBtn.hidden = true; }, 300);
  }
}

/* ================================================================
   Reset
   ================================================================ */
function resetToLanding() {
  if (scroller) { scroller.destroy(); scroller = null; }
  $chatView.hidden = true;
  $modal.hidden = true;
  $landing.hidden = false;
  $landing.classList.remove('fade-out');

  chatData = null;
  myName = null;
  allRows = [];
  searchQuery = '';
  searchHits = [];
  searchCursor = -1;
  $fileInput.value = '';
  $msgContainer.innerHTML = '';
  closeSearch();
}
