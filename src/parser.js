/**
 * parser.js — WhatsApp Chat Export Parser Engine
 *
 * Supports:
 *   Format A (iOS 12h/24h):  [DD/MM/YY, HH:MM:SS AM/PM] Sender: Message
 *   Format B (Android 12h):  DD/MM/YY, HH:MM am/pm - Sender: Message
 *   Format C (Android 24h):  DD/MM/YYYY, HH:MM - Sender: Message
 *   Format D (System events): Timestamped lines without "Sender: " pattern
 */

/**
 * Media-omission keyword patterns (case-insensitive).
 */
const MEDIA_PATTERNS = [
  { regex: /<media omitted>/i, type: 'generic' },
  { regex: /image omitted/i, type: 'image' },
  { regex: /video omitted/i, type: 'video' },
  { regex: /audio omitted/i, type: 'audio' },
  { regex: /sticker omitted/i, type: 'sticker' },
  { regex: /gif omitted/i, type: 'gif' },
  { regex: /document omitted/i, type: 'document' },
  { regex: /contact card omitted/i, type: 'contact' },
  { regex: /<attached:\s*.*?>/i, type: 'generic' },
  { regex: /\(file attached\)/i, type: 'document' },
  { regex: /\.jpg\s*\(file attached\)/i, type: 'image' },
  { regex: /\.png\s*\(file attached\)/i, type: 'image' },
  { regex: /\.mp4\s*\(file attached\)/i, type: 'video' },
  { regex: /\.opus\s*\(file attached\)/i, type: 'audio' },
  { regex: /\.mp3\s*\(file attached\)/i, type: 'audio' },
  { regex: /\.pdf\s*\(file attached\)/i, type: 'document' },
  { regex: /\.webp\s*\(file attached\)/i, type: 'sticker' },
  { regex: /\.vcf\s*\(file attached\)/i, type: 'contact' },
];

/**
 * System message patterns (lines that match a timestamp but have no "Sender:" pattern).
 * These are common WhatsApp system event strings.
 */
const SYSTEM_KEYWORDS = [
  'messages and calls are end-to-end encrypted',
  'created group',
  'changed the subject',
  'changed this group',
  'changed the group',
  'was added',
  'added you',
  'removed',
  'left',
  'joined using this group',
  'changed their phone number',
  'deleted this message',
  'message was deleted',
  'you deleted this message',
  'this message was deleted',
  'missed voice call',
  'missed video call',
  'security code changed',
  'disappeared',
  'turned on disappearing',
  'turned off disappearing',
  'pinned a message',
  'your security code',
  'you\'re now an admin',
  'waiting for this message',
];

/**
 * Strip invisible Unicode characters WhatsApp inserts.
 */
function cleanUnicode(text) {
  return text.replace(/[\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2069\u200b\u00a0]/g, '');
}

/**
 * Unified timestamp regex — handles all 4 format signatures.
 *
 * Captures:
 *   Group 1: Full date string  (e.g. "25/12/23" or "25/12/2023")
 *   Group 2: Full time string  (e.g. "14:05" or "2:05:30 PM")
 *   Group 3: Rest of the line after the separator
 */
const TIMESTAMP_REGEX = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]?\s[-–]?\s?(.*)$/;

/**
 * Parse a date string like "DD/MM/YY" or "DD/MM/YYYY" and a time string
 * into a JavaScript Date object.
 */
function parseDateTime(dateStr, timeStr) {
  // Parse date parts
  const dateParts = dateStr.split('/');
  if (dateParts.length !== 3) return new Date(NaN);

  let day = parseInt(dateParts[0], 10);
  let month = parseInt(dateParts[1], 10) - 1; // JS months are 0-indexed
  let year = parseInt(dateParts[2], 10);

  // Handle 2-digit year
  if (year < 100) {
    year += year > 50 ? 1900 : 2000;
  }

  // Parse time parts
  let cleanTime = timeStr.trim();
  let isPM = /pm/i.test(cleanTime);
  let isAM = /am/i.test(cleanTime);
  cleanTime = cleanTime.replace(/\s?[AaPp][Mm]/g, '').trim();

  const timeParts = cleanTime.split(':');
  let hours = parseInt(timeParts[0], 10);
  const minutes = parseInt(timeParts[1], 10);
  const seconds = timeParts[2] ? parseInt(timeParts[2], 10) : 0;

  // Apply AM/PM
  if (isPM && hours < 12) hours += 12;
  if (isAM && hours === 12) hours = 0;

  return new Date(year, month, day, hours, minutes, seconds);
}

