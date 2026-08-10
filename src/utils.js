/**
 * utils.js — Helper functions
 */

/**
 * Deterministic color palette for sender names in group chats.
 * WhatsApp uses a fixed set of name colors.
 */
const SENDER_COLORS = [
  '#1FA855', '#E06C75', '#D19A66', '#C678DD', '#56B6C2',
  '#E5C07B', '#61AFEF', '#BE5046', '#98C379', '#C8AE9D',
  '#E06C75', '#7EC8E3', '#C49B5F', '#A377BF', '#6DB3A8',
];

const senderColorMap = new Map();

/**
 * Get a consistent color for a sender name.
 */
export function getSenderColor(senderName) {
  if (senderColorMap.has(senderName)) {
    return senderColorMap.get(senderName);
  }
  const index = senderColorMap.size % SENDER_COLORS.length;
  const color = SENDER_COLORS[index];
  senderColorMap.set(senderName, color);
  return color;
}

/**
 * Reset sender colors (for loading new chats).
 */
export function resetSenderColors() {
  senderColorMap.clear();
}

/**
 * Get initials from a name (first letter of first two words).
 */
export function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Format a timestamp (number) into a short time string (HH:MM am/pm).
 */
export function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  let hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

/**
 * Format a timestamp into a human-readable date string for date separator chips.
 */
export function formatDateSeparator(ts) {
  if (!ts) return '';
  const date = new Date(ts);

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today - target) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  const options = { day: 'numeric', month: 'long', year: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Get a date key string for grouping messages by day (YYYY-MM-DD).
 */
export function getDateKey(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}`;
}

/**
 * Check if a string contains only emoji characters.
 * Returns true for 1-3 emoji with optional whitespace.
 */
export function isEmojiOnly(text) {
  if (!text || text.length > 50) return false;
  const stripped = text.replace(/\s/g, '');
  if (stripped.length === 0 || stripped.length > 40) return false;
  // Match emoji sequences (including ZWJ sequences, skin tone modifiers, etc.)
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}?|\p{Emoji}(?:\u200D\p{Emoji})*)+$/u;
  return emojiRegex.test(stripped) && [...stripped].length <= 8;
}

/**
 * Escape HTML special characters to prevent XSS.
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Convert URLs in text to clickable anchor tags.
 */
export function linkifyText(text) {
  const urlRegex = /(https?:\/\/[^\s<>"']+)/gi;
  return text.replace(urlRegex, (url) => {
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`;
  });
}

/**
 * Process message text: escape HTML, then linkify URLs.
 */
export function processMessageText(text) {
  return linkifyText(escapeHtml(text));
}

/**
 * Debounce function for search input.
 */
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
