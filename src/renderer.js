/**
 * renderer.js — DOM Rendering Engine
 *
 * Transforms parsed chat data into WhatsApp-like DOM elements.
 */

import {
  getSenderColor,
  resetSenderColors,
  getInitials,
  formatTime,
  formatDateSeparator,
  getDateKey,
  isEmojiOnly,
  processMessageText,
  escapeHtml,
} from './utils.js';

/* ================================================================
   SVG Icons (inline for zero-dependency)
   ================================================================ */

const TICK_SVG = `<svg viewBox="0 0 16 11"><path d="M11.07 0.73l-7 7-2.78-2.78-1.22 1.22 4 4 8.22-8.22z" fill="currentColor"/></svg>`;

const DOUBLE_TICK_SVG = `<svg viewBox="0 0 16 11"><path d="M11.07 0.73l-7 7-2.78-2.78-1.22 1.22 4 4 8.22-8.22z" fill="currentColor"/><path d="M15.07 0.73l-7 7-1.28-1.28-1.22 1.22 2.5 2.5 8.22-8.22z" fill="currentColor"/></svg>`;

const MEDIA_ICONS = {
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
  sticker: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
  gif: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><text x="12" y="15" text-anchor="middle" font-size="7" font-weight="bold" fill="currentColor" stroke="none">GIF</text></svg>`,
  contact: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  generic: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="3" x2="21" y2="21"/><line x1="21" y1="3" x2="3" y2="21"/></svg>`,
};

/* ================================================================
   Render Functions
   ================================================================ */

/**
 * Render the chat header with contact/group info.
 */
export function renderChatHeader(data, myName) {
  const headerAvatar = document.getElementById('header-avatar');
  const headerName = document.getElementById('header-name');
  const headerStatus = document.getElementById('header-status');

  if (data.isGroup) {
    // Group chat — use group-like name
    const groupName = data.senders.length + ' participants';
    headerAvatar.textContent = '👥';
    headerName.textContent = data.senders.filter(s => s !== myName).join(', ');
    headerStatus.textContent = `${data.senders.length} participants`;
  } else {
    // 1-on-1 chat — show the other person's name
    const otherSender = data.senders.find(s => s !== myName) || data.senders[0];
    headerAvatar.textContent = getInitials(otherSender);
    headerName.textContent = otherSender;
    headerStatus.textContent = `${data.messages.length} messages`;
  }
}

/**
 * Render all messages into the messages container.
 * Uses document fragment for performance.
 */
export function renderMessages(messages, isGroup) {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';

  resetSenderColors();

  const fragment = document.createDocumentFragment();
  let lastDateKey = '';
  let lastSender = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const dateKey = getDateKey(msg.timestamp);

    // Insert date separator if day changed
    if (dateKey !== lastDateKey) {
      fragment.appendChild(createDateSeparator(msg.timestamp));
      lastDateKey = dateKey;
      lastSender = null; // Reset tail after date separator
    }

    if (msg.type === 'system') {
      fragment.appendChild(createSystemMessage(msg));
      lastSender = null;
    } else {
      const isNewSender = msg.sender !== lastSender;
      const hasTail = isNewSender;

      fragment.appendChild(createMessageRow(msg, isGroup, hasTail, isNewSender));
      lastSender = msg.sender;
    }
  }

  container.appendChild(fragment);
}

/**
 * Create a message row element.
 */