/**
 * Detect if a message body is a media-omission indicator.
 * Returns { isMedia: true, mediaType: string } or { isMedia: false }.
 */
function detectMedia(text) {
  const trimmed = text.trim();
  for (const pattern of MEDIA_PATTERNS) {
    if (pattern.regex.test(trimmed)) {
      return { isMedia: true, mediaType: pattern.type };
    }
  }
  return { isMedia: false };
}

/**
 * Check if remainder text looks like a system message (no "sender: message" pattern).
 */
function isSystemLine(remainder) {
  // If it contains "Sender: Message" pattern, it's NOT a system message
  if (/^.+?:\s/.test(remainder)) {
    // But double-check — the "sender" part shouldn't match system keywords
    const potentialSender = remainder.split(':')[0].trim().toLowerCase();
    const isSystemSender = SYSTEM_KEYWORDS.some(kw => potentialSender.includes(kw));
    if (!isSystemSender) return false;
  }
  // Lines that match known system keywords
  const lower = remainder.toLowerCase();
  return SYSTEM_KEYWORDS.some(kw => lower.includes(kw));
}

/**
 * Split "Sender: Message" from the remainder text.
 * Returns { sender, message } or null if no valid split found.
 */
function splitSenderMessage(remainder) {
  // Find the first colon that separates sender from message
  const colonIndex = remainder.indexOf(':');
  if (colonIndex <= 0) return null;

  const sender = remainder.substring(0, colonIndex).trim();
  const message = remainder.substring(colonIndex + 1).trim();

  // Sender name shouldn't be empty or absurdly long
  if (!sender || sender.length > 100) return null;

  return { sender, message };
}

/**
 * Main parse function.
 *
 * @param {string} rawText - The raw content of the WhatsApp export .txt file.
 * @returns {{ messages: Array, senders: string[], isGroup: boolean }}
 */
export function parseChat(rawText) {
  // Clean unicode artifacts
  const cleaned = cleanUnicode(rawText);

  // Split into lines
  const lines = cleaned.split('\n');

  const messages = [];
  const senderSet = new Set();
  let currentMessage = null;
  let messageId = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip empty lines
    if (!line.trim()) {
      if (currentMessage && currentMessage.type !== 'system') {
        currentMessage.text += '\n';
      }
      continue;
    }

    const match = line.match(TIMESTAMP_REGEX);

    if (match) {
      // This line starts a new message (has a timestamp)
      // Save the previous message first
      if (currentMessage) {
        currentMessage.text = currentMessage.text.trim();
        messages.push(currentMessage);
      }

      const dateStr = match[1];
      const timeStr = match[2];
      const remainder = match[3];
      const timestamp = parseDateTime(dateStr, timeStr);

      // Check if it's a system message
      if (isSystemLine(remainder)) {
        currentMessage = {
          id: messageId++,
          timestamp,
          sender: null,
          text: remainder,
          type: 'system',
          isOutgoing: false,
        };
      } else {
        // Try to split into sender + message
        const split = splitSenderMessage(remainder);

        if (split) {
          const { sender, message } = split;
          senderSet.add(sender);

          // Check for media omission
          const mediaCheck = detectMedia(message);

          currentMessage = {
            id: messageId++,
            timestamp,
            sender,
            text: message,
            type: mediaCheck.isMedia ? 'media-omitted' : 'text',
            mediaType: mediaCheck.isMedia ? mediaCheck.mediaType : undefined,
            isOutgoing: false, // Will be set after sender selection
          };
        } else {
          // No valid sender:message split — treat as system
          currentMessage = {
            id: messageId++,
            timestamp,
            sender: null,
            text: remainder,
            type: 'system',
            isOutgoing: false,
          };
        }
      }
    } else {
      // This line is a continuation of the previous message
      if (currentMessage) {
        currentMessage.text += '\n' + line;
        // Re-check for media in case the full text now matches
      }
      // If no current message exists, skip orphan lines
    }
  }

  // Don't forget the last message
  if (currentMessage) {
    currentMessage.text = currentMessage.text.trim();
    messages.push(currentMessage);
  }

  const senders = Array.from(senderSet);
  const isGroup = senders.length > 2;

  return { messages, senders, isGroup };
}

/**
 * Mark outgoing messages based on the selected sender name.
 */
export function markOutgoing(messages, myName) {
  for (const msg of messages) {
    msg.isOutgoing = msg.sender === myName;
  }
  return messages;
}
