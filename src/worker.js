/**
 * worker.js — Web Worker for off-main-thread chat parsing
 *
 * Keeps the UI responsive while parsing multi-MB files with 1M+ messages.
 */
import { parseChat } from './parser.js';

self.onmessage = (e) => {
  const { rawText } = e.data;
  try {
    self.postMessage({ type: 'progress', percent: 5, stage: 'Cleaning text…' });
    const result = parseChat(rawText, (percent, stage) => {
      self.postMessage({ type: 'progress', percent, stage });
    });
    self.postMessage({ type: 'complete', data: result });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message });
  }
};
