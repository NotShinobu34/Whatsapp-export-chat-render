/**
 * renderer.js — Single-Row DOM Rendering Engine (v2 — virtual-scroll compatible)
 *
 * Each function creates one self-contained DOM element for a single row.
 * Search highlighting is applied at render time via the `searchQuery` parameter.
 */

import {
  getSenderColor,
  getInitials,
  formatTime,
  formatDateSeparator,
  getDateKey,
  isEmojiOnly,
  escapeHtml,
} from './utils.js';

/* ================================================================
   Row Types — used for pre-computation
   ================================================================ */
export const ROW = {
  DATE: 'date-separator',
  SYSTEM: 'system',
  MSG: 'message',
};

/* ================================================================
   SVG Icons (inlined, zero dependencies)
   ================================================================ */
const DOUBLE_TICK = `<svg viewBox="0 0 16 11"><path d="M11.07.73l-7 7-2.78-2.78L0 6.17l4 4L12.3 1.95z" fill="currentColor"/><path d="M15.07.73l-7 7-1.28-1.28-1.22 1.22 2.5 2.5L16.3 1.95z" fill="currentColor"/></svg>`;

const MEDIA_ICON = {
  image:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  video:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  audio:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  sticker:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
  gif:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><text x="12" y="15" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor" stroke="none">GIF</text></svg>`,
  contact:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  generic:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="3" x2="21" y2="21"/><line x1="21" y1="3" x2="3" y2="21"/></svg>`,
};

/* ================================================================
   Pre-compute rows: interleave messages with date separators
   ================================================================ */

/**
 * Converts a flat messages array into a row-data array with
 * date separators injected and hasTail / showSenderName computed.
 */
export function prepareRows(messages, isGroup) {
  const rows = [];
  let lastDate = '';
  let lastSender = null;

  for (let i = 0, len = messages.length; i < len; i++) {
    const msg = messages[i];
    const dk = getDateKey(msg.timestamp);

    if (dk !== lastDate) {
      rows.push({ type: ROW.DATE, timestamp: msg.timestamp });
      lastDate = dk;
      lastSender = null;
    }

    if (msg.type === 'system') {
      rows.push({ type: ROW.SYSTEM, message: msg });
      lastSender = null;
    } else {
      const newSender = msg.sender !== lastSender;
      rows.push({
        type: ROW.MSG,
        message: msg,
        hasTail: newSender,
        isNewSender: newSender,
        showName: isGroup && !msg.isOutgoing && newSender && !!msg.sender,
      });
      lastSender = msg.sender;
    }
  }

  return rows;
}

/* ================================================================
   Height estimation per row (used by virtual scroller)
   ================================================================ */

export function estimateRowHeight(row) {
  switch (row.type) {
    case ROW.DATE: return 44;
    case ROW.SYSTEM: {
      const len = row.message.text.length;
      return len > 80 ? 52 : 36;
    }
    case ROW.MSG: {
      const msg = row.message;
      let h = 6; // base vertical padding

      // Sender name
      if (row.showName) h += 20;

      // Content height
      if (msg.type === 'media-omitted') {
        const mt = msg.mediaType || 'generic';
        if (mt === 'audio') h += 72;
        else if (mt === 'document' || mt === 'contact') h += 76;
        else if (mt === 'sticker') h += 162;
        else h += 122; // image, video, gif, generic
      } else {
        const len = msg.text.length;
        const lines = (msg.text.match(/\n/g) || []).length + 1;

        if (isEmojiOnly(msg.text)) {
          h += 50;
        } else if (len <= 30) {
          h += 32;
        } else if (len <= 70) {
          h += 38;
        } else {
          // Approximate: ~40 chars per visual line at default font
          const visualLines = Math.max(lines, Math.ceil(len / 40));
          h += 20 + visualLines * 18;
        }
      }

      // Meta line
      h += 18;

      // New sender spacing
      if (row.isNewSender) h += 8;

      return Math.max(h, 36);
    }
    default: return 40;
  }
}

/* ================================================================
   Render a single row into a DOM element
   ================================================================ */

/**
 * @param {Object} row          – row data from prepareRows()
 * @param {string} searchQuery  – current search term (empty = no highlight)
 * @returns {HTMLElement}
 */
export function renderRow(row, searchQuery) {
  const wrapper = document.createElement('div');
  wrapper.className = 'v-row';

  switch (row.type) {
    case ROW.DATE:
      wrapper.classList.add('v-row-center');
      wrapper.appendChild(_dateSep(row.timestamp));
      break;

    case ROW.SYSTEM:
      wrapper.classList.add('v-row-center');
      wrapper.appendChild(_systemMsg(row.message, searchQuery));
      break;

    case ROW.MSG:
      wrapper.appendChild(_messageRow(row, searchQuery));
      break;
  }

  return wrapper;
}

/* ── Header ─────────────────────────────────────────────────── */

export function renderChatHeader(data, myName) {
  const avatar = document.getElementById('header-avatar');
  const name   = document.getElementById('header-name');
  const status = document.getElementById('header-status');

  if (data.isGroup) {
    avatar.textContent = '👥';
    name.textContent = data.senders.filter(s => s !== myName).join(', ');
    status.textContent = `${data.senders.length} participants`;
  } else {
    const other = data.senders.find(s => s !== myName) || data.senders[0] || 'Chat';
    avatar.textContent = getInitials(other);
    name.textContent = other;
    status.textContent = `${data.messages.length.toLocaleString()} messages`;
  }
}

/* ================================================================
   Internal builders
   ================================================================ */

function _dateSep(ts) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.textContent = formatDateSeparator(ts);
  return el;
}

function _systemMsg(msg, q) {
  const el = document.createElement('div');
  el.className = 'system-message';
  el.dataset.msgId = msg.id;
  if (q) {
    el.innerHTML = _highlightText(escapeHtml(msg.text), q);
  } else {
    el.textContent = msg.text;
  }
  return el;
}

function _messageRow(row, q) {
  const msg = row.message;
  const dir = msg.isOutgoing ? 'outgoing' : 'incoming';

  const rowEl = document.createElement('div');
  rowEl.className = `message-row ${dir}`;
  if (row.hasTail) rowEl.classList.add('has-tail');
  if (row.isNewSender) rowEl.classList.add('new-sender');
  rowEl.dataset.msgId = msg.id;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Sender name
  if (row.showName && msg.sender) {
    const sn = document.createElement('span');
    sn.className = 'sender-name';
    sn.textContent = msg.sender;
    sn.style.color = getSenderColor(msg.sender);
    bubble.appendChild(sn);
  }

  // Media card
  if (msg.type === 'media-omitted') {
    bubble.appendChild(_mediaCard(msg.mediaType || 'generic'));
  }

  // Text
  if (msg.type === 'text') {
    const txt = document.createElement('span');
    txt.className = 'message-text';

    if (isEmojiOnly(msg.text)) {
      txt.classList.add('emoji-only');
      txt.textContent = msg.text;
    } else if (q) {
      txt.innerHTML = _highlightText(_linkify(escapeHtml(msg.text)), q);
    } else {
      txt.innerHTML = _linkify(escapeHtml(msg.text));
    }
    bubble.appendChild(txt);
  }

  // Meta
  const meta = document.createElement('span');
  meta.className = 'message-meta';

  const ts = document.createElement('span');
  ts.textContent = formatTime(msg.timestamp);
  meta.appendChild(ts);

  if (msg.isOutgoing) {
    const tick = document.createElement('span');
    tick.className = 'tick-icon read';
    tick.innerHTML = DOUBLE_TICK;
    meta.appendChild(tick);
  }

  bubble.appendChild(meta);
  rowEl.appendChild(bubble);
  return rowEl;
}

function _mediaCard(mediaType) {
  const card = document.createElement('div');
  card.className = `media-card media-${mediaType}`;

  if (mediaType === 'audio') {
    const icon = _iconEl(mediaType);
    card.appendChild(icon);
    const wf = document.createElement('div');
    wf.className = 'media-card-waveform';
    for (let i = 0; i < 20; i++) {
      const b = document.createElement('div');
      b.className = 'waveform-bar';
      b.style.height = `${4 + Math.random() * 14}px`;
      wf.appendChild(b);
    }
    card.appendChild(wf);
    card.appendChild(_label());
  } else if (mediaType === 'document') {
    card.appendChild(_iconEl(mediaType));
    const info = document.createElement('div');
    info.className = 'media-card-doc-info';
    const n = document.createElement('span');
    n.className = 'media-card-doc-name';
    n.textContent = 'no media';
    info.appendChild(n);
    card.appendChild(info);
  } else if (mediaType === 'contact') {
    card.appendChild(_iconEl(mediaType));
    card.appendChild(_label());
  } else {
    card.appendChild(_iconEl(mediaType));
    card.appendChild(_label());
  }

  return card;
}

function _iconEl(type) {
  const d = document.createElement('div');
  d.className = 'media-card-icon';
  d.innerHTML = MEDIA_ICON[type] || MEDIA_ICON.generic;
  return d;
}

function _label() {
  const l = document.createElement('span');
  l.className = 'media-card-label';
  l.textContent = 'no media';
  return l;
}

/* ── Text utilities ────────────────────────────────────────── */

function _linkify(html) {
  return html.replace(/(https?:\/\/[^\s<>"']+)/gi, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

function _escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function _highlightText(html, query) {
  if (!query) return html;
  const re = new RegExp(`(${_escapeRegex(query)})`, 'gi');
  return html.replace(re, '<mark class="search-highlight">$1</mark>');
}
