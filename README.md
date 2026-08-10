# 📱 WhatsApp Chat Export Visualizer

A lightning-fast, privacy-first web application that transforms plain text `.txt` WhatsApp chat exports into a pixel-perfect, interactive, and highly performant WhatsApp UI. 

Built from the ground up using **Vite, Vanilla JavaScript, and Vanilla CSS**, this tool is engineered to handle massive chat histories—easily parsing and rendering exports with over **1,000,000+ messages**—entirely in your browser.

---

## 🔒 The Privacy-First Promise (Zero-Server Architecture)
Your chat logs contain highly sensitive personal information. Traditional chat viewers often require you to upload your `.txt` files to a backend server. 

This application operates on a **100% Zero-Server Privacy Model**:
- **No Backend**: There is no Node.js backend, no database, and no API endpoints.
- **Local Browser Execution**: When you drag and drop a file, the HTML5 `FileReader` API reads the text directly into your device's RAM. 
- **Offline Capable**: Once the website loads, you can disconnect your internet completely. The app will continue to parse, render, and search your chats flawlessly.

---

## 🚀 Core Technologies & Engineering Feats

To render one million messages without crashing the browser, this application relies on three distinct engineering pillars: **Non-blocking Parsing**, **Virtual Scrolling**, and **Data-Model Searching**.

### 1. The Parsing Engine (`worker.js` & `parser.js`)
Reading and string-processing a 50MB+ text file on the browser's main thread would cause the entire UI to freeze ("Page Unresponsive" error). We bypass this using a **Web Worker**.

* **Off-Thread Processing**: The raw text string is transferred to a background Web Worker. The main UI remains buttery smooth, displaying a real-time progress bar.
* **Regex Optimization & Edge Cases**: 
  WhatsApp exports vary wildly based on the OS (iOS vs Android) and regional settings (12h vs 24h clocks). The parser's Regular Expressions (`TS_RE`) dynamically identify:
  - Format A (iOS): `[DD/MM/YY, HH:MM:SS AM/PM] Sender: Message`
  - Format B (Android 12h): `DD/MM/YY, HH:MM am/pm - Sender: Message`
  - Format C (Android 24h): `DD/MM/YYYY, HH:MM - Sender: Message`
* **System Event Detection**: Differentiates between actual messages and system events (e.g., *"Messages and calls are end-to-end encrypted"* or *"Alice changed the group icon"*).
* **Media Omission Mapping**: WhatsApp `.txt` exports strip out actual images/audio and replace them with text like `<media omitted>` or `image (file attached)`. The parser uses `MEDIA_PATTERNS` to detect 20+ variations of these strings, categorizing them into `audio`, `video`, `sticker`, `document`, or `contact`.
* **Timestamp Optimization**: To save memory, parsed Dates are not stored as heavy JavaScript `Date` objects. They are converted immediately into lightweight **Unix Epoch Integers** (Numbers). This prevents the garbage collector from choking on 1,000,000 Date objects.

### 2. The DOM Rendering Engine (`virtual-scroller.js`)
If you ask a browser to draw 1,000,000 HTML `<div>` elements, it will crash. 

We solve this using a custom-built **Virtual Scroller**. No matter how large your chat is, the browser only ever draws about **~80 DOM elements**.

* **Binary-Search Offsets**: Before anything is drawn on screen, the app estimates the pixel height of every single message based on its character count and media type. It builds an array of cumulative height offsets. When you scroll, it uses a highly efficient Binary Search algorithm (`O(log n)`) to instantly calculate exactly which message should be visible at your current pixel scroll position.
* **Element Recycling (Overscan)**: As you scroll down, the message bubbles that disappear off the top of the screen are not deleted. They are recycled, moved to the bottom of the screen, and instantly populated with the text of the next message.
* **Render-Time Injection**: Things like "Sender Name Headers", "Chat Tails" (the little triangle on the side of a bubble), and "Date Separator Chips" (e.g., *Today*, *Yesterday*) are calculated dynamically during the render cycle.

