/**
 * parser.js — WhatsApp Chat Export Parser Engine (v2 — optimized for 1M+ messages)
 *
 * Supports:
 *   Format A (iOS 12h/24h):  [DD/MM/YY, HH:MM:SS AM/PM] Sender: Message
 *   Format B (Android 12h):  DD/MM/YY, HH:MM am/pm - Sender: Message
 *   Format C (Android 24h):  DD/MM/YYYY, HH:MM - Sender: Message
 *   Format D (System events): Timestamped lines without "Sender: " pattern
 */

/* ─── Media-omission keyword patterns (case-insensitive) ─── */
const MEDIA_PATTERNS = [
  { re: /<media omitted>/i,              t: 'generic'  },
  { re: /image omitted/i,               t: 'image'    },
  { re: /video omitted/i,               t: 'video'    },
  { re: /audio omitted/i,               t: 'audio'    },
  { re: /sticker omitted/i,             t: 'sticker'  },
  { re: /gif omitted/i,                 t: 'gif'      },
  { re: /document omitted/i,            t: 'document' },
  { re: /contact card omitted/i,        t: 'contact'  },
  { re: /<attached:\s*.*?>/i,           t: 'generic'  },
  { re: /\.jpe?g\s*\(file attached\)/i, t: 'image'    },
  { re: /\.png\s*\(file attached\)/i,   t: 'image'    },
  { re: /\.mp4\s*\(file attached\)/i,   t: 'video'    },
  { re: /\.3gp\s*\(file attached\)/i,   t: 'video'    },
  { re: /\.opus\s*\(file attached\)/i,  t: 'audio'    },
  { re: /\.mp3\s*\(file attached\)/i,   t: 'audio'    },
  { re: /\.m4a\s*\(file attached\)/i,   t: 'audio'    },
  { re: /\.pdf\s*\(file attached\)/i,   t: 'document' },
  { re: /\.docx?\s*\(file attached\)/i, t: 'document' },
  { re: /\.webp\s*\(file attached\)/i,  t: 'sticker'  },
  { re: /\.vcf\s*\(file attached\)/i,   t: 'contact'  },
  { re: /\(file attached\)/i,           t: 'document' },
];

/* ─── System event substrings ──────────────────────────────── */
const SYSTEM_KEYWORDS = [
  'messages and calls are end-to-end encrypted',
  'created group', 'changed the subject', 'changed this group',
  'changed the group', 'was added', 'added you', 'removed you',
  'left', 'joined using this group', 'changed their phone number',
  'deleted this message', 'message was deleted',
  'you deleted this message', 'this message was deleted',
  'missed voice call', 'missed video call',
  'security code changed', 'disappearing messages',
  'turned on disappearing', 'turned off disappearing',
  'pinned a message', 'your security code',
  'you\'re now an admin', 'waiting for this message',
  'you were removed', 'you were added',
  'changed the description', 'changed this group\'s icon',
];

/* ─── Timestamp regex ──────────────────────────────────────── */
const TS_RE = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]?\s[-–]?\s?(.*)$/;

/* ─── Strip invisible Unicode chars WhatsApp injects ───────── */
function cleanLine(s) {
  // fast path — avoid regex when possible
  if (s.charCodeAt(0) < 128 && s.indexOf('\u200e') === -1) return s;
  return s.replace(/[\u200e\u200f\u202a-\u202e\u2069\u200b\u00a0\uFEFF]/g, '');
}