function createMessageRow(msg, isGroup, hasTail, isNewSender) {
  const row = document.createElement('div');
  row.className = 'message-row';
  row.classList.add(msg.isOutgoing ? 'outgoing' : 'incoming');
  if (hasTail) row.classList.add('has-tail');
  if (isNewSender) row.classList.add('new-sender');
  row.dataset.messageId = msg.id;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  // Sender name (group chats only, on first message of a sequence)
  if (isGroup && !msg.isOutgoing && hasTail && msg.sender) {
    const senderEl = document.createElement('span');
    senderEl.className = 'sender-name';
    senderEl.textContent = msg.sender;
    senderEl.style.color = getSenderColor(msg.sender);
    bubble.appendChild(senderEl);
  }

  // Message content
  if (msg.type === 'media-omitted') {
    bubble.appendChild(createMediaCard(msg));
  }

  // Text content (even media messages might have additional text)
  if (msg.type === 'text' || (msg.type === 'media-omitted' && hasExtraText(msg))) {
    const textEl = document.createElement('span');
    textEl.className = 'message-text';

    if (msg.type === 'text' && isEmojiOnly(msg.text)) {
      textEl.classList.add('emoji-only');
      textEl.textContent = msg.text;
    } else if (msg.type === 'text') {
      textEl.innerHTML = processMessageText(msg.text);
    }

    bubble.appendChild(textEl);
  }

  // Meta: timestamp + ticks
  const meta = document.createElement('span');
  meta.className = 'message-meta';

  const timeSpan = document.createElement('span');
  timeSpan.textContent = formatTime(msg.timestamp);
  meta.appendChild(timeSpan);

  // Read receipt ticks (outgoing only)
  if (msg.isOutgoing) {
    const tickEl = document.createElement('span');
    tickEl.className = 'tick-icon read';
    tickEl.innerHTML = DOUBLE_TICK_SVG;
    meta.appendChild(tickEl);
  }

  bubble.appendChild(meta);
  row.appendChild(bubble);

  return row;
}

/**
 * Check if a media-omitted message has extra meaningful text
 * beyond the media indicator itself.
 */
function hasExtraText(msg) {
  // If the entire text IS the media indicator, no extra text
  return false;
}

/**
 * Create a "no media" placeholder card.
 */
function createMediaCard(msg) {
  const mediaType = msg.mediaType || 'generic';
  const card = document.createElement('div');
  card.className = `media-card media-${mediaType}`;

  if (mediaType === 'audio') {
    // Audio layout: icon + waveform
    const iconEl = document.createElement('div');
    iconEl.className = 'media-card-icon';
    iconEl.innerHTML = MEDIA_ICONS.audio;
    card.appendChild(iconEl);

    const waveform = document.createElement('div');
    waveform.className = 'media-card-waveform';
    // Generate fake waveform bars
    for (let i = 0; i < 20; i++) {
      const bar = document.createElement('div');
      bar.className = 'waveform-bar';
      bar.style.height = `${4 + Math.random() * 14}px`;
      waveform.appendChild(bar);
    }
    card.appendChild(waveform);

    const label = document.createElement('span');
    label.className = 'media-card-label';
    label.textContent = 'no media';
    card.appendChild(label);
  } else if (mediaType === 'document') {
    // Document layout: icon + info
    const iconEl = document.createElement('div');
    iconEl.className = 'media-card-icon';
    iconEl.innerHTML = MEDIA_ICONS.document;
    card.appendChild(iconEl);

    const info = document.createElement('div');
    info.className = 'media-card-doc-info';
    const docName = document.createElement('span');
    docName.className = 'media-card-doc-name';
    docName.textContent = 'no media';
    info.appendChild(docName);
    card.appendChild(info);
  } else if (mediaType === 'contact') {
    // Contact layout: icon + label
    const iconEl = document.createElement('div');
    iconEl.className = 'media-card-icon';
    iconEl.innerHTML = MEDIA_ICONS.contact;
    card.appendChild(iconEl);

    const label = document.createElement('span');
    label.className = 'media-card-label';
    label.textContent = 'no media';
    card.appendChild(label);
  } else {
    // Standard layout: icon on top, label below
    const iconEl = document.createElement('div');
    iconEl.className = 'media-card-icon';
    iconEl.innerHTML = MEDIA_ICONS[mediaType] || MEDIA_ICONS.generic;
    card.appendChild(iconEl);

    const label = document.createElement('span');
    label.className = 'media-card-label';
    label.textContent = 'no media';
    card.appendChild(label);
  }

  return card;
}

/**
 * Create a system message element (centered pill).
 */
function createSystemMessage(msg) {
  const el = document.createElement('div');
  el.className = 'system-message';
  el.textContent = msg.text;
  el.dataset.messageId = msg.id;
  return el;
}

/**
 * Create a date separator chip.
 */
function createDateSeparator(date) {
  const el = document.createElement('div');
  el.className = 'date-separator';
  el.textContent = formatDateSeparator(date);
  return el;
}

/**
 * Scroll the chat canvas to the bottom.
 */
export function scrollToBottom(smooth = true) {
  const canvas = document.getElementById('chat-canvas');
  if (canvas) {
    canvas.scrollTo({
      top: canvas.scrollHeight,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }
}