### 3. The Search Engine (`main.js`)
Standard browser search (`Ctrl+F`) fails in virtual scrolling because the text isn't actually in the HTML DOM—it's held in memory.
* **Data-Model Searching**: Our custom search engine scans the raw JavaScript array in memory. It maps out the index of every "hit".
* **Jump Navigation**: When you click "Next", it looks up the index, finds the exact pixel height offset of that message via the Virtual Scroller, and instantly jumps the scrollbar to that position.
* **Regex Highlighting**: It injects `<mark class="search-highlight">` tags into the HTML string just milliseconds before it hits the screen.

---

## 🎨 UI, UX & Design System

The visual layer is built to look identical to native WhatsApp, powered by a robust CSS Variable architecture (`src/styles/index.css`).

### Dark & Light Mode
- Controlled via `data-theme="dark"` on the root `<html>` tag.
- Swaps out over 30+ CSS color tokens (backgrounds, bubble colors, text colors) instantly.

### Dynamic Sender Colors (`utils.js`)
In group chats, each sender gets a unique color. 
- The app takes the sender's string name (e.g., "John Doe"), converts the characters into a hash code, and maps it to an array of 16 carefully curated, highly legible colors. 
- This ensures "John Doe" is always assigned the exact same color, regardless of what chat you open.

### The "Sender Assignment" Modal
Because a `.txt` file does not tell us who *you* are and who your *friend* is, the app presents a clean Modal upon upload. It lists all participants and asks you to select yourself. 
- The selected user's messages are styled as `outgoing` (green bubble, right-aligned, double blue ticks).
- Everyone else is styled as `incoming` (white/gray bubble, left-aligned).

### Missing Media Cards
Instead of showing ugly text that says `<media omitted>`, the app renders beautiful, WhatsApp-accurate UI cards:
- **Audio**: Renders a microphone icon with a mock audio waveform.
- **Video/Image**: Renders a placeholder card with standard camera/play icons.
- **Stickers & GIFs**: Renders distinct sizing and icons for sticker omits.

---

## 📂 Project Directory Structure

```text
/
├── index.html                # The main application shell
├── package.json              # NPM dependencies (Vite)
├── vite.config.js            # Vite bundler configuration
│
├── public/
│   └── favicon.svg           # Browser tab icon
│
└── src/
    ├── main.js               # App Orchestrator (Events, Search, UI state)
    ├── parser.js             # String manipulation & regex logic
    ├── renderer.js           # HTML DOM string generators (Bubbles, Headers)
    ├── utils.js              # Helpers (Color hashing, Date formatting)
    ├── virtual-scroller.js   # The high-performance virtual DOM engine
    ├── worker.js             # Web Worker wrapper for background processing
    │
    ├── assets/
    │   └── wallpaper.svg     # The classic WhatsApp doodle background pattern
    │
    └── styles/               # Component-based Vanilla CSS
        ├── animations.css    # Fade-ins, pop-ups, spin loaders
        ├── chat.css          # Bubble layouts, tails, system messages
        ├── header.css        # Top app-bar navigation
        ├── index.css         # CSS Variables (Colors, Fonts, Spacing)
        ├── landing.css       # Drag & Drop upload zone UI
        ├── media-card.css    # Styling for missing media placeholders
        ├── modal.css         # Sender selection popup UI
        └── search.css        # Search bar and highlight styling
```

---

## 💻 Developer Setup & Running Locally

1. **Prerequisites**: Ensure you have [Node.js](https://nodejs.org/) installed on your machine.
2. **Install Packages**:
   Navigate to the project directory in your terminal and run:
   ```bash
   npm install
   ```
3. **Start the Dev Server**:
   ```bash
   npm run dev
   ```
4. **View**: Open the `localhost` URL provided in the terminal (usually `http://localhost:5173`).
5. **Test**: Export a chat from WhatsApp (Without Media), and drag the `.txt` file directly into the browser window.

---
*Developed with a strict focus on front-end performance, algorithm efficiency, and user privacy.*