/* ─── Parse "DD/MM/YY" or "DD/MM/YYYY" + time into Date ──── */
function parseDateTime(dateStr, timeStr) {
  const dp = dateStr.split('/');
  if (dp.length !== 3) return null;

  let day  = +dp[0];
  let mon  = +dp[1] - 1;
  let year = +dp[2];
  if (year < 100) year += year > 50 ? 1900 : 2000;

  let t = timeStr.trim();
  const pm = /pm$/i.test(t);
  const am = /am$/i.test(t);
  t = t.replace(/\s?[AaPp][Mm]$/g, '');
  const tp = t.split(':');
  let h = +tp[0], m = +tp[1], s = tp[2] ? +tp[2] : 0;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;

  const d = new Date(year, mon, day, h, m, s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

/* ─── Detect media omission ────────────────────────────────── */
function detectMedia(text) {
  for (const p of MEDIA_PATTERNS) {
    if (p.re.test(text)) return p.t;
  }
  return null;
}

/* ─── Check if line is a system event ─────────────────────── */
function isSystemText(text) {
  const low = text.toLowerCase();
  for (const kw of SYSTEM_KEYWORDS) {
    if (low.includes(kw)) return true;
  }
  return false;
}

/**
 * Main parse function.
 *
 * @param {string} rawText – raw .txt file content
 * @param {Function} [onProgress] – (percent:number, stage:string) => void
 * @returns {{ messages: object[], senders: string[], isGroup: boolean }}
 */
export function parseChat(rawText, onProgress) {
  /* ── Step 1: Normalise line endings & strip BOM ─────────── */
  let text = rawText;
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);       // BOM

  const lines = text.split(/\r?\n/);
  const lineCount = lines.length;

  if (onProgress) onProgress(10, 'Scanning messages…');

  /* ── Step 2: Iterate lines, join multi-line, classify ────── */
  const messages = [];
  const senderSet = new Set();
  let cur = null;                     // current message being assembled
  let id = 0;
  const progressInterval = Math.max(1, Math.floor(lineCount / 20));  // report ~20 times

  for (let i = 0; i < lineCount; i++) {
    /* progress callback */
    if (onProgress && i % progressInterval === 0) {
      onProgress(10 + Math.floor((i / lineCount) * 80), 'Scanning messages…');
    }

    const raw = lines[i];
    if (raw.length === 0) {
      // Preserve blank lines inside multi-line messages
      if (cur && cur.type !== 'system') cur.text += '\n';
      continue;
    }

    const line = cleanLine(raw);
    const m = TS_RE.exec(line);

    if (m) {
      /* ── This line starts a new timestamped entry ──────── */
      // Flush previous message
      if (cur) {
        cur.text = cur.text.trimEnd();
        messages.push(cur);
      }

      const ts = parseDateTime(m[1], m[2]);
      const rest = m[3];

      // Try "Sender: Message" split at the FIRST colon
      const colon = rest.indexOf(': ');

      if (colon > 0 && !isSystemText(rest)) {
        const sender  = rest.substring(0, colon).trim();
        const msgText = rest.substring(colon + 2);

        if (sender.length > 0 && sender.length <= 120) {
          senderSet.add(sender);
          const mt = detectMedia(msgText);
          cur = {
            id: id++,
            timestamp: ts,
            sender,
            text: msgText,
            type: mt ? 'media-omitted' : 'text',
            mediaType: mt || undefined,
            isOutgoing: false,
          };
          continue;
        }
      }

      // No valid sender split → system message
      cur = {
        id: id++,
        timestamp: ts,
        sender: null,
        text: rest,
        type: 'system',
        isOutgoing: false,
      };
    } else {
      /* ── Continuation of the previous message ──────────── */
      if (cur) {
        cur.text += '\n' + line;
      }
      // Orphan lines (before any timestamp) are silently skipped
    }
  }

  // Flush final message
  if (cur) {
    cur.text = cur.text.trimEnd();
    messages.push(cur);
  }

  if (onProgress) onProgress(95, 'Finalising…');

  const senders = Array.from(senderSet);
  const isGroup = senders.length > 2;

  if (onProgress) onProgress(100, 'Done');
  return { messages, senders, isGroup };
}

/**
 * Mark outgoing messages based on the selected sender name.
 */
export function markOutgoing(messages, myName) {
  for (let i = 0, len = messages.length; i < len; i++) {
    messages[i].isOutgoing = messages[i].sender === myName;
  }
}
