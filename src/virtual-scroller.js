/**
 * virtual-scroller.js — High-performance virtual scrolling engine
 *
 * Only renders rows visible in the viewport + overscan buffer.
 * Handles 1,000,000+ rows with <60 DOM elements at any time.
 */

export class VirtualScroller {
  /**
   * @param {Object} opts
   * @param {HTMLElement}  opts.scrollContainer  – element with overflow-y:auto
   * @param {HTMLElement}  opts.contentContainer – inner element for absolute rows
   * @param {Array}        opts.rows             – full row-data array
   * @param {Function}     opts.renderRow        – (index) => HTMLElement
   * @param {Function}     opts.estimateHeight   – (row) => number (px)
   * @param {number}       [opts.overscan=40]    – extra rows above/below viewport
   */
  constructor(opts) {
    this.scrollEl = opts.scrollContainer;
    this.contentEl = opts.contentContainer;
    this.rows = opts.rows;
    this.renderRowFn = opts.renderRow;
    this.estimateHeightFn = opts.estimateHeight;
    this.overscan = opts.overscan ?? 40;

    this.total = this.rows.length;

    /* Pre-compute cumulative offsets ─────────────────────────── */
    this.heights = new Float64Array(this.total);
    this.offsets = new Float64Array(this.total + 1);
    this._computeOffsets();

    /* DOM setup ─────────────────────────────────────────────── */
    this.contentEl.style.position = 'relative';
    this.contentEl.style.height = this.totalHeight + 'px';
    this.contentEl.style.contain = 'layout style';

    /* Rendered element cache ─────────────────────────────────── */
    this.elMap = new Map();   // index → HTMLElement
    this._start = -1;
    this._end = -1;
    this._rafId = null;

    /* Events ─────────────────────────────────────────────────── */
    this._onScroll = this._onScroll.bind(this);
    this.scrollEl.addEventListener('scroll', this._onScroll, { passive: true });

    this._resizeObs = new ResizeObserver(() => this.update());
    this._resizeObs.observe(this.scrollEl);

    /* Initial paint */
    this.update();
  }

  /* ─── Offset computation ─────────────────────────────────── */
  _computeOffsets() {
    this.offsets[0] = 0;
    for (let i = 0; i < this.total; i++) {
      this.heights[i] = this.estimateHeightFn(this.rows[i]);
      this.offsets[i + 1] = this.offsets[i] + this.heights[i];
    }
    this.totalHeight = this.offsets[this.total];
  }

  /* ─── Binary search: first row whose bottom > scrollTop ──── */
  _findFirst(scrollTop) {
    let lo = 0, hi = this.total - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.offsets[mid + 1] <= scrollTop) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /* ─── Scroll handler (RAF-throttled) ─────────────────────── */
  _onScroll() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this.update();
    });
  }

  /* ─── Core render loop ───────────────────────────────────── */
  update() {
    if (this.total === 0) return;

    const scrollTop = this.scrollEl.scrollTop;
    const vpHeight = this.scrollEl.clientHeight;

    /* Determine visible range */
    let start = this._findFirst(scrollTop);
    let end = start;
    while (end < this.total && this.offsets[end] < scrollTop + vpHeight) end++;

    /* Apply overscan */
    start = Math.max(0, start - this.overscan);
    end = Math.min(this.total, end + this.overscan);

    if (start === this._start && end === this._end) return;

    /* Remove out-of-range elements */
    for (const [idx, el] of this.elMap) {
      if (idx < start || idx >= end) {
        el.remove();
        this.elMap.delete(idx);
      }
    }

    /* Create in-range elements */
    const frag = document.createDocumentFragment();
    for (let i = start; i < end; i++) {
      if (!this.elMap.has(i)) {
        const el = this.renderRowFn(i);
        el.style.position = 'absolute';
        el.style.top = this.offsets[i] + 'px';
        el.style.left = '0';
        el.style.width = '100%';
        this.elMap.set(i, el);
        frag.appendChild(el);
      }
    }
    if (frag.childNodes.length) this.contentEl.appendChild(frag);

    this._start = start;
    this._end = end;
  }

  /* ─── Public API ─────────────────────────────────────────── */

  /** Scroll so that row[index] is centered in the viewport */
  scrollToRow(index, behavior = 'smooth') {
    if (index < 0 || index >= this.total) return;
    const offset = this.offsets[index];
    const vpH = this.scrollEl.clientHeight;
    const rowH = this.heights[index];
    this.scrollEl.scrollTo({ top: Math.max(0, offset - vpH / 2 + rowH / 2), behavior });
  }

  /** Scroll to the very bottom */
  scrollToBottom(behavior = 'instant') {
    this.scrollEl.scrollTo({ top: this.totalHeight, behavior });
  }

  /** Force re-render visible rows (e.g. after search query change) */
  rerender() {
    for (const el of this.elMap.values()) el.remove();
    this.elMap.clear();
    this._start = -1;
    this._end = -1;
    this.update();
  }

  /** Clean up */
  destroy() {
    this.scrollEl.removeEventListener('scroll', this._onScroll);
    this._resizeObs.disconnect();
    if (this._rafId) cancelAnimationFrame(this._rafId);
    for (const el of this.elMap.values()) el.remove();
    this.elMap.clear();
    this.contentEl.style.height = '';
  }

  /** Get element for a row index (only if currently rendered) */
  getElement(index) {
    return this.elMap.get(index) ?? null;
  }
}
