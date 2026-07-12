import "./index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { MarkdownProcessor } from "./components/MarkdownProcessor";

// Interface for persistent application settings
interface AppSettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  speechLanguage: "auto" | "ar-SA" | "en-US";
  
  mirrorMode: "none" | "h" | "v" | "both";
  scrollSpeed: number;
  fontSize: number;
  fontWeight: "300" | "400" | "500" | "600" | "700";
  lineHeight: number;
  paragraphSpacing: number; // in rem
  theme: "zinc" | "coal" | "matrix" | "amber";
  focusMode: boolean;
  hideControls: boolean;
  autoScroll: boolean;
  controlMode: "auto" | "manual";
}

// Initial default settings
const DEFAULT_SETTINGS: AppSettings = {
  provider: "gemini",
  apiKey: "",
  baseUrl: "",
  model: "gemini-3.1-flash-lite",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: "You are an expert AI API-Response Architect. Your goal is to provide responses in a structured format that can be easily parsed and rendered by a frontend application. Whenever you provide an answer, you must analyze the nature of the data and format it into distinct, machine-readable blocks within the Markdown response. Rules: 1. Text: Standard prose in clean GitHub-flavored Markdown. 2. Table: Tabular data in standard markdown table syntax. 3. Diagrams: Explain processes/architecture using code blocks (mermaid, bpmn, dot). 4. Code: Fenced blocks with language tags.",
  speechLanguage: "auto",
  mirrorMode: "none",
  scrollSpeed: 15,
  fontSize: 42,
  fontWeight: "500",
  lineHeight: 1.6,
  paragraphSpacing: 2,
  theme: "zinc",
  focusMode: true,
  hideControls: false,
  autoScroll: false,
  controlMode: "auto",
};

// Default welcome script showcasing Markdown and Mermaid
const DEFAULT_SCRIPT = `# 🚀 Welcome to your AI Teleprompter

This is a **premium, high-performance** browser-based teleprompter built for professional presentation, recording, and public speaking.

Press the **Spacebar** or click **Play** at the top right to start auto-scrolling.

---

## 🎹 Keyboard Shortcuts

Use these direct hotkeys to manage your performance on the fly:

- **Space**: Toggle Play / Pause Auto-Scroll
- **Arrow Up / Down**: Increase / Decrease Scroll Speed
- **[ / ]**: Decrease / Increase Font Size
- **M**: Cycle Mirroring Modes (Normal ➔ H ➔ V ➔ Both)
- **F**: Toggle Fullscreen Mode
- **H**: Show / Hide Left Control Panel
- **Escape**: Exit Fullscreen or Reset

---

## 🎨 Rich Markdown & Media Support

Your scripts support full **Markdown** formatting. Emphasize key speaking points to direct your pacing and eye contact:
- Use **bold text** to indicate slide transitions or high-emphasis words.
- Use *italics* for tone shifts, pauses, or rhetorical questions.
- Create organized lists for key technical specs.

### 📊 Presentation Outline Table

| Segment | Duration | Focus Area |
| :--- | :---: | :--- |
| **01. Hook** | 1 Min | Grab audience attention with a strong question. |
| **02. Problem** | 2 Min | Detail the core issues presenters face daily. |
| **03. Solution** | 4 Min | Show off the auto-scroller and AI-generation. |

### 🧬 Dynamic Diagrams (Mermaid.js)

The diagrams render instantly after the generation finishes, providing high-fidelity visual context:

\`\`\`mermaid
graph LR
  A[Create Topic] -->|Stream AI| B(Review Script)
  B -->|Set Font & Speed| C(Mirror Text)
  C -->|Deliver Presentation| D[Perfect Speech]
\`\`\`

---

## 💡 Pro Tips

1. **Mirroring Modes**: Use Horizontal Mirroring (**Mirror H**) if you are using physical beam-splitter teleprompter glass. Only the script text flips; all menus and control buttons remain perfectly readable.
2. **Focus Reading Guide**: The dotted green lines in the center represent your visual guide. Adjust the speed so you read right along this lane.
3. **AI Generator**: Enter a topic in the **AI Script Builder** tab, configure your LLM, and watch your script stream in token-by-token!
`;

// App State
let settings: AppSettings = { ...DEFAULT_SETTINGS };
let currentScript: string = DEFAULT_SCRIPT;
let isGenerating: boolean = false;
let isLeftMouseDown: boolean = false;
let animationFrameId: number | null = null;
let lastTimestamp: number = 0;
let scrollAccumulator: number = 0;
let resizeTimeout: any = null;
let currentInterpolatedSpeed: number = DEFAULT_SETTINGS.scrollSpeed;

// Conversation History Management
let conversationHistory: string[] = [];

function addCompletedBlock(blockText: string) {
  const trimmed = blockText.trim();
  if (!trimmed) return;
  
  // To avoid duplicate adjacent blocks, check if the newest block is already the same
  if (conversationHistory.length > 0 && conversationHistory[0] === trimmed) {
    return;
  }
  
  conversationHistory.unshift(trimmed);
  
  // Keep only the latest 30 conversation blocks to prevent memory growth
  if (conversationHistory.length > 30) {
    conversationHistory = conversationHistory.slice(0, 30);
  }
  
  // Save history to localStorage
  try {
    localStorage.setItem("ai_prompter_history", JSON.stringify(conversationHistory));
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

function formatSpeedMultiplier(val: number): string {
  return (val / 15).toFixed(2) + "x";
}

// Initialize elements
const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

let lastSyncedAiSettingsStr: string = "";

// Load Settings from LocalStorage
function loadSettings() {
  try {
    const saved = localStorage.getItem("ai_prompter_settings");
    if (saved) {
      settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      // Reset autoscroll to false on reload
      settings.autoScroll = false;
    }
    const savedScript = localStorage.getItem("ai_prompter_script");
    if (savedScript) {
      currentScript = savedScript;
    }
    
    // Load conversation history
    const savedHistory = localStorage.getItem("ai_prompter_history");
    if (savedHistory) {
      try {
        conversationHistory = JSON.parse(savedHistory);
      } catch (e) {
        console.error("Failed to parse saved history:", e);
        conversationHistory = [];
      }
    } else if (savedScript && savedScript.trim()) {
      conversationHistory = [savedScript];
    }

    // Initialize lastSyncedAiSettingsStr to loaded state
    lastSyncedAiSettingsStr = JSON.stringify({
      provider: settings.provider,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      systemPrompt: settings.systemPrompt,
    });
  } catch (e) {
    console.error("Failed to load settings:", e);
  }
}

// Save Settings to LocalStorage and Sync to Backend
function saveSettings() {
  try {
    localStorage.setItem("ai_prompter_settings", JSON.stringify(settings));
    localStorage.setItem("ai_prompter_script", currentScript);

    // Sync AI-relevant settings immediately to backend asynchronously
    const aiSettingsPayload = {
      provider: settings.provider,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
      temperature: settings.temperature,
      maxTokens: settings.maxTokens,
      systemPrompt: settings.systemPrompt,
    };

    const currentAiSettingsStr = JSON.stringify(aiSettingsPayload);
    if (currentAiSettingsStr === lastSyncedAiSettingsStr) {
      // AI settings are unchanged, avoid duplicate network POST
      return;
    }

    lastSyncedAiSettingsStr = currentAiSettingsStr;

    fetch("/api/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: currentAiSettingsStr,
    }).catch((err) => {
      console.error("Failed to sync settings to server:", err);
      // Reset tracking on failure to retry next time
      lastSyncedAiSettingsStr = "";
    });
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// UI Elements markup injection
root.className = "h-screen w-screen flex flex-row overflow-hidden select-none bg-zinc-950 font-sans text-zinc-100";
root.innerHTML = `
  <!-- Collapsible Settings Panel (Left) -->
  <aside id="sidebar" class="w-80 md:w-96 flex flex-col border-r border-zinc-800 bg-zinc-900/90 backdrop-blur-md transition-all duration-300 fixed md:relative inset-y-0 left-0 z-50 md:z-30 flex-shrink-0">
    <!-- Drag Handle for Mobile Sheet -->
    <div class="md:hidden flex justify-center py-2.5 shrink-0 select-none">
      <div class="w-12 h-1 bg-zinc-700/80 rounded-full"></div>
    </div>
    <!-- Mobile Drawer Backdrop Overlay -->
    <div id="sidebar-backdrop" class="fixed inset-0 bg-black/60 z-40 hidden transition-opacity duration-300 opacity-0 pointer-events-none md:hidden"></div>
    <!-- Header -->
    <div class="p-5 md:p-6 border-b border-zinc-800 flex items-center justify-between shrink-0">
      <div class="flex items-center space-x-3">
        <div class="w-3 h-3 rounded-full bg-emerald-500 pulse-glow"></div>
        <h1 class="text-lg md:text-xl font-display font-bold tracking-tight text-white select-none">AI Teleprompter</h1>
      </div>
      <div class="flex items-center space-x-1">
        <!-- Close Button (Mobile Bottom Sheet Close) -->
        <button id="mobile-close-sidebar-btn" class="flex md:hidden items-center justify-center px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 rounded-full text-zinc-300 font-semibold text-xs transition-colors" title="Close Drawer">
          Done
        </button>
        <button id="collapse-btn-sidebar" class="hidden md:block p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors" title="Collapse Control Panel (Hotkey: H)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
    </div>

    <!-- Tabs Navigation -->
    <div class="flex border-b border-zinc-800 text-sm font-medium">
      <button id="tab-btn-script" class="flex-1 py-3 text-center border-b-2 border-emerald-500 text-emerald-400 transition-colors" data-tab="script">Active Script</button>
      <button id="tab-btn-config" class="flex-1 py-3 text-center border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors" data-tab="config">Prompter</button>
      <button id="tab-btn-ai" class="flex-1 py-3 text-center border-b-2 border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-colors" data-tab="ai">AI Engine</button>
    </div>

    <!-- Scrollable Tab Content Container -->
    <div class="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
      
      <!-- TAB 1: SCRIPT & GENERATION -->
      <div id="tab-content-script" class="space-y-5">
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Active Presentation Script</label>
          <p class="text-xs text-zinc-500">Edit your script directly below. Supports standard Markdown syntax.</p>
          <textarea id="script-textarea" class="w-full h-80 bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-sm font-mono text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors resize-none focus:ring-1 focus:ring-emerald-500" placeholder="Type or paste your script here..."></textarea>
        </div>

        <div class="border-t border-zinc-800 pt-5 space-y-4">
          <div class="space-y-1">
            <h3 class="text-sm font-semibold text-zinc-200">AI Script Builder</h3>
            <p class="text-xs text-zinc-500">Provide a topic/prompt to generate a customized, teleprompter-optimized script.</p>
          </div>
          
          <div class="space-y-3">
            <textarea id="ai-prompt-textarea" class="w-full h-24 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 transition-colors resize-none focus:ring-1 focus:ring-emerald-500" placeholder="e.g., A 5-minute keynote opening about the future of quantum computing..."></textarea>
            
            <button id="generate-script-btn" class="w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-medium text-sm py-2.5 px-4 rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950/20">
              <svg id="generate-icon" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span id="generate-btn-text">Generate Script Stream</span>
            </button>
          </div>
        </div>
      </div>

      <!-- TAB 2: PROMPTER DESIGN CONFIG -->
      <div id="tab-content-config" class="hidden space-y-6">
        <!-- Scrolling & Speed -->
        <div class="space-y-3 p-4 bg-zinc-950/40 rounded-xl border border-zinc-800/50">
          <div class="flex justify-between items-center">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Scroll Speed</label>
            <div class="flex items-center space-x-2">
              <span id="speed-badge" class="bg-zinc-800 text-emerald-400 text-xs font-mono font-bold px-2 py-0.5 rounded">1.00x</span>
              <button id="reset-speed-btn" class="text-zinc-400 hover:text-white text-[10px] font-semibold bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded transition-all" title="Reset to default (1.00x)">
                Reset
              </button>
            </div>
          </div>
          <div class="flex items-center space-x-2.5">
            <button id="decrease-speed-btn" class="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm select-none transition-colors animate-none focus:outline-none" title="Decrease Speed (Hotkey: Arrow Down)">
              &minus;
            </button>
            <input type="range" id="speed-slider" min="1" max="60" step="0.1" value="15" class="flex-1 accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none" />
            <button id="increase-speed-btn" class="w-8 h-8 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white flex items-center justify-center font-bold text-sm select-none transition-colors animate-none focus:outline-none" title="Increase Speed (Hotkey: Arrow Up)">
              &plus;
            </button>
          </div>
        </div>

        <!-- Font Size -->
        <div class="space-y-3">
          <div class="flex justify-between items-center">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Font Size</label>
            <span id="font-size-badge" class="bg-zinc-800 text-emerald-400 text-xs font-mono font-bold px-2 py-0.5 rounded">42px</span>
          </div>
          <input type="range" id="font-size-slider" min="20" max="110" value="42" class="w-full accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none" />
        </div>

        <!-- Font Weight -->
        <div class="space-y-3">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Font Weight</label>
          <div class="grid grid-cols-5 gap-1.5">
            <button class="weight-btn bg-zinc-800 hover:bg-zinc-700 py-1.5 rounded-lg text-xs font-light" data-weight="300">300</button>
            <button class="weight-btn bg-zinc-800 hover:bg-zinc-700 py-1.5 rounded-lg text-xs font-normal" data-weight="400">400</button>
            <button class="weight-btn bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 py-1.5 rounded-lg text-xs font-medium" data-weight="500">500</button>
            <button class="weight-btn bg-zinc-800 hover:bg-zinc-700 py-1.5 rounded-lg text-xs font-semibold" data-weight="600">600</button>
            <button class="weight-btn bg-zinc-800 hover:bg-zinc-700 py-1.5 rounded-lg text-xs font-bold" data-weight="700">700</button>
          </div>
        </div>

        <!-- Line Height -->
        <div class="space-y-3">
          <div class="flex justify-between items-center">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Line Height</label>
            <span id="line-height-badge" class="bg-zinc-800 text-emerald-400 text-xs font-mono font-bold px-2 py-0.5 rounded">1.6x</span>
          </div>
          <input type="range" id="line-height-slider" min="1.1" max="2.4" step="0.1" value="1.6" class="w-full accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none" />
        </div>

        <!-- Paragraph Spacing -->
        <div class="space-y-3">
          <div class="flex justify-between items-center">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Paragraph Spacing</label>
            <span id="spacing-badge" class="bg-zinc-800 text-emerald-400 text-xs font-mono font-bold px-2 py-0.5 rounded">2.0rem</span>
          </div>
          <input type="range" id="spacing-slider" min="1.0" max="4.0" step="0.2" value="2.0" class="w-full accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none" />
        </div>

        <!-- Mirroring Mode Options -->
        <div class="space-y-3">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Hardware Mirror Mode</label>
          <div class="grid grid-cols-2 gap-2">
            <button class="mirror-btn bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 py-2 rounded-xl text-xs font-medium" data-mirror="none">Normal View</button>
            <button class="mirror-btn bg-zinc-800 hover:bg-zinc-700 py-2 rounded-xl text-xs font-medium" data-mirror="h">Mirror Horiz</button>
            <button class="mirror-btn bg-zinc-800 hover:bg-zinc-700 py-2 rounded-xl text-xs font-medium" data-mirror="v">Mirror Vert</button>
            <button class="mirror-btn bg-zinc-800 hover:bg-zinc-700 py-2 rounded-xl text-xs font-medium" data-mirror="both">Mirror Both</button>
          </div>
        </div>

        <!-- Theme Selection -->
        <div class="space-y-3">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Visual Reading Theme</label>
          <div class="grid grid-cols-2 gap-2">
            <button class="theme-btn bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 py-2.5 px-3 rounded-xl text-left flex items-center space-x-2" data-theme="zinc">
              <span class="w-3.5 h-3.5 rounded-full bg-zinc-950 border border-zinc-700 flex items-center justify-center">
                <span class="w-1.5 h-1.5 rounded-full bg-zinc-100"></span>
              </span>
              <span class="text-xs">Zinc Slate</span>
            </button>
            <button class="theme-btn bg-zinc-800 hover:bg-zinc-700 py-2.5 px-3 rounded-xl text-left flex items-center space-x-2 text-zinc-300" data-theme="coal">
              <span class="w-3.5 h-3.5 rounded-full bg-black border border-zinc-800 flex items-center justify-center">
                <span class="w-1.5 h-1.5 rounded-full bg-white"></span>
              </span>
              <span class="text-xs">Coal Black</span>
            </button>
            <button class="theme-btn bg-zinc-800 hover:bg-zinc-700 py-2.5 px-3 rounded-xl text-left flex items-center space-x-2 text-zinc-300" data-theme="matrix">
              <span class="w-3.5 h-3.5 rounded-full bg-black border border-green-950 flex items-center justify-center">
                <span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>
              </span>
              <span class="text-xs font-mono text-green-500">Matrix terminal</span>
            </button>
            <button class="theme-btn bg-zinc-800 hover:bg-zinc-700 py-2.5 px-3 rounded-xl text-left flex items-center space-x-2 text-zinc-300" data-theme="amber">
              <span class="w-3.5 h-3.5 rounded-full bg-stone-950 border border-amber-900 flex items-center justify-center">
                <span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
              </span>
              <span class="text-xs text-amber-200">Warm Amber</span>
            </button>
          </div>
        </div>

        <!-- Reading Guide Toggle -->
        <div class="flex items-center justify-between border-t border-zinc-800 pt-4">
          <div class="space-y-0.5">
            <span class="block text-xs font-semibold text-zinc-200 uppercase tracking-wider">Reading Guide Overlay</span>
            <span class="text-xs text-zinc-500">Draw horizontal alignment focus lines</span>
          </div>
          <button id="focus-toggle-btn" class="w-11 h-6 rounded-full bg-emerald-500 p-0.5 transition-colors relative" aria-checked="true">
            <span id="focus-toggle-knob" class="block w-5 h-5 rounded-full bg-white shadow transform translate-x-5 transition-transform"></span>
          </button>
        </div>
      </div>

      <!-- TAB 3: LLM SOURCE CONFIG -->
      <div id="tab-content-ai" class="hidden space-y-5">
        <!-- Provider Selector -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Model Provider</label>
          <select id="provider-select" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200">
            <option value="gemini">Google Gemini (Native SDK)</option>
            <option value="openai">OpenAI compatible</option>
            <option value="groq">Groq</option>
            <option value="deepseek">DeepSeek</option>
            <option value="ollama">Ollama (Local LLM)</option>
            <option value="lm-studio">LM Studio (Local LLM)</option>
          </select>
        </div>

        <!-- Custom Base URL (Conditional) -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Base URL (Override)</label>
          <input type="text" id="api-url-input" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-sm font-mono text-zinc-300 focus:outline-none focus:border-emerald-500" placeholder="Defaults to native provider endpoint" />
        </div>

        <!-- Custom API Key (Dynamic client-side key storage) -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">API Key / Credential</label>
          <input type="password" id="api-key-input" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-sm font-mono text-zinc-300 focus:outline-none focus:border-emerald-500" placeholder="Optional. Left blank uses backend env keys" />
        </div>

        <!-- Model Name -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Model Identifier</label>
          <input type="text" id="model-name-input" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-sm font-mono text-zinc-300 focus:outline-none focus:border-emerald-500" value="gemini-3.1-flash-lite" />
        </div>

        <!-- Temperature -->
        <div class="space-y-3">
          <div class="flex justify-between items-center">
            <label class="text-xs font-semibold text-zinc-400 uppercase tracking-wider">Temperature</label>
            <span id="temp-badge" class="bg-zinc-800 text-emerald-400 text-xs font-mono px-2 py-0.5 rounded">0.7</span>
          </div>
          <input type="range" id="temp-slider" min="0.0" max="1.5" step="0.1" value="0.7" class="w-full accent-emerald-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none" />
        </div>

        <!-- Max Tokens -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Max Output Tokens</label>
          <input type="number" id="max-tokens-input" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-sm font-mono text-zinc-300 focus:outline-none focus:border-emerald-500" value="2048" />
        </div>

        <!-- Speech Language Select -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">Speech Recognition Language</label>
          <select id="speech-language-select" class="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-sm focus:outline-none focus:border-emerald-500 text-zinc-200">
            <option value="auto">Auto Detect</option>
            <option value="ar-SA">Arabic (ar-SA)</option>
            <option value="en-US">English (en-US)</option>
          </select>
        </div>

        <!-- System Prompt Instruction -->
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-zinc-400 uppercase tracking-wider">System Role Instructions</label>
          <textarea id="system-prompt-textarea" class="w-full h-32 bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-sm text-zinc-300 focus:outline-none focus:border-emerald-500 transition-colors resize-none font-sans" placeholder="Customize the tone, pacing guidance and structural instructions..."></textarea>
        </div>

        <!-- Reset Circuit Breakers -->
        <div class="space-y-2 pt-3 border-t border-zinc-800/50">
          <button id="reset-circuits-btn" class="w-full bg-red-950/45 hover:bg-red-900/40 text-red-400 border border-red-800/50 hover:border-red-700/60 font-medium text-xs py-2 px-3 rounded-lg transition-all flex items-center justify-center space-x-1.5 shadow-sm">
            <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17" />
            </svg>
            <span>Reset Model Circuit Breakers</span>
          </button>
          <p class="text-[10px] text-zinc-500 text-center leading-relaxed">If API connections failed repeatedly and opened safety circuits, click above to reset all models immediately.</p>
        </div>
      </div>

    </div>

    <!-- Collapsible Controls Footer -->
    <div class="p-6 border-t border-zinc-800 bg-zinc-900 flex items-center space-x-3 text-xs text-zinc-500 font-medium">
      <kbd class="bg-zinc-950 text-zinc-400 px-1.5 py-0.5 rounded border border-zinc-800 font-mono">H</kbd>
      <span>Toggles sidebar drawer</span>
    </div>
  </aside>

  <!-- Expand Sidebar button (Visible when sidebar is collapsed) -->
  <button id="expand-sidebar-btn" class="hidden absolute left-3 top-3 md:left-4 md:top-4 p-3 md:p-2.5 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-xl border border-zinc-800 shadow-xl transition-all z-40 min-h-[44px] min-w-[44px] flex items-center justify-center" title="Expand Control Panel (Hotkey: H)">
    <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
    </svg>
  </button>

  <!-- Right Primary Stage (Teleprompter Screen) -->
  <main id="prompter-stage" class="flex-1 flex flex-col h-full relative overflow-hidden bg-zinc-950 transition-colors duration-300">
    
    <!-- Mobile Compact Top Bar -->
    <header id="mobile-top-bar" class="flex md:hidden items-center justify-between px-3 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0 z-20 select-none">
      <!-- Left: Menu -->
      <button id="mobile-menu-btn" class="flex items-center space-x-1 px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-950 text-zinc-300 rounded-lg font-semibold text-xs transition-colors" title="Toggle Settings Menu">
        <span>☰ Menu</span>
      </button>
      
      <!-- Right side: selectors & indicator -->
      <div class="flex items-center space-x-2">
        <!-- Auto / Manual selector -->
        <div class="flex items-center bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-[10px] select-none">
          <button id="mobile-mode-auto-btn" class="px-2 py-0.5 rounded font-semibold transition-colors bg-emerald-600 text-white">Auto</button>
          <button id="mobile-mode-manual-btn" class="px-2 py-0.5 rounded font-semibold transition-colors text-zinc-400 hover:text-zinc-200">Manual</button>
        </div>

        <!-- Speech Language selector -->
        <select id="mobile-speech-language-select" class="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-0.5 text-[10px] focus:outline-none text-zinc-200">
          <option value="auto">Auto</option>
          <option value="ar-SA">Arabic</option>
          <option value="en-US">English</option>
        </select>

        <!-- Connection indicator -->
        <div class="flex items-center space-x-1 pl-1">
          <span id="mobile-conn-dot" class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
          <span id="mobile-conn-text" class="hidden sm:inline text-zinc-400 font-medium text-[9px]">Connected</span>
        </div>
      </div>
    </header>

    <!-- Floating Teleprompter Bar (Controls / Status) -->
    <header id="stage-header" class="absolute top-0 left-0 right-0 p-2 md:p-4 hidden md:flex flex-col md:flex-row items-center justify-between gap-3 md:gap-0 z-20 bg-gradient-to-b from-zinc-950/90 via-zinc-950/50 to-transparent pointer-events-auto md:pointer-events-none transition-all duration-300">
      <!-- Status Badge / Speed quick indicator -->
      <div class="flex items-center space-x-3 pointer-events-auto bg-zinc-900/85 backdrop-blur-md px-3 py-1.5 md:px-4 md:py-2 rounded-xl border border-zinc-800/80 shadow-lg text-xs font-medium transition-all duration-300 max-w-full overflow-hidden shrink-0">
        <span id="scroll-status-indicator" class="w-2.5 h-2.5 rounded-full bg-zinc-600 transition-colors duration-300"></span>
        <span id="scroll-status-text" class="text-zinc-400">Idle</span>
        <span class="text-zinc-600">|</span>
        <span class="text-zinc-400">Speed:</span>
        <span id="header-speed" class="text-emerald-400 font-mono font-bold">15</span>
        <span id="always-listen-status-sep" class="text-zinc-600 hidden">|</span>
        <span id="always-listen-status-indicator" class="w-2.5 h-2.5 rounded-full bg-cyan-500 hidden animate-pulse"></span>
        <span id="always-listen-status-text" class="text-cyan-400 font-medium hidden">Listening...</span>
      </div>

      <!-- Quick Actions Controls (Stay Normal / Unmirrored always!) -->
      <div class="flex flex-wrap md:flex-nowrap justify-center items-center gap-1.5 md:space-x-2 pointer-events-auto bg-zinc-900/85 backdrop-blur-md p-1.5 rounded-xl border border-zinc-800/80 shadow-lg max-w-full">
        <!-- Control Mode Toggle -->
        <div class="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-[11px] shrink-0 select-none">
          <button id="mode-auto-btn" class="px-2.5 py-1 rounded-md font-semibold transition-colors bg-emerald-600 text-white" title="Automatic Voice Activity Detection Mode">Auto Mode</button>
          <button id="mode-manual-btn" class="px-2.5 py-1 rounded-md font-semibold transition-colors text-zinc-400 hover:text-zinc-200" title="Manual Control Mode (Hold Middle-Click to Talk)">Manual Mode</button>
        </div>

        <span class="hidden md:inline-block w-px h-5 bg-zinc-800 mx-1"></span>

        <!-- Always Listen Toggle Button -->
        <button id="always-listen-toggle-btn" class="flex items-center space-x-1.5 px-3 py-2 md:px-2.5 md:py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg font-medium text-xs transition-colors border border-zinc-700/50 min-h-[44px] md:min-h-0" title="Toggle Always Listen Voice Mode">
          <span id="always-listen-icon" class="text-zinc-400 text-xs">🎤</span>
          <span id="always-listen-btn-text">Always Listen</span>
        </button>



        <!-- Quick Mirror Toggle -->
        <button id="quick-mirror-btn" class="p-2.5 md:p-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center" title="Toggle Mirror Mode (Hotkey: M)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </button>

        <!-- Reset scroll to top -->
        <button id="reset-scroll-btn" class="p-2.5 md:p-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center" title="Rewind to Top">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 6H16" />
          </svg>
        </button>

        <span class="hidden md:inline-block w-px h-5 bg-zinc-800 mx-1"></span>

        <!-- Scroll Actions (Play / Pause) -->
        <button id="play-pause-btn" class="flex items-center space-x-2 px-3.5 py-2 md:px-3 md:py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-lg text-white font-medium text-xs transition-colors min-h-[44px] md:min-h-0" title="Toggle scrolling (Space)">
          <!-- Play icon default -->
          <svg id="play-icon" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 fill-current text-white" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7z"/>
          </svg>
          <svg id="pause-icon" xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 hidden fill-current text-white" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
          </svg>
          <span id="play-pause-text">Play Scroll</span>
        </button>

        <span class="hidden md:inline-block w-px h-5 bg-zinc-800 mx-1"></span>

        <!-- Toggle Controls Display -->
        <button id="hide-controls-btn" class="p-2.5 md:p-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center" title="Toggle Config Sidebar (Hotkey: H)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
        </button>

        <!-- Fullscreen Button -->
        <button id="fullscreen-btn" class="p-2.5 md:p-2 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg transition-colors min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center" title="Toggle Fullscreen Mode (Hotkey: F)">
          <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4h4m12 0h-4v4M4 16v4h4m12-4v4h-4" />
          </svg>
        </button>
      </div>
    </header>

    <!-- Reading Focus Guides (Absolutely centered in the stage) -->
    <div id="focus-guide-overlay" class="absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none z-10 select-none">
      <!-- Dotted guide overlays -->
      <div class="w-full h-24 focus-indicator-top focus-indicator-bottom bg-emerald-500/[0.02]"></div>
    </div>

    <!-- Scrollable container -->
    <div id="prompter-scroll-container" class="flex-1 overflow-y-auto no-scrollbar h-full w-full relative z-0 cursor-grab active:cursor-grabbing">
      
      <!-- Mirror Wrapper -->
      <div id="prompter-mirror-wrapper" class="mirror-none w-full min-h-full flex flex-col justify-start">
        
        <!-- Rendered Text Container -->
        <article id="markdown-text-container" class="teleprompter-prose py-32 md:py-48 px-4 md:px-24 mx-auto w-full max-w-4xl focus:outline-none transition-all duration-300">
          <!-- Text gets generated here dynamically -->
        </article>

      </div>

    </div>


    <!-- Mobile Auto Mode Mic FAB -->
    <button id="mobile-fab-mic" class="hidden md:hidden fixed bottom-20 right-6 w-14 h-14 rounded-full shadow-2xl border items-center justify-center transition-all duration-300 z-30 select-none touch-none bg-zinc-800 border-zinc-700 text-zinc-300" title="Toggle Always Listen">
      <div id="mobile-fab-pulse" class="absolute inset-0 rounded-full bg-cyan-500/30 animate-ping opacity-0"></div>
      <span id="mobile-fab-icon" class="text-xl relative z-10">🎤</span>
    </button>
  </main>
`;

// DOM Element Selectors
const sidebar = document.getElementById("sidebar") as HTMLElement;
const sidebarBackdrop = document.getElementById("sidebar-backdrop") as HTMLElement;
const collapseBtnSidebar = document.getElementById("collapse-btn-sidebar") as HTMLButtonElement;
const expandSidebarBtn = document.getElementById("expand-sidebar-btn") as HTMLButtonElement;
const hideControlsBtn = document.getElementById("hide-controls-btn") as HTMLButtonElement;
const prompterStage = document.getElementById("prompter-stage") as HTMLElement;

const tabBtnScript = document.getElementById("tab-btn-script") as HTMLButtonElement;
const tabBtnConfig = document.getElementById("tab-btn-config") as HTMLButtonElement;
const tabBtnAi = document.getElementById("tab-btn-ai") as HTMLButtonElement;

const tabContentScript = document.getElementById("tab-content-script") as HTMLElement;
const tabContentConfig = document.getElementById("tab-content-config") as HTMLElement;
const tabContentAi = document.getElementById("tab-content-ai") as HTMLElement;

const scriptTextarea = document.getElementById("script-textarea") as HTMLTextAreaElement;
const aiPromptTextarea = document.getElementById("ai-prompt-textarea") as HTMLTextAreaElement;
const generateScriptBtn = document.getElementById("generate-script-btn") as HTMLButtonElement;
const generateBtnText = document.getElementById("generate-btn-text") as HTMLSpanElement;
const generateIcon = document.getElementById("generate-icon") as HTMLElement;

const speedSlider = document.getElementById("speed-slider") as HTMLInputElement;
const speedBadge = document.getElementById("speed-badge") as HTMLSpanElement;
const decreaseSpeedBtn = document.getElementById("decrease-speed-btn") as HTMLButtonElement;
const increaseSpeedBtn = document.getElementById("increase-speed-btn") as HTMLButtonElement;
const resetSpeedBtn = document.getElementById("reset-speed-btn") as HTMLButtonElement;
const fontSizeSlider = document.getElementById("font-size-slider") as HTMLInputElement;
const fontSizeBadge = document.getElementById("font-size-badge") as HTMLSpanElement;
const lineHeightSlider = document.getElementById("line-height-slider") as HTMLInputElement;
const lineHeightBadge = document.getElementById("line-height-badge") as HTMLSpanElement;
const spacingSlider = document.getElementById("spacing-slider") as HTMLInputElement;
const spacingBadge = document.getElementById("spacing-badge") as HTMLSpanElement;

const focusToggleBtn = document.getElementById("focus-toggle-btn") as HTMLButtonElement;
const focusToggleKnob = document.getElementById("focus-toggle-knob") as HTMLElement;
const focusGuideOverlay = document.getElementById("focus-guide-overlay") as HTMLElement;

const providerSelect = document.getElementById("provider-select") as HTMLSelectElement;
const apiUrlInput = document.getElementById("api-url-input") as HTMLInputElement;
const apiKeyInput = document.getElementById("api-key-input") as HTMLInputElement;
const modelNameInput = document.getElementById("model-name-input") as HTMLInputElement;
const tempSlider = document.getElementById("temp-slider") as HTMLInputElement;
const tempBadge = document.getElementById("temp-badge") as HTMLSpanElement;
const maxTokensInput = document.getElementById("max-tokens-input") as HTMLInputElement;
const speechLanguageSelect = document.getElementById("speech-language-select") as HTMLSelectElement;
const systemPromptTextarea = document.getElementById("system-prompt-textarea") as HTMLTextAreaElement;
const resetCircuitsBtn = document.getElementById("reset-circuits-btn") as HTMLButtonElement;

const scrollStatusIndicator = document.getElementById("scroll-status-indicator") as HTMLElement;
const scrollStatusText = document.getElementById("scroll-status-text") as HTMLSpanElement;
const headerSpeed = document.getElementById("header-speed") as HTMLSpanElement;
const resetScrollBtn = document.getElementById("reset-scroll-btn") as HTMLButtonElement;
const playPauseBtn = document.getElementById("play-pause-btn") as HTMLButtonElement;
const playIcon = document.getElementById("play-icon") as HTMLElement;
const pauseIcon = document.getElementById("pause-icon") as HTMLElement;
const playPauseText = document.getElementById("play-pause-text") as HTMLSpanElement;
const quickMirrorBtn = document.getElementById("quick-mirror-btn") as HTMLButtonElement;
const fullscreenBtn = document.getElementById("fullscreen-btn") as HTMLButtonElement;

// Always Listen UI Selectors
const modeAutoBtn = document.getElementById("mode-auto-btn") as HTMLButtonElement;
const modeManualBtn = document.getElementById("mode-manual-btn") as HTMLButtonElement;
const alwaysListenToggleBtn = document.getElementById("always-listen-toggle-btn") as HTMLButtonElement;
const alwaysListenIcon = document.getElementById("always-listen-icon") as HTMLElement;
const alwaysListenBtnText = document.getElementById("always-listen-btn-text") as HTMLSpanElement;
const alwaysListenStatusSep = document.getElementById("always-listen-status-sep") as HTMLElement;
const alwaysListenStatusIndicator = document.getElementById("always-listen-status-indicator") as HTMLElement;
const alwaysListenStatusText = document.getElementById("always-listen-status-text") as HTMLSpanElement;

const prompterScrollContainer = document.getElementById("prompter-scroll-container") as HTMLElement;
const prompterMirrorWrapper = document.getElementById("prompter-mirror-wrapper") as HTMLElement;
const markdownTextContainer = document.getElementById("markdown-text-container") as HTMLElement;

// Mermaid Rendering cache and utility functions
const mermaidCache = new Map<string, { svg: string; error?: string }>();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function makeSvgResponsive(svgStr: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (svg) {
      svg.style.maxWidth = "100%";
      svg.style.height = "auto";
      svg.classList.add("mx-auto");
      svg.removeAttribute("width");
      return svg.outerHTML;
    }
  } catch (e) {
    console.error("Failed to make SVG responsive:", e);
  }
  return svgStr;
}

// Event Delegation for Mermaid toggle raw code buttons inside the markdown container
markdownTextContainer.addEventListener("click", (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  const toggleBtn = target.closest(".mermaid-toggle-raw-btn") as HTMLButtonElement;
  if (toggleBtn) {
    const wrapper = toggleBtn.closest(".mermaid-error-wrapper") as HTMLElement;
    if (wrapper) {
      const codeBlock = wrapper.querySelector(".mermaid-raw-code") as HTMLElement;
      if (codeBlock) {
        codeBlock.classList.toggle("hidden");
        const isHidden = codeBlock.classList.contains("hidden");
        toggleBtn.innerText = isHidden ? "Show Raw Mermaid Code" : "Hide Raw Mermaid Code";
      }
    }
  }
});

function isVerticallyMirrored(): boolean {
  return settings.mirrorMode === "v" || settings.mirrorMode === "both";
}

function getScrollLimit(): number {
  if (!prompterScrollContainer) return 0;
  return Math.max(0, prompterScrollContainer.scrollHeight - prompterScrollContainer.clientHeight);
}

function getVisualScrollTop(): number {
  if (!prompterScrollContainer) return 0;
  const physical = prompterScrollContainer.scrollTop;
  if (isVerticallyMirrored()) {
    return getScrollLimit() - physical;
  }
  return physical;
}

function setVisualScrollTop(val: number, smooth: boolean = false) {
  if (!prompterScrollContainer) return;
  const limit = getScrollLimit();
  const clampedVal = Math.max(0, Math.min(limit, val));
  const physical = isVerticallyMirrored() ? (limit - clampedVal) : clampedVal;
  
  if (smooth) {
    prompterScrollContainer.scrollTo({
      top: physical,
      behavior: "smooth"
    });
  } else {
    prompterScrollContainer.scrollTop = physical;
  }
}

function centerNewestBlock(smooth: boolean = true) {
  if (!prompterScrollContainer || !markdownTextContainer) return;
  
  // Find the active block element
  const newestBlock = markdownTextContainer.querySelector('.conversation-block.active-block') as HTMLElement;
  if (!newestBlock) return;
  
  const H = prompterScrollContainer.clientHeight;
  const h = newestBlock.offsetHeight;
  
  // Get its offset position relative to its offsetParent
  const blockTop = newestBlock.offsetTop;
  
  // To center the newest block in the teleprompter reading area:
  const targetVisualScroll = blockTop + (h / 2) - (H / 2);
  
  console.log(`[DIAGNOSTIC - SCROLL CENTERING] Newest block offsetTop: ${blockTop}, height: ${h}, container height: ${H}, target visual scroll: ${targetVisualScroll}`);
  
  setVisualScrollTop(targetVisualScroll, smooth);
}

// React Root for high-performance rendering of Markdown and Intercepted Diagrams
let reactRoot: any = null;

// Render Markdown & Mermaid Logic
function renderContent() {
  const previousVisualScroll = getVisualScrollTop();

  if (markdownTextContainer) {
    if (!reactRoot) {
      reactRoot = ReactDOM.createRoot(markdownTextContainer);
    }
    
    // Filter out the active script block from history to avoid duplication
    const historyBlocks = conversationHistory.filter(
      block => block && block.trim() && block.trim() !== currentScript.trim()
    );

    reactRoot.render(
      <div className="flex flex-col space-y-12 w-full">
        {/* Active/Newest block */}
        <div className="conversation-block active-block w-full">
          <MarkdownProcessor
            content={currentScript}
            isGenerating={isGenerating}
            fontSize={settings.fontSize}
            fontWeight={settings.fontWeight}
            lineHeight={settings.lineHeight}
            paragraphSpacing={settings.paragraphSpacing}
          />
        </div>
        {/* History blocks */}
        {historyBlocks.map((block, index) => (
          <div 
            key={index} 
            className="conversation-block previous-block border-t border-zinc-800/40 pt-12 w-full opacity-85 hover:opacity-100 transition-opacity duration-200"
          >
            <MarkdownProcessor
              content={block}
              isGenerating={false}
              fontSize={settings.fontSize}
              fontWeight={settings.fontWeight}
              lineHeight={settings.lineHeight}
              paragraphSpacing={settings.paragraphSpacing}
            />
          </div>
        ))}
      </div>
    );
  }

  setVisualScrollTop(previousVisualScroll);
}

// Sidebar collapsibility
function setSidebarState(hidden: boolean) {
  settings.hideControls = hidden;
  saveSettings();

  if (hidden) {
    sidebar.classList.add("-translate-x-full");
    sidebar.style.marginRight = `-${sidebar.clientWidth}px`;
    sidebar.classList.add("pointer-events-none");
    expandSidebarBtn.classList.remove("hidden");
    
    // Completely disable touch hit testing and visibility for safety
    sidebar.classList.add("invisible");
    
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.add("opacity-0", "pointer-events-none");
      setTimeout(() => {
        if (sidebarBackdrop.classList.contains("opacity-0")) {
          sidebarBackdrop.classList.add("hidden");
        }
      }, 300);
    }
  } else {
    // Re-enable visibility before animating back in
    sidebar.classList.remove("invisible");
    
    sidebar.classList.remove("-translate-x-full");
    sidebar.style.marginRight = "0px";
    sidebar.classList.remove("pointer-events-none");
    expandSidebarBtn.classList.add("hidden");
    if (sidebarBackdrop) {
      sidebarBackdrop.classList.remove("hidden");
      // Force layout reflow
      void sidebarBackdrop.offsetWidth;
      sidebarBackdrop.classList.remove("opacity-0", "pointer-events-none");
      sidebarBackdrop.classList.add("opacity-100");
    }
  }
}

// Tab switcher logic
function setActiveTab(tabId: string) {
  // Reset tabs
  [tabBtnScript, tabBtnConfig, tabBtnAi].forEach((btn) => {
    btn.classList.remove("border-emerald-500", "text-emerald-400");
    btn.classList.add("border-transparent", "text-zinc-400");
  });

  // Highlight button
  const currentBtn = document.getElementById(`tab-btn-${tabId}`) as HTMLButtonElement;
  if (currentBtn) {
    currentBtn.classList.remove("border-transparent", "text-zinc-400");
    currentBtn.classList.add("border-emerald-500", "text-emerald-400");
  }

  // Toggle visible elements
  [tabContentScript, tabContentConfig, tabContentAi].forEach((content) => {
    content.classList.add("hidden");
  });

  const activeContent = document.getElementById(`tab-content-${tabId}`) as HTMLElement;
  if (activeContent) {
    activeContent.classList.remove("hidden");
  }
}

// Speed Control mapping update
function updateSpeed(val: number) {
  const clamped = Math.max(1, Math.min(60, Number(val.toFixed(1))));
  settings.scrollSpeed = clamped;
  if (speedSlider) {
    speedSlider.value = String(clamped);
  }
  const formatted = formatSpeedMultiplier(clamped);
  if (speedBadge) {
    speedBadge.innerText = formatted;
  }
  if (headerSpeed) {
    headerSpeed.innerText = formatted;
  }
  saveSettings();
}

// Font Size update mapping
function updateFontSize(val: number) {
  settings.fontSize = val;
  fontSizeSlider.value = String(val);
  fontSizeBadge.innerText = `${val}px`;
  markdownTextContainer.style.setProperty('--desktop-font-size', `${val}px`);
  markdownTextContainer.style.fontSize = "var(--desktop-font-size)";
  saveSettings();
  renderContent();
}

// Line Height update
function updateLineHeight(val: number) {
  settings.lineHeight = val;
  lineHeightSlider.value = String(val);
  lineHeightBadge.innerText = `${val}x`;
  markdownTextContainer.style.lineHeight = `${val}`;
  saveSettings();
  renderContent();
}

// Paragraph Spacing update
function updateSpacing(val: number) {
  settings.paragraphSpacing = val;
  spacingSlider.value = String(val);
  spacingBadge.innerText = `${val.toFixed(1)}rem`;
  const elements = markdownTextContainer.querySelectorAll("p, h1, h2, h3, h4, ul, ol, table, pre, blockquote");
  elements.forEach((el: any) => {
    el.style.marginBottom = `${val}rem`;
  });
  saveSettings();
  renderContent();
}

// Font weight selector highlight
function updateFontWeight(weight: string) {
  settings.fontWeight = weight as any;
  markdownTextContainer.style.fontWeight = weight;
  
  const buttons = document.querySelectorAll(".weight-btn");
  buttons.forEach((btn: any) => {
    if (btn.dataset.weight === weight) {
      btn.className = "weight-btn bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 py-1.5 rounded-lg text-xs font-medium";
    } else {
      btn.className = "weight-btn bg-zinc-800 hover:bg-zinc-700 py-1.5 rounded-lg text-xs";
    }
  });
  saveSettings();
  renderContent();
}

// Mirroring modes state mapping
function applyMirrorMode(mode: string) {
  const prevVisualScroll = getVisualScrollTop();

  settings.mirrorMode = mode as any;
  prompterMirrorWrapper.className = "w-full min-h-full flex flex-col justify-start transition-transform duration-300";
  
  if (mode === "h") {
    prompterMirrorWrapper.classList.add("mirror-h");
  } else if (mode === "v") {
    prompterMirrorWrapper.classList.add("mirror-v");
  } else if (mode === "both") {
    prompterMirrorWrapper.classList.add("mirror-both");
  } else {
    prompterMirrorWrapper.classList.add("mirror-none");
  }

  // Highlight control buttons in panel
  const buttons = document.querySelectorAll(".mirror-btn");
  buttons.forEach((btn: any) => {
    if (btn.dataset.mirror === mode) {
      btn.className = "mirror-btn bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 py-2 rounded-xl text-xs font-medium";
    } else {
      btn.className = "mirror-btn bg-zinc-800 hover:bg-zinc-700 py-2 rounded-xl text-xs font-medium";
    }
  });
  saveSettings();

  setVisualScrollTop(prevVisualScroll);
}

// Cycle mirroring modes sequentially for quick key shortcut
function cycleMirrorMode() {
  const modes: ("none" | "h" | "v" | "both")[] = ["none", "h", "v", "both"];
  const nextIdx = (modes.indexOf(settings.mirrorMode) + 1) % modes.length;
  applyMirrorMode(modes[nextIdx]);
}

// Apply Visual Theme layout
function applyTheme(themeName: string) {
  settings.theme = themeName as any;

  // Clear current themes
  prompterStage.className = "flex-1 flex flex-col h-full relative overflow-hidden transition-colors duration-300";
  markdownTextContainer.className = "teleprompter-prose py-48 px-8 md:px-24 mx-auto w-full max-w-4xl focus:outline-none transition-all duration-300";

  if (themeName === "coal") {
    prompterStage.classList.add("bg-black", "text-zinc-100");
    markdownTextContainer.classList.add("text-zinc-100");
  } else if (themeName === "matrix") {
    prompterStage.classList.add("bg-black", "text-green-500");
    markdownTextContainer.classList.add("text-green-500", "font-mono");
  } else if (themeName === "amber") {
    prompterStage.classList.add("bg-stone-950", "text-amber-100");
    markdownTextContainer.classList.add("text-amber-100");
  } else {
    // Zinc (Default Slate)
    prompterStage.classList.add("bg-zinc-950", "text-zinc-100");
    markdownTextContainer.classList.add("text-zinc-100");
  }

  // Highlight theme buttons in config
  const buttons = document.querySelectorAll(".theme-btn");
  buttons.forEach((btn: any) => {
    if (btn.dataset.theme === themeName) {
      btn.className = "theme-btn bg-emerald-950/40 border border-emerald-500/50 text-emerald-400 py-2.5 px-3 rounded-xl text-left flex items-center space-x-2";
    } else {
      btn.className = "theme-btn bg-zinc-800 hover:bg-zinc-700 py-2.5 px-3 rounded-xl text-left flex items-center space-x-2 text-zinc-300";
    }
  });

  saveSettings();
  renderContent();
}

function updatePttButtonVisibility() {
  // Detect if touch support is available (mobile, tablet, or touch-capable device)
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  const isManual = settings.controlMode === "manual";

  const mobileFabMic = document.getElementById("mobile-fab-mic");
  if (mobileFabMic) {
    if (isTouch && !isManual) {
      mobileFabMic.classList.remove("hidden");
      mobileFabMic.classList.add("flex");
    } else {
      mobileFabMic.classList.remove("flex");
      mobileFabMic.classList.add("hidden");
    }
  }
}

// Apply Control Mode (Auto / Manual)
function applyControlMode(mode: "auto" | "manual", silent = false) {
  settings.controlMode = mode;
  saveSettings();

  if (mode === "manual") {
    // Stop always listen VAD if it is active
    if (isAlwaysListenEnabled) {
      stopAlwaysListen();
    }
    // Update button styling
    if (modeAutoBtn) {
      modeAutoBtn.className = "px-2.5 py-1 rounded-md font-semibold transition-colors text-zinc-400 hover:text-zinc-200";
    }
    if (modeManualBtn) {
      modeManualBtn.className = "px-2.5 py-1 rounded-md font-semibold transition-colors bg-emerald-600 text-white";
    }
    if (!silent) {
      showToast("Switched to Manual Mode. Hold middle-click to speak.", "info");
    }
  } else {
    // Update button styling
    if (modeAutoBtn) {
      modeAutoBtn.className = "px-2.5 py-1 rounded-md font-semibold transition-colors bg-emerald-600 text-white";
    }
    if (modeManualBtn) {
      modeManualBtn.className = "px-2.5 py-1 rounded-md font-semibold transition-colors text-zinc-400 hover:text-zinc-200";
    }
    if (!silent) {
      showToast("Switched to Auto Mode. Always Listen with VAD is active.", "info");
    }
  }

  // Update dynamic visibility of the touch Push-to-Talk button
  updatePttButtonVisibility();

  // Update mobile UI elements for control mode
  if (typeof updateMobileUiForMode === "function") {
    updateMobileUiForMode();
  }
}

// Toggle Reading Focus Guide layout
function setFocusMode(enabled: boolean) {
  settings.focusMode = enabled;
  saveSettings();

  if (enabled) {
    focusToggleBtn.setAttribute("aria-checked", "true");
    focusToggleBtn.className = "w-11 h-6 rounded-full bg-emerald-500 p-0.5 transition-colors relative";
    focusToggleKnob.className = "block w-5 h-5 rounded-full bg-white shadow transform translate-x-5 transition-transform";
    focusGuideOverlay.className = "absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none z-10 select-none transition-opacity duration-300 opacity-100";
  } else {
    focusToggleBtn.setAttribute("aria-checked", "false");
    focusToggleBtn.className = "w-11 h-6 rounded-full bg-zinc-700 p-0.5 transition-colors relative";
    focusToggleKnob.className = "block w-5 h-5 rounded-full bg-white shadow transform translate-x-0 transition-transform";
    focusGuideOverlay.className = "absolute left-0 right-0 top-1/2 -translate-y-1/2 pointer-events-none z-10 select-none transition-opacity duration-300 opacity-0";
  }
}

// Auto-Scroll Play Engine physics loop (delta-time calculated)
function scrollLoop(timestamp: number) {
  if (!lastTimestamp) lastTimestamp = timestamp;
  const delta = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  if (settings.autoScroll && !isGenerating) {
    // Smooth speed interpolation using delta time
    const speedDiff = settings.scrollSpeed - currentInterpolatedSpeed;
    const lerpFactor = 1 - Math.exp(-0.005 * delta); // approx 5ms half-life, extremely smooth
    currentInterpolatedSpeed += speedDiff * Math.min(1, Math.max(0, lerpFactor));

    // Map scrollSpeed: Speed 1 is extremely slow (approx 5px per sec), Speed 60 is brisk (approx 300px per sec)
    const pixelsPerSecond = currentInterpolatedSpeed * 5.0;
    scrollAccumulator += (pixelsPerSecond * delta) / 1000;

    if (scrollAccumulator >= 1) {
      const scrollStep = Math.floor(scrollAccumulator);
      scrollAccumulator -= scrollStep;

      const currentVisual = getVisualScrollTop();
      const nextVisual = currentVisual + scrollStep;
      
      setVisualScrollTop(nextVisual);

      // Detect end of track
      const limit = getScrollLimit();
      if (nextVisual >= limit - 2) {
        toggleAutoScroll(false);
      }
    }
  } else {
    // Keep currentInterpolatedSpeed warmed up even when paused so it doesn't have a cold start when resumed
    currentInterpolatedSpeed = settings.scrollSpeed;
  }

  animationFrameId = requestAnimationFrame(scrollLoop);
}

// Trigger scroll execution state
function toggleAutoScroll(active: boolean) {
  settings.autoScroll = active;
  
  if (active) {
    scrollStatusIndicator.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 pulse-glow";
    scrollStatusText.innerText = "Scrolling";
    scrollStatusText.className = "text-emerald-400 font-semibold";
    
    playIcon.classList.add("hidden");
    pauseIcon.classList.remove("hidden");
    playPauseText.innerText = "Pause Scroll";
    playPauseBtn.className = "flex items-center space-x-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 rounded-lg text-white font-medium text-xs transition-colors";
    
    // Resume animation clock
    lastTimestamp = 0;
    scrollAccumulator = 0;
  } else {
    scrollStatusIndicator.className = "w-2.5 h-2.5 rounded-full bg-zinc-600";
    scrollStatusText.innerText = "Paused";
    scrollStatusText.className = "text-zinc-400";
    
    playIcon.classList.remove("hidden");
    pauseIcon.classList.add("hidden");
    playPauseText.innerText = "Play Scroll";
    playPauseBtn.className = "flex items-center space-x-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 rounded-lg text-white font-medium text-xs transition-colors";
  }

  // Sync mobile bottom toolbar play/pause state
  const mobilePlayIcon = document.getElementById("mobile-play-icon");
  const mobilePlayText = document.getElementById("mobile-play-text");
  if (mobilePlayIcon && mobilePlayText) {
    if (active) {
      mobilePlayIcon.innerText = "⏸️";
      mobilePlayText.innerText = "Pause";
    } else {
      mobilePlayIcon.innerText = "▶️";
      mobilePlayText.innerText = "Play";
    }
  }
}

// Fullscreen API toggler
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.error("Error attempting to enable fullscreen:", err);
    });
  } else {
    document.exitFullscreen();
  }
}

// Hook fullscreen state change to update visual fullscreen button icons
document.addEventListener("fullscreenchange", () => {
  if (document.fullscreenElement) {
    fullscreenBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    `;
    fullscreenBtn.title = "Exit Fullscreen (Hotkey: Esc)";
  } else {
    fullscreenBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4h4m12 0h-4v4M4 16v4h4m12-4v4h-4" />
      </svg>
    `;
    fullscreenBtn.title = "Toggle Fullscreen Mode (Hotkey: F)";
  }
});

// Reusable, highly robust interaction listener that unifies mouse click and touch/pointer events.
// This prevents zoom delays, click lag, and duplicate double-activation on touchscreens.
function bindButton(btn: HTMLElement | null, callback: (e: Event) => void) {
  if (!btn) return;
  
  // Apply visual-pacing style and touch manipulation optimization
  btn.style.touchAction = "manipulation";
  
  let processed = false;
  
  const handle = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    callback(e);
  };
  
  // Listen on pointerup as primary modern touch/pointer mechanism
  btn.addEventListener("pointerup", (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    processed = true;
    handle(e);
    setTimeout(() => { processed = false; }, 300);
  });
  
  // Classic touch interaction fallback
  btn.addEventListener("touchend", (e: TouchEvent) => {
    if (processed) return;
    processed = true;
    handle(e);
    setTimeout(() => { processed = false; }, 300);
  });
  
  // Standard mouse click fallback
  btn.addEventListener("click", (e: MouseEvent) => {
    if (processed) return;
    handle(e);
  });
}

// Tab interaction delegation
[tabBtnScript, tabBtnConfig, tabBtnAi].forEach((btn) => {
  bindButton(btn, () => {
    const tabId = btn.getAttribute("data-tab");
    if (tabId) setActiveTab(tabId);
  });
});

// Configure preset details for model selections automatically
function onProviderChange(providerValue: string) {
  settings.provider = providerValue;

  // Load defaults for convenience
  if (providerValue === "gemini") {
    apiUrlInput.value = "";
    modelNameInput.value = "gemini-3.1-flash-lite";
    apiUrlInput.disabled = true;
    apiUrlInput.placeholder = "Native Gemini SDK used";
  } else if (providerValue === "openai") {
    apiUrlInput.value = "https://api.openai.com/v1";
    modelNameInput.value = "gpt-4o-mini";
    apiUrlInput.disabled = false;
    apiUrlInput.placeholder = "https://api.openai.com/v1";
  } else if (providerValue === "groq") {
    apiUrlInput.value = "https://api.groq.com/openai/v1";
    modelNameInput.value = "llama3-8b-8192";
    apiUrlInput.disabled = false;
    apiUrlInput.placeholder = "https://api.groq.com/openai/v1";
  } else if (providerValue === "deepseek") {
    apiUrlInput.value = "https://api.deepseek.com/v1";
    modelNameInput.value = "deepseek-chat";
    apiUrlInput.disabled = false;
    apiUrlInput.placeholder = "https://api.deepseek.com/v1";
  } else if (providerValue === "ollama") {
    apiUrlInput.value = "http://localhost:11434/v1";
    modelNameInput.value = "llama3";
    apiUrlInput.disabled = false;
    apiUrlInput.placeholder = "http://localhost:11434/v1";
  } else if (providerValue === "lm-studio") {
    apiUrlInput.value = "http://localhost:1234/v1";
    modelNameInput.value = "meta-llama-3-8b-instruct";
    apiUrlInput.disabled = false;
    apiUrlInput.placeholder = "http://localhost:1234/v1";
  }

  // Update settings object
  settings.baseUrl = apiUrlInput.value;
  settings.model = modelNameInput.value;

  saveSettings();
}

// AI Script Streaming over SSE Handler
async function triggerAIScriptGeneration() {
  if (isGenerating) return;

  const prompt = aiPromptTextarea.value.trim();
  if (!prompt) {
    alert("Please write a topic or prompt for your AI script.");
    return;
  }

  // Freeze controls
  isGenerating = true;
  generateScriptBtn.disabled = true;
  generateScriptBtn.className = "w-full bg-zinc-800 text-zinc-500 font-medium text-sm py-2.5 px-4 rounded-xl cursor-not-allowed flex items-center justify-center space-x-2";
  generateBtnText.innerText = "Streaming script...";
  generateIcon.className = "w-4 h-4 animate-spin text-zinc-500";

  // Clear script
  currentScript = "";
  renderContent();
  setVisualScrollTop(0);

  const requestPayload = {
    prompt,
    provider: settings.provider,
    apiKey: apiKeyInput.value.trim(),
    baseUrl: apiUrlInput.value.trim(),
    model: modelNameInput.value.trim(),
    temperature: settings.temperature,
    maxTokens: Number(maxTokensInput.value) || undefined,
    systemPrompt: systemPromptTextarea.value.trim(),
  };

  try {
    const response = await fetch("/api/stream", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestPayload),
    });

    if (!response.ok) {
      throw new Error(`Failed to initialize stream. Status code: ${response.status}`);
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder("utf-8");
    if (!reader) throw new Error("Stream reader not available");

    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (trimmed.startsWith("data: ")) {
          const content = trimmed.slice(6).trim();
          if (content === "[DONE]") {
            continue;
          }

          try {
            const data = JSON.parse(content);
            if (data.error) {
              alert(data.error);
              currentScript = `# Error\n\n${data.error}`;
              break;
            }
            if (data.text) {
              currentScript += data.text;
              scriptTextarea.value = currentScript;
              renderContent();
            }
          } catch (e) {
            // Skips incomplete parsing blocks gracefully
          }
        }
      }
    }
  } catch (error: any) {
    console.error("SSE stream error:", error);
    alert(`Streaming script failed: ${error.message}`);
    currentScript = `# Generation Failed\n\n${error.message}. Please verify your provider settings, endpoints, and credentials, then retry.`;
    scriptTextarea.value = currentScript;
    renderContent();
  } finally {
    isGenerating = false;
    generateScriptBtn.disabled = false;
    generateScriptBtn.className = "w-full bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white font-medium text-sm py-2.5 px-4 rounded-xl transition-all flex items-center justify-center space-x-2 shadow-lg shadow-emerald-950/20";
    generateBtnText.innerText = "Generate Script Stream";
    generateIcon.className = "w-4 h-4";
    addCompletedBlock(currentScript);
    saveSettings();
    renderContent(); // Trigger safe mermaid diagram draw on complete
    setTimeout(() => {
      centerNewestBlock(true);
    }, 100);
  }
}

// Register Listeners
scriptTextarea.addEventListener("input", () => {
  currentScript = scriptTextarea.value;
  renderContent();
  saveSettings();
});

bindButton(generateScriptBtn, () => {
  triggerAIScriptGeneration();
});

speedSlider.addEventListener("input", (e: any) => {
  updateSpeed(Number(e.target.value));
});

bindButton(decreaseSpeedBtn, () => {
  updateSpeed(settings.scrollSpeed - 0.5);
});

bindButton(increaseSpeedBtn, () => {
  updateSpeed(settings.scrollSpeed + 0.5);
});

bindButton(resetSpeedBtn, () => {
  updateSpeed(15);
});

fontSizeSlider.addEventListener("input", (e: any) => {
  updateFontSize(Number(e.target.value));
});

lineHeightSlider.addEventListener("input", (e: any) => {
  updateLineHeight(Number(e.target.value));
});

spacingSlider.addEventListener("input", (e: any) => {
  updateSpacing(Number(e.target.value));
});

tempSlider.addEventListener("input", (e: any) => {
  const v = Number(e.target.value);
  settings.temperature = v;
  tempBadge.innerText = String(v);
  saveSettings();
});

// Delegated weight configuration listeners
document.querySelectorAll(".weight-btn").forEach((btn: any) => {
  bindButton(btn, () => {
    updateFontWeight(btn.dataset.weight);
  });
});

// Delegated mirroring configuration listeners
document.querySelectorAll(".mirror-btn").forEach((btn: any) => {
  bindButton(btn, () => {
    applyMirrorMode(btn.dataset.mirror);
  });
});

// Delegated Theme listeners
document.querySelectorAll(".theme-btn").forEach((btn: any) => {
  bindButton(btn, () => {
    applyTheme(btn.dataset.theme);
  });
});

bindButton(focusToggleBtn, () => {
  setFocusMode(!settings.focusMode);
});

// Provider select events
providerSelect.addEventListener("change", (e: any) => {
  onProviderChange(e.target.value);
});

// API config detail inputs mapping
apiUrlInput.addEventListener("input", (e: any) => {
  settings.baseUrl = e.target.value;
  saveSettings();
});
apiKeyInput.addEventListener("input", (e: any) => {
  settings.apiKey = e.target.value;
  saveSettings();
});
modelNameInput.addEventListener("input", (e: any) => {
  settings.model = e.target.value;
  saveSettings();
});
maxTokensInput.addEventListener("input", (e: any) => {
  settings.maxTokens = Number(e.target.value) || 2048;
  saveSettings();
});
systemPromptTextarea.addEventListener("input", (e: any) => {
  settings.systemPrompt = e.target.value;
  saveSettings();
});

speechLanguageSelect.addEventListener("change", (e: any) => {
  settings.speechLanguage = e.target.value as any;
  saveSettings();
  if (typeof updateMobileLanguageBadge === "function") {
    updateMobileLanguageBadge();
  }
});

if (resetCircuitsBtn) {
  resetCircuitsBtn.addEventListener("click", async () => {
    try {
      resetCircuitsBtn.disabled = true;
      const originalText = resetCircuitsBtn.innerHTML;
      resetCircuitsBtn.innerHTML = `<span>Resetting...</span>`;
      
      const response = await fetch("/api/reset-circuits", {
        method: "POST",
      });
      
      if (response.ok) {
        resetCircuitsBtn.classList.remove("text-red-400", "border-red-800/50");
        resetCircuitsBtn.classList.add("text-emerald-400", "border-emerald-800/50", "bg-emerald-950/20");
        resetCircuitsBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
          </svg>
          <span>Circuits Reset!</span>
        `;
        setTimeout(() => {
          resetCircuitsBtn.classList.add("text-red-400", "border-red-800/50");
          resetCircuitsBtn.classList.remove("text-emerald-400", "border-emerald-800/50", "bg-emerald-950/20");
          resetCircuitsBtn.innerHTML = originalText;
          resetCircuitsBtn.disabled = false;
        }, 2500);
      } else {
        throw new Error("Failed to reset");
      }
    } catch (err) {
      console.error("Error resetting circuit breakers:", err);
      resetCircuitsBtn.disabled = false;
    }
  });
}

// Control Mode Toggle bindings
if (modeAutoBtn) {
  bindButton(modeAutoBtn, () => {
    applyControlMode("auto");
  });
}
if (modeManualBtn) {
  bindButton(modeManualBtn, () => {
    applyControlMode("manual");
  });
}

// Stage Control Button mappings
bindButton(playPauseBtn, () => {
  toggleAutoScroll(!settings.autoScroll);
});

if (alwaysListenToggleBtn) {
  bindButton(alwaysListenToggleBtn, () => {
    if (settings.controlMode === "manual") {
      applyControlMode("auto");
      startAlwaysListen();
    } else {
      if (isAlwaysListenEnabled) {
        stopAlwaysListen();
      } else {
        startAlwaysListen();
      }
    }
  });
}


// --- MOBILE UI INTERACTION BINDS & HELPER FUNCTIONS ---
function updateConnectionStatus(isConnected: boolean) {
  const dot = document.getElementById("mobile-conn-dot");
  const text = document.getElementById("mobile-conn-text");
  if (dot && text) {
    if (isConnected) {
      dot.className = "w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse";
      text.innerText = "Connected";
      text.className = "text-emerald-400 font-medium text-[10px]";
    } else {
      dot.className = "w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse";
      text.innerText = "Reconnecting";
      text.className = "text-amber-400 font-medium text-[10px]";
    }
  }
}

function updateMobileLanguageBadge() {
  const mobileSpeechLanguageSelect = document.getElementById("mobile-speech-language-select") as HTMLSelectElement | null;
  if (mobileSpeechLanguageSelect) {
    mobileSpeechLanguageSelect.value = settings.speechLanguage || "auto";
  }
}

function updateMobileUiForMode() {
  const isManual = settings.controlMode === "manual";
  const mobileAuto = document.getElementById("mobile-mode-auto-btn");
  const mobileManual = document.getElementById("mobile-mode-manual-btn");
  if (mobileAuto && mobileManual) {
    if (isManual) {
      mobileAuto.className = "px-2 py-0.5 rounded font-semibold transition-colors text-zinc-400 hover:text-zinc-200";
      mobileManual.className = "px-2 py-0.5 rounded font-semibold transition-colors bg-rose-600 text-white";
    } else {
      mobileAuto.className = "px-2 py-0.5 rounded font-semibold transition-colors bg-emerald-600 text-white";
      mobileManual.className = "px-2 py-0.5 rounded font-semibold transition-colors text-zinc-400 hover:text-zinc-200";
    }
  }
}

// Bind Compact Mobile Top Bar elements
const mobileMenuBtn = document.getElementById("mobile-menu-btn");
const mobileModeAutoBtn = document.getElementById("mobile-mode-auto-btn");
const mobileModeManualBtn = document.getElementById("mobile-mode-manual-btn");
const mobileSpeechLanguageSelect = document.getElementById("mobile-speech-language-select") as HTMLSelectElement | null;

if (mobileMenuBtn) {
  mobileMenuBtn.addEventListener("click", () => {
    setSidebarState(!settings.hideControls);
  });
}
if (mobileModeAutoBtn) {
  mobileModeAutoBtn.addEventListener("click", () => {
    applyControlMode("auto");
  });
}
if (mobileModeManualBtn) {
  mobileModeManualBtn.addEventListener("click", () => {
    applyControlMode("manual");
  });
}
if (mobileSpeechLanguageSelect) {
  mobileSpeechLanguageSelect.addEventListener("change", (e: any) => {
    settings.speechLanguage = e.target.value as any;
    saveSettings();
    if (speechLanguageSelect) {
      speechLanguageSelect.value = e.target.value;
    }
  });
}

bindButton(resetScrollBtn, () => {
  setVisualScrollTop(0, true);
});

bindButton(quickMirrorBtn, () => {
  cycleMirrorMode();
});

bindButton(fullscreenBtn, () => {
  toggleFullscreen();
});

bindButton(hideControlsBtn, () => {
  setSidebarState(!settings.hideControls);
});

bindButton(collapseBtnSidebar, () => {
  setSidebarState(true);
});

bindButton(expandSidebarBtn, () => {
  setSidebarState(false);
});

if (sidebarBackdrop) {
  bindButton(sidebarBackdrop, () => {
    setSidebarState(true);
  });
}

// ============================================================================
// PUSH-TO-TALK (PTT) VOICE INPUT SYSTEM
// ============================================================================

let isSpacePressed = false;
let spacePressedTime = 0;
let isPTTRecording = false;
let pttIndicator: HTMLDivElement | null = null;

// Audio context recording resources
let activeAudioContext: AudioContext | null = null;
let activeAudioStream: MediaStream | null = null;
let activeProcessorNode: ScriptProcessorNode | null = null;
let activeSourceNode: MediaStreamAudioSourceNode | null = null;
let recordedPCMChunks: Float32Array[] = [];
let totalRecordedSamples = 0;

function createPttIndicator() {
  if (document.getElementById("ptt-indicator")) return;
  
  pttIndicator = document.createElement("div");
  pttIndicator.id = "ptt-indicator";
  pttIndicator.className = "fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-zinc-900/95 border border-emerald-500/50 backdrop-blur-md px-5 py-3 rounded-2xl flex items-center space-x-3 shadow-2xl pointer-events-none hidden transition-all duration-150 transform scale-95 opacity-0";
  pttIndicator.innerHTML = `
    <div class="w-3 h-3 bg-rose-500 rounded-full animate-pulse"></div>
    <span class="font-sans text-sm font-semibold text-zinc-100 tracking-wide">🎤 Listening...</span>
  `;
  document.body.appendChild(pttIndicator);
}

function showPttIndicator() {
  if (!pttIndicator) createPttIndicator();
  if (pttIndicator) {
    pttIndicator.classList.remove("hidden");
    // Force CSS reflow
    void pttIndicator.offsetWidth;
    pttIndicator.classList.remove("scale-95", "opacity-0");
    pttIndicator.classList.add("scale-100", "opacity-100");
  }
}

function hidePttIndicator() {
  if (pttIndicator) {
    pttIndicator.classList.remove("scale-100", "opacity-100");
    pttIndicator.classList.add("scale-95", "opacity-0");
    // Hide after animation finishes
    setTimeout(() => {
      if (pttIndicator && !pttIndicator.classList.contains("opacity-100")) {
        pttIndicator.classList.add("hidden");
      }
    }, 150);
  }
}

function showToast(message: string, type: "error" | "info" | "success" = "info") {
  const toast = document.createElement("div");
  toast.className = `fixed bottom-10 left-1/2 -translate-x-1/2 z-50 px-6 py-3.5 rounded-xl border backdrop-blur-md shadow-2xl transition-all duration-300 flex items-center space-x-3 transform translate-y-4 opacity-0`;
  
  if (type === "error") {
    toast.className += " bg-rose-950/95 border-rose-500/50 text-rose-200";
  } else if (type === "success") {
    toast.className += " bg-emerald-950/95 border-emerald-500/50 text-emerald-200";
  } else {
    toast.className += " bg-zinc-900/95 border-zinc-700 text-zinc-200";
  }
  
  toast.innerHTML = `
    <span>${type === "error" ? "❌" : type === "success" ? "✅" : "ℹ️"}</span>
    <span class="font-sans text-sm font-medium">${message}</span>
  `;
  document.body.appendChild(toast);
  
  // Animate in
  void toast.offsetWidth;
  toast.classList.remove("translate-y-4", "opacity-0");
  toast.classList.add("translate-y-0", "opacity-100");
  
  // Animate out
  setTimeout(() => {
    toast.classList.remove("translate-y-0", "opacity-100");
    toast.classList.add("translate-y-4", "opacity-0");
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// ============================================================================
// ALWAYS LISTEN VOICE MODE (WITH AUTOMATIC VAD & BOUNDARY DETECTION)
// ============================================================================

let isAlwaysListenEnabled = false;
let alwaysListenAudioContext: AudioContext | null = null;
let alwaysListenAudioStream: MediaStream | null = null;
let alwaysListenProcessorNode: ScriptProcessorNode | null = null;
let alwaysListenSourceNode: MediaStreamAudioSourceNode | null = null;

// Buffering state
let alwaysListenPCMChunks: Float32Array[] = [];
let alwaysListenTotalSamples = 0;

// VAD algorithm parameters
const VAD_RMS_THRESHOLD = 0.015; // Noise threshold
const VAD_SILENCE_DURATION_MS = 1200; // Silence threshold (optimized to 1200ms to allow natural pauses)
const VAD_MIN_SPEECH_DURATION_MS = 200; // Min speech duration

let isUserSpeaking = false;
let silenceStartTime: number | null = null;
let speechStartTime: number | null = null;

// Intelligent Endpoint State Variables
let alwaysListenAccumulatedTranscript = "";
let alwaysListenSendTimeout: any = null;
let wakeLock: any = null;

// ============================================================================
// INTELLIGENT ENDPOINT ENGINE & QUESTION COMPLETION ANALYZER
// ============================================================================

interface EndpointDecision {
  isComplete: boolean;
  confidence: number; // 0.0 to 1.0
  adaptiveSilenceMs: number; // dynamically calculated continuation window
  reason: string;
}

class IntelligentEndpointEngine {
  /**
   * Evaluates if a given transcript represents a completed, well-formed question or thought.
   * Leverages linguistic heuristics, grammar patterns, structural boundaries, and conversation context.
   * Fully supports English (en-US) and Arabic (ar-SA).
   */
  static analyze(text: string): EndpointDecision {
    const trimmed = text.trim();
    if (!trimmed) {
      return { isComplete: false, confidence: 0, adaptiveSilenceMs: 3000, reason: "Empty input" };
    }

    const lowercase = trimmed.toLowerCase();
    
    // Clean text of basic punctuation for word tokenization
    const cleanText = lowercase.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?؟]/g, "");
    const words = cleanText.split(/\s+/).filter(Boolean);
    
    if (words.length === 0) {
      return { isComplete: false, confidence: 0, adaptiveSilenceMs: 3000, reason: "No words parsed" };
    }

    const lastWord = words[words.length - 1];
    const firstWord = words[0];

    // Detect if text contains Arabic characters
    const isArabic = /[\u0600-\u06FF]/.test(trimmed);

    let confidence = 0.8; // Baseline confidence
    let reason = "Standard conversational statement";

    if (isArabic) {
      // Arabic incomplete ending words (prepositions, conjunctions, and particles)
      const arabicIncompleteEndingWords = new Set([
        "في", "على", "من", "إلى", "عن", "مع", "ثم", "و", "أو", "لكن", "لأن", "إذا", "لو", "أن", "إن", "يا", "بـ", "لـ", "كـ"
      ]);

      // Arabic starters (interrogative particles and imperative verbs)
      const arabicStarters = new Set([
        "كيف", "ماذا", "لماذا", "من", "متى", "أين", "كم", "هل", "أشرح", "اشرح", "صف", "لخص", "قارن", "ساعدني"
      ]);

      // Arabic incomplete trailing phrases
      const arabicIncompletePhrases = [
        "أريد أن", "اريد ان", "هل يمكنك أن", "هل يمكنك ان", "تحدث عن", "اشرح لي", "أخبرني عن", "اخبرني عن"
      ];

      if (arabicIncompleteEndingWords.has(lastWord)) {
        confidence = 0.25;
        reason = `Incomplete (Arabic): ends with trailing transition/helper word "${lastWord}"`;
      } else if (arabicIncompletePhrases.some(phrase => lowercase.endsWith(phrase))) {
        confidence = 0.15;
        reason = "Incomplete (Arabic): ends with trailing incomplete transition phrase";
      } else if (words.length < 3) {
        const isOneWordCommand = /^(اشرح|صف|لخص|توقف|نعم|لا)$/i.test(trimmed);
        if (isOneWordCommand) {
          confidence = 0.95;
          reason = "Complete (Arabic): standard single-word instruction/command";
        } else {
          confidence = 0.35;
          reason = "Incomplete (Arabic): phrase is too short to represent a complete question";
        }
      } else {
        const startsWithStarter = arabicStarters.has(firstWord);
        const endsWithPunctuation = trimmed.endsWith("؟") || trimmed.endsWith("?");
        
        if (startsWithStarter && endsWithPunctuation) {
          confidence = 0.98;
          reason = "Complete (Arabic): well-formed question with terminal punctuation";
        } else if (startsWithStarter) {
          confidence = 0.92;
          reason = "Complete (Arabic): starts with a standard command or question word";
        } else if (endsWithPunctuation) {
          confidence = 0.88;
          reason = "Complete (Arabic): has proper ending punctuation";
        }
      }
    } else {
      // English / Standard Latin heuristic analysis
      const incompleteEndingWords = new Set([
        "about", "explain", "is", "are", "was", "were", "because", "to", "for", "with",
        "the", "a", "an", "and", "or", "but", "so", "if", "then", "of", "on", "at", "by",
        "from", "as", "than", "like", "such", "your", "my", "our", "their", "his", "her", "its",
        "can", "could", "would", "should", "will", "shall", "may", "might", "must", "have", "has", "had",
        "who", "what", "where", "when", "why", "how", "which", "whose", "whom", "this", "that", "these", "those"
      ]);

      const incompleteTrailingPhrases = [
        "tell me about",
        "can you explain",
        "explain to me",
        "the first thing is",
        "one thing is",
        "if i were",
        "such as",
        "for example",
        "in order to",
        "as long as",
        "because of",
        "with respect to",
        "in terms of",
        "i want to",
        "could you please",
        "can you show",
        "what about",
        "how do you"
      ];

      const commandOrQuestionStarters = new Set([
        "how", "what", "why", "who", "where", "when", "can", "could", "would", "should",
        "is", "are", "do", "does", "did", "will", "explain", "describe", "tell", "show",
        "compare", "summarize", "create", "write", "analyze", "give", "help", "list"
      ]);

      if (incompleteEndingWords.has(lastWord)) {
        confidence = 0.25;
        reason = `Incomplete: ends with trailing transition/helper word "${lastWord}"`;
      } else if (incompleteTrailingPhrases.some(phrase => lowercase.endsWith(phrase))) {
        confidence = 0.15;
        reason = "Incomplete: ends with trailing incomplete transition phrase";
      } else if (words.length < 3) {
        const isOneWordCommand = /^(explain|describe|summarize|stop|pause|resume|next|previous|yes|no)$/i.test(trimmed);
        if (isOneWordCommand) {
          confidence = 0.95;
          reason = "Complete: standard single-word instruction/command";
        } else {
          confidence = 0.35;
          reason = "Incomplete: phrase is too short to represent a complete question";
        }
      } else {
        const startsWithStarter = commandOrQuestionStarters.has(firstWord);
        const endsWithPunctuation = trimmed.endsWith("?") || trimmed.endsWith(".");
        
        if (startsWithStarter && endsWithPunctuation) {
          confidence = 0.98;
          reason = "Complete: well-formed question/command with terminal punctuation";
        } else if (startsWithStarter) {
          confidence = 0.92;
          reason = "Complete: starts with a standard command or question word";
        } else if (endsWithPunctuation) {
          confidence = 0.88;
          reason = "Complete: has proper ending punctuation";
        }
      }
    }

    // Adjust confidence based on punctuation cues (often provided by Azure STT)
    if (trimmed.endsWith("?") || trimmed.endsWith("؟")) {
      confidence = Math.min(1.0, confidence + 0.1);
    } else if (trimmed.endsWith(",")) {
      confidence = Math.max(0.0, confidence - 0.35);
    }

    // Determine completion and calculate Adaptive Silence window based on confidence
    const isComplete = confidence >= 0.7;
    let adaptiveSilenceMs = 1500; // default continuation window

    if (confidence >= 0.9) {
      adaptiveSilenceMs = 800; // Highly confident, trigger faster
    } else if (confidence >= 0.7) {
      adaptiveSilenceMs = 1500; // Moderately confident
    } else {
      adaptiveSilenceMs = 4000; // Low confidence, wait longer for continuation
    }

    return {
      isComplete,
      confidence: parseFloat(confidence.toFixed(2)),
      adaptiveSilenceMs,
      reason
    };
  }
}

let alwaysListenActiveMetrics: any = null;

function updateAlwaysListenStatus(status: "listening" | "speech_detected" | "transcribing" | "sending_to_ai" | "ready" | "waiting_continuation" | "processing" | "understanding" | "generating" | "streaming", confidence?: number) {
  if (alwaysListenStatusSep && alwaysListenStatusIndicator && alwaysListenStatusText) {
    alwaysListenStatusSep.classList.remove("hidden");
    alwaysListenStatusIndicator.classList.remove("hidden");
    alwaysListenStatusText.classList.remove("hidden");
    
    // Reset indicator classes
    alwaysListenStatusIndicator.className = "w-2.5 h-2.5 rounded-full transition-all duration-300";
    
    switch (status) {
      case "listening":
        alwaysListenStatusIndicator.classList.add("bg-cyan-500", "animate-pulse");
        alwaysListenStatusText.textContent = "Listening...";
        alwaysListenStatusText.className = "text-cyan-400 font-medium";
        break;
      case "speech_detected":
        alwaysListenStatusIndicator.classList.add("bg-orange-500", "animate-bounce");
        alwaysListenStatusText.textContent = "Speech detected...";
        alwaysListenStatusText.className = "text-orange-400 font-medium font-bold animate-pulse";
        break;
      case "transcribing":
        alwaysListenStatusIndicator.classList.add("bg-purple-500", "animate-pulse");
        alwaysListenStatusText.textContent = "Transcribing...";
        alwaysListenStatusText.className = "text-purple-400 font-medium";
        break;
      case "processing":
        alwaysListenStatusIndicator.classList.add("bg-indigo-500", "animate-pulse");
        alwaysListenStatusText.textContent = "Processing speech...";
        alwaysListenStatusText.className = "text-indigo-400 font-medium";
        break;
      case "understanding":
        alwaysListenStatusIndicator.classList.add("bg-pink-500", "animate-pulse");
        alwaysListenStatusText.textContent = "Understanding...";
        alwaysListenStatusText.className = "text-pink-400 font-medium";
        break;
      case "generating":
        alwaysListenStatusIndicator.classList.add("bg-yellow-500", "animate-pulse");
        alwaysListenStatusText.textContent = "Generating answer...";
        alwaysListenStatusText.className = "text-yellow-400 font-medium";
        break;
      case "streaming":
        alwaysListenStatusIndicator.classList.add("bg-emerald-500", "animate-bounce");
        alwaysListenStatusText.textContent = "Streaming answer...";
        alwaysListenStatusText.className = "text-emerald-400 font-medium font-bold animate-pulse";
        break;
      case "sending_to_ai":
        alwaysListenStatusIndicator.classList.add("bg-yellow-500", "animate-pulse");
        alwaysListenStatusText.textContent = "Sending to AI...";
        alwaysListenStatusText.className = "text-yellow-400 font-medium";
        break;
      case "ready":
        alwaysListenStatusIndicator.classList.add("bg-green-500");
        const confStr = confidence !== undefined ? ` (Conf: ${confidence})` : "";
        alwaysListenStatusText.textContent = `Ready${confStr}`;
        alwaysListenStatusText.className = "text-green-400 font-medium";
        
        // After 3 seconds, transition back to listening if still enabled
        setTimeout(() => {
          if (!isAlwaysListenEnabled && alwaysListenStatusText.textContent.startsWith("Ready")) {
            alwaysListenStatusSep.classList.add("hidden");
            alwaysListenStatusIndicator.classList.add("hidden");
            alwaysListenStatusText.classList.add("hidden");
          } else if (isAlwaysListenEnabled && alwaysListenStatusText.textContent.startsWith("Ready")) {
            updateAlwaysListenStatus("listening");
          }
        }, 3000);
        break;
      case "waiting_continuation":
        alwaysListenStatusIndicator.classList.add("bg-zinc-500", "animate-pulse");
        const confWStr = confidence !== undefined ? ` (Conf: ${confidence})` : "";
        alwaysListenStatusText.textContent = `Waiting for continuation${confWStr}`;
        alwaysListenStatusText.className = "text-zinc-400 font-medium italic animate-pulse";
        break;
    }
  }

  // --- MOBILE FAB & STATUS UPDATE ---
  const mobileFabMic = document.getElementById("mobile-fab-mic");
  const mobileFabIcon = document.getElementById("mobile-fab-icon");
  const mobileFabPulse = document.getElementById("mobile-fab-pulse");
  
  if (mobileFabMic && settings.controlMode === "auto") {
    // Reset classes
    mobileFabMic.className = "flex md:hidden fixed bottom-20 right-6 w-14 h-14 rounded-full shadow-2xl border items-center justify-center transition-all duration-300 z-30 select-none touch-none";
    if (mobileFabPulse) mobileFabPulse.className = "absolute inset-0 rounded-full animate-ping opacity-0";
    
    switch (status) {
      case "listening":
        mobileFabMic.classList.add("bg-cyan-950/60", "border-cyan-500/80", "text-cyan-400");
        if (mobileFabPulse) mobileFabPulse.className = "absolute inset-0 rounded-full bg-cyan-500/30 animate-ping opacity-100";
        if (mobileFabIcon) mobileFabIcon.textContent = "🎤";
        break;
      case "speech_detected":
        mobileFabMic.classList.add("bg-orange-950/60", "border-orange-500/80", "text-orange-400", "animate-bounce");
        if (mobileFabPulse) mobileFabPulse.className = "absolute inset-0 rounded-full bg-orange-500/30 animate-ping opacity-100";
        if (mobileFabIcon) mobileFabIcon.textContent = "🗣️";
        break;
      case "transcribing":
      case "processing":
        mobileFabMic.classList.add("bg-purple-950/60", "border-purple-500/80", "text-purple-400", "animate-pulse");
        if (mobileFabIcon) mobileFabIcon.textContent = "⏳";
        break;
      case "understanding":
      case "sending_to_ai":
        mobileFabMic.classList.add("bg-yellow-950/60", "border-yellow-500/80", "text-yellow-400", "animate-pulse");
        if (mobileFabIcon) mobileFabIcon.textContent = "🧠";
        break;
      case "generating":
      case "streaming":
        mobileFabMic.classList.add("bg-emerald-950/60", "border-emerald-500/80", "text-emerald-400", "animate-pulse");
        if (mobileFabPulse) mobileFabPulse.className = "absolute inset-0 rounded-full bg-emerald-500/30 animate-ping opacity-100";
        if (mobileFabIcon) mobileFabIcon.textContent = "✍️";
        break;
      case "ready":
        mobileFabMic.classList.add("bg-green-950/60", "border-green-500/80", "text-green-400");
        if (mobileFabIcon) mobileFabIcon.textContent = "✅";
        break;
      case "waiting_continuation":
        mobileFabMic.classList.add("bg-zinc-800", "border-zinc-700/50", "text-zinc-400", "animate-pulse");
        if (mobileFabIcon) mobileFabIcon.textContent = "💬";
        break;
    }
  }
}

async function startAlwaysListen() {
  if (isAlwaysListenEnabled) return;

  // Make sure we stop PTT first if active
  if (isPTTRecording) {
    stopPttRecording();
  }

  isAlwaysListenEnabled = true;

  if (alwaysListenToggleBtn && alwaysListenBtnText && alwaysListenIcon) {
    alwaysListenToggleBtn.classList.remove("bg-zinc-800", "hover:bg-zinc-700", "text-zinc-300");
    alwaysListenToggleBtn.classList.add("bg-red-950/40", "border-red-500/50", "text-red-400");
    alwaysListenIcon.textContent = "🛑";
    alwaysListenBtnText.textContent = "Stop Listening";
  }

  updateAlwaysListenStatus("listening");

  // Instantiating AudioContext synchronously inside user gesture scope
  try {
    alwaysListenAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    console.log("[AlwaysListen] AudioContext instantiated synchronously in user gesture. State:", alwaysListenAudioContext.state);
  } catch (err: any) {
    console.error("[AlwaysListen] Failed to instantiate AudioContext synchronously:", err);
  }

  // Request Wake Lock if supported
  if ('wakeLock' in navigator) {
    try {
      wakeLock = await (navigator as any).wakeLock.request('screen');
      console.log("[AlwaysListen] Screen Wake Lock acquired successfully.");
    } catch (err: any) {
      console.warn("[AlwaysListen] Failed to acquire Screen Wake Lock:", err);
    }
  }

  try {
    alwaysListenAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    console.log("[AlwaysListen] Microphone access GRANTED (high-quality raw constraints).");

    if (!isAlwaysListenEnabled) {
      console.log("[AlwaysListen] Aborted alwaysListen initialization since it was stopped while permission was pending.");
      if (alwaysListenAudioStream) {
        alwaysListenAudioStream.getTracks().forEach((track) => track.stop());
        alwaysListenAudioStream = null;
      }
      return;
    }

    if (!alwaysListenAudioContext) {
      alwaysListenAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    }

    if (alwaysListenAudioContext.state === "suspended") {
      console.log("[AlwaysListen] AudioContext is suspended. Attempting to resume...");
      await alwaysListenAudioContext.resume().catch((e) => {
        console.warn("[AlwaysListen] Failed to resume AudioContext immediately. Will auto-recover on interaction.", e);
      });
    }

    alwaysListenSourceNode = alwaysListenAudioContext.createMediaStreamSource(alwaysListenAudioStream);
    alwaysListenProcessorNode = alwaysListenAudioContext.createScriptProcessor(4096, 1, 1);

    alwaysListenPCMChunks = [];
    alwaysListenTotalSamples = 0;
    let alwaysListenPreRollChunks: Float32Array[] = [];

    isUserSpeaking = false;
    silenceStartTime = null;
    speechStartTime = null;

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    let dynamicNoiseFloor = 0.005;

    alwaysListenProcessorNode.onaudioprocess = (event) => {
      if (!isAlwaysListenEnabled) return;

      const inputChannel = event.inputBuffer.getChannelData(0);

      // Calculate RMS for VAD
      let sumSquare = 0;
      for (let i = 0; i < inputChannel.length; i++) {
        sumSquare += inputChannel[i] * inputChannel[i];
      }
      const rms = Math.sqrt(sumSquare / inputChannel.length);
      
      let threshold = VAD_RMS_THRESHOLD;
      if (isMobile) {
        // Mobile-specific adaptive threshold tracking slow-moving minimum background noise floor
        if (rms < dynamicNoiseFloor) {
          dynamicNoiseFloor = 0.95 * dynamicNoiseFloor + 0.05 * rms;
        } else {
          dynamicNoiseFloor = 0.999 * dynamicNoiseFloor + 0.001 * rms;
        }
        dynamicNoiseFloor = Math.max(0.001, Math.min(0.02, dynamicNoiseFloor));
        threshold = Math.max(0.006, dynamicNoiseFloor * 2.5);
      }

      const isAboveThreshold = rms > threshold;
      const now = Date.now();

      if (isAboveThreshold) {
        if (!isUserSpeaking) {
          isUserSpeaking = true;
          speechStartTime = now;
          silenceStartTime = null;
          console.log(`[AlwaysListen] Speech DETECTED! (RMS: ${rms.toFixed(4)}, Threshold: ${threshold.toFixed(4)})`);

          // Cancel any scheduled send timeouts because user has started speaking again
          if (alwaysListenSendTimeout) {
            clearTimeout(alwaysListenSendTimeout);
            alwaysListenSendTimeout = null;
            console.log("[AlwaysListen] Cancelled scheduled send due to incoming continuation speech.");
          }

          // Seed the active audio chunks with pre-roll history to avoid cutting off start of utterance
          alwaysListenPCMChunks = [...alwaysListenPreRollChunks];
          alwaysListenTotalSamples = alwaysListenPCMChunks.reduce((sum, c) => sum + c.length, 0);
          alwaysListenPreRollChunks = [];

          updateAlwaysListenStatus("speech_detected");
        } else {
          silenceStartTime = null;
        }

        // Buffer audio active chunks
        alwaysListenPCMChunks.push(new Float32Array(inputChannel));
        alwaysListenTotalSamples += inputChannel.length;
      } else {
        // Below noise threshold
        if (isUserSpeaking) {
          if (silenceStartTime === null) {
            silenceStartTime = now;
          } else if (now - silenceStartTime >= VAD_SILENCE_DURATION_MS) {
            // Silence reached -> Commit and dispatch utterance
            console.log("[AlwaysListen] Silence limit reached. Committing utterance...");

            const speechDuration = now - VAD_SILENCE_DURATION_MS - (speechStartTime || now);
            const chunksToProcess = [...alwaysListenPCMChunks];
            const totalSamplesToProcess = alwaysListenTotalSamples;

            // Reset buffers immediately to prepare for next sentence without delay
            isUserSpeaking = false;
            silenceStartTime = null;
            speechStartTime = null;
            alwaysListenPCMChunks = [];
            alwaysListenTotalSamples = 0;
            alwaysListenPreRollChunks = [];

            updateAlwaysListenStatus("transcribing");

            if (speechDuration >= VAD_MIN_SPEECH_DURATION_MS && chunksToProcess.length > 0) {
              processAlwaysListenUtterance(chunksToProcess, totalSamplesToProcess);
            } else {
              console.log("[AlwaysListen] Utterance too short/empty. Resuming listening.");
              if (alwaysListenAccumulatedTranscript) {
                updateAlwaysListenStatus("waiting_continuation");
              } else {
                updateAlwaysListenStatus("listening");
              }
            }
          } else {
            // Silence buffer period (user might have paused speaking, keep buffering)
            alwaysListenPCMChunks.push(new Float32Array(inputChannel));
            alwaysListenTotalSamples += inputChannel.length;
          }
        } else {
          // Slide pre-roll buffer of past silence chunks
          alwaysListenPreRollChunks.push(new Float32Array(inputChannel));
          if (alwaysListenPreRollChunks.length > 3) {
            alwaysListenPreRollChunks.shift();
          }
        }
      }
    };

    alwaysListenSourceNode.connect(alwaysListenProcessorNode);
    alwaysListenProcessorNode.connect(alwaysListenAudioContext.destination);
    console.log("[AlwaysListen] Ready. Monitoring mic with Voice Activity Detection.");

  } catch (err: any) {
    console.error("[AlwaysListen] Initialization error:", err);
    showToast(`Always Listen failed to start: ${err.message || String(err)}`, "error");
    stopAlwaysListen();
  }
}

async function processAlwaysListenUtterance(chunks: Float32Array[], totalLength: number) {
  try {
    const sampleRate = alwaysListenAudioContext ? alwaysListenAudioContext.sampleRate : 16000;
    const speechDuration = Math.round((totalLength / sampleRate) * 1000);
    const startProcessingTime = Date.now();

    updateAlwaysListenStatus("processing");

    const wavBlob = getWavBlob(chunks, totalLength, sampleRate);
    console.log(`[AlwaysListen] WAV created. Size: ${wavBlob.size} bytes. Duration: ${speechDuration}ms`);

    const response = await fetch(`/api/azure-stt?duration=${speechDuration}&language=${settings.speechLanguage || "auto"}`, {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
      },
      body: wavBlob,
    });

    if (!response.ok) {
      const errRes = await response.json().catch(() => ({}));
      console.error("[AlwaysListen] Transcription API failed:", errRes.error);
      if (alwaysListenAccumulatedTranscript) {
        updateAlwaysListenStatus("waiting_continuation");
      } else {
        updateAlwaysListenStatus("listening");
      }
      return;
    }

    const resData = await response.json();
    const transcript = (resData.text || "").trim();
    console.log(`[AlwaysListen] Output text: "${transcript}"`);

    const speechProcessingTime = Date.now() - startProcessingTime;
    alwaysListenActiveMetrics = {
      speechDuration,
      azureSttTime: resData.metrics?.azureSttTime || 0,
      speechProcessingTime
    };

    if (!transcript) {
      console.log("[AlwaysListen] Silent or blank, ignoring.");
      if (alwaysListenAccumulatedTranscript) {
        updateAlwaysListenStatus("waiting_continuation");
      } else {
        updateAlwaysListenStatus("listening");
      }
      return;
    }

    // Cancel any previous pending send timeout before analyzing the merged text
    if (alwaysListenSendTimeout) {
      clearTimeout(alwaysListenSendTimeout);
      alwaysListenSendTimeout = null;
    }

    const currentCandidate = alwaysListenAccumulatedTranscript 
      ? alwaysListenAccumulatedTranscript + " " + transcript 
      : transcript;

    // Use Intelligent Endpoint Engine to evaluate completion
    const decision = IntelligentEndpointEngine.analyze(currentCandidate);
    console.log(`[AlwaysListen] Intelligent Endpoint Decision:`, decision);

    if (decision.isComplete) {
      updateAlwaysListenStatus("ready", decision.confidence);
      console.log(`[AlwaysListen] Thought is COMPLETE. Scheduling AI query in ${decision.adaptiveSilenceMs}ms.`);
      alwaysListenSendTimeout = setTimeout(async () => {
        await executeAlwaysListenSend(currentCandidate);
      }, decision.adaptiveSilenceMs);
    } else {
      alwaysListenAccumulatedTranscript = currentCandidate;
      updateAlwaysListenStatus("waiting_continuation", decision.confidence);
      console.log(`[AlwaysListen] Thought is INCOMPLETE. Waiting for continuation. Fallback send in 7000ms.`);
      
      alwaysListenSendTimeout = setTimeout(async () => {
        console.log("[AlwaysListen] Fallback silence reached for incomplete thought. Sending anyway.");
        await executeAlwaysListenSend(currentCandidate);
      }, 7000);
    }

  } catch (err: any) {
    console.error("[AlwaysListen] Utterance process exception:", err);
    showToast(`Always Listen failed: ${err.message || String(err)}`, "error");
    if (alwaysListenAccumulatedTranscript) {
      updateAlwaysListenStatus("waiting_continuation");
    } else {
      updateAlwaysListenStatus("listening");
    }
  }
}

async function executeAlwaysListenSend(text: string) {
  if (!isAlwaysListenEnabled) return;

  if (alwaysListenSendTimeout) {
    clearTimeout(alwaysListenSendTimeout);
    alwaysListenSendTimeout = null;
  }

  // Reset accumulated transcript buffer after final trigger
  alwaysListenAccumulatedTranscript = "";

  updateAlwaysListenStatus("sending_to_ai");

  try {
    const queryResponse = await fetch("/api/webhook/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        userPrompt: text,
        metrics: alwaysListenActiveMetrics
      }),
    });

    if (!queryResponse.ok) {
      const errRes = await queryResponse.json().catch(() => ({}));
      showToast(errRes.error || `AI submit failed (${queryResponse.status})`, "error");
      updateAlwaysListenStatus("listening");
    } else {
      console.log("[AlwaysListen] Sent successfully.");
      updateAlwaysListenStatus("ready");
    }

  } catch (err: any) {
    console.error("[AlwaysListen] executeAlwaysListenSend exception:", err);
    showToast(`Always Listen failed: ${err.message || String(err)}`, "error");
    updateAlwaysListenStatus("listening");
  }
}

function stopAlwaysListen() {
  if (!isAlwaysListenEnabled) return;
  isAlwaysListenEnabled = false;

  if (alwaysListenSendTimeout) {
    clearTimeout(alwaysListenSendTimeout);
    alwaysListenSendTimeout = null;
  }

  // Release Screen Wake Lock safely
  if (wakeLock) {
    try {
      wakeLock.release();
    } catch (e) {}
    wakeLock = null;
    console.log("[AlwaysListen] Screen Wake Lock released.");
  }

  alwaysListenAccumulatedTranscript = "";

  if (alwaysListenToggleBtn && alwaysListenBtnText && alwaysListenIcon) {
    alwaysListenToggleBtn.classList.remove("bg-red-950/40", "border-red-500/50", "text-red-400");
    alwaysListenToggleBtn.classList.add("bg-zinc-800", "hover:bg-zinc-700", "text-zinc-300");
    alwaysListenIcon.textContent = "🎤";
    alwaysListenBtnText.textContent = "Always Listen";
  }

  if (alwaysListenStatusSep && alwaysListenStatusIndicator && alwaysListenStatusText) {
    alwaysListenStatusSep.classList.add("hidden");
    alwaysListenStatusIndicator.classList.add("hidden");
    alwaysListenStatusText.classList.add("hidden");
  }

  if (alwaysListenAudioStream) {
    alwaysListenAudioStream.getTracks().forEach((track) => track.stop());
    alwaysListenAudioStream = null;
  }
  if (alwaysListenProcessorNode) {
    alwaysListenProcessorNode.disconnect();
    alwaysListenProcessorNode = null;
  }
  if (alwaysListenSourceNode) {
    alwaysListenSourceNode.disconnect();
    alwaysListenSourceNode = null;
  }
  if (alwaysListenAudioContext) {
    try {
      alwaysListenAudioContext.close();
    } catch (e) {}
    alwaysListenAudioContext = null;
  }

  alwaysListenPCMChunks = [];
  alwaysListenTotalSamples = 0;
  isUserSpeaking = false;
  silenceStartTime = null;
  speechStartTime = null;

  console.log("[AlwaysListen] Deactivated. Microphone released.");
}

function isTypingInInput(): boolean {
  const activeEl = document.activeElement;
  if (!activeEl) return false;
  const tag = activeEl.tagName;
  if (tag === "TEXTAREA" || tag === "INPUT" || tag === "SELECT") {
    return true;
  }
  if (activeEl.hasAttribute("contenteditable") || activeEl.getAttribute("contenteditable") === "true") {
    return true;
  }
  return false;
}

// Simple and robust WAV file encoder from recorded Float32 PCM chunks
function getWavBlob(chunks: Float32Array[], totalLength: number, sampleRate: number): Blob {
  const combinedSamples = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combinedSamples.set(chunk, offset);
    offset += chunk.length;
  }

  // Peak Normalization to maximize digital dynamic range, signal-to-noise ratio, and raw ASR accuracy
  let maxAmp = 0;
  for (let i = 0; i < combinedSamples.length; i++) {
    const abs = Math.abs(combinedSamples[i]);
    if (abs > maxAmp) {
      maxAmp = abs;
    }
  }

  const targetPeak = 0.95;
  if (maxAmp > 0.0001 && maxAmp < targetPeak) {
    const scale = targetPeak / maxAmp;
    for (let i = 0; i < combinedSamples.length; i++) {
      combinedSamples[i] *= scale;
    }
    console.log(`[WAV Encoder] Normalized audio peak from ${maxAmp.toFixed(4)} to ${targetPeak} (scale: ${scale.toFixed(4)})`);
  }

  const buffer = new ArrayBuffer(44 + combinedSamples.length * 2);
  const view = new DataView(buffer);

  const writeString = (view: DataView, offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + combinedSamples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // 1 channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true); // 16-bit
  writeString(view, 36, "data");
  view.setUint32(40, combinedSamples.length * 2, true);

  let dataOffset = 44;
  for (let i = 0; i < combinedSamples.length; i++, dataOffset += 2) {
    const s = Math.max(-1, Math.min(1, combinedSamples[i]));
    view.setInt16(dataOffset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([view], { type: "audio/wav" });
}

async function startPttRecording() {
  if (isPTTRecording) return;

  // Stop Always Listen if active to prevent microphone conflicts
  if (isAlwaysListenEnabled) {
    stopAlwaysListen();
  }

  // 1. If the browser supports the Permissions API, check permission state
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const permissionStatus = await navigator.permissions.query({ name: "microphone" as any });
      console.log("[PTT Permission Status] Permissions API state:", permissionStatus.state);
      if (permissionStatus.state === "denied") {
        showToast("Microphone access is denied. Please enable microphone access in your browser settings to use Push-to-Talk.", "error");
        return;
      }
    } catch (err) {
      console.warn("[PTT Permission] Permissions API query warning:", err);
    }
  }

  // 2. Request microphone permission and configure active recording context
  console.log("[PTT Permission] Requesting microphone access via getUserMedia...");
  try {
    activeAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    console.log("[PTT Permission Status] Microphone access GRANTED (high-quality raw constraints).");
  } catch (err: any) {
    console.error("[PTT Permission Status] Microphone access DENIED or error:", err);
    showToast("Microphone access denied. Please allow microphone access in your browser settings to use Push-to-Talk.", "error");
    return;
  }

  // 3. Double-check if the SPACEBAR or Left Mouse Button is still pressed when permission check finishes
  const isCurrentlyHolding = settings.controlMode === "manual" ? isLeftMouseDown : isSpacePressed;
  if (!isCurrentlyHolding) {
    console.log("[PTT] Holding trigger was released before permission was resolved.");
    if (activeAudioStream) {
      activeAudioStream.getTracks().forEach((track) => track.stop());
      activeAudioStream = null;
    }
    return;
  }

  recordedPCMChunks = [];
  totalRecordedSamples = 0;
  isPTTRecording = true;
  showPttIndicator();

  try {
    activeAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    activeSourceNode = activeAudioContext.createMediaStreamSource(activeAudioStream);
    activeProcessorNode = activeAudioContext.createScriptProcessor(4096, 1, 1);

    activeProcessorNode.onaudioprocess = (event) => {
      if (!isPTTRecording) return;
      const inputChannel = event.inputBuffer.getChannelData(0);
      recordedPCMChunks.push(new Float32Array(inputChannel));
      totalRecordedSamples += inputChannel.length;
    };

    activeSourceNode.connect(activeProcessorNode);
    activeProcessorNode.connect(activeAudioContext.destination);
    console.log("[PTT] Pure JS WAV Audio capture initialized at 16000Hz.");
  } catch (err: any) {
    console.warn("[PTT Info] Failed to initialize AudioContext recording:", err);
    showToast(`Failed to start recording: ${err.message || String(err)}`, "error");
    isPTTRecording = false;
    hidePttIndicator();
    if (activeAudioStream) {
      activeAudioStream.getTracks().forEach((track) => track.stop());
      activeAudioStream = null;
    }
  }
}

async function stopPttRecording() {
  if (!isPTTRecording) return;
  isPTTRecording = false;
  hidePttIndicator();

  const chunks = recordedPCMChunks;
  const totalLength = totalRecordedSamples;
  const actualSampleRate = activeAudioContext ? activeAudioContext.sampleRate : 16000;

  // Clean up nodes and streams immediately to release microphone
  if (activeAudioStream) {
    activeAudioStream.getTracks().forEach((track) => track.stop());
    activeAudioStream = null;
  }
  if (activeProcessorNode) {
    activeProcessorNode.disconnect();
    activeProcessorNode = null;
  }
  if (activeSourceNode) {
    activeSourceNode.disconnect();
    activeSourceNode = null;
  }
  if (activeAudioContext) {
    try {
      activeAudioContext.close();
    } catch (e) {}
    activeAudioContext = null;
  }

  if (totalLength === 0 || chunks.length === 0) {
    console.warn("[PTT] No audio recorded.");
    return;
  }

  const speechDuration = Math.round((totalLength / actualSampleRate) * 1000);
  const startProcessingTime = Date.now();

  updateAlwaysListenStatus("processing");
  showToast("Transcribing speech...", "info");

  // WAV Blob creation using exact actual sample rate
  const wavBlob = getWavBlob(chunks, totalLength, actualSampleRate);
  console.log("[PTT]\nUploading WAV...");
  console.log(`[PTT] Completed WAV file generation. Size: ${wavBlob.size} bytes. Duration: ${speechDuration}ms`);

  try {
    const response = await fetch(`/api/azure-stt?duration=${speechDuration}&language=${settings.speechLanguage || "auto"}`, {
      method: "POST",
      headers: {
        "Content-Type": "audio/wav",
      },
      body: wavBlob,
    });

    if (!response.ok) {
      const errRes = await response.json().catch(() => ({}));
      showToast(errRes.error || `Azure transcription failed (${response.status})`, "error");
      updateAlwaysListenStatus("ready");
      return;
    }

    const resData = await response.json();
    const transcript = (resData.text || "").trim();
    console.log("[PTT]\nTranscription completed.");
    console.log(`[PTT] Azure Speech SDK output: "${transcript}"`);

    const speechProcessingTime = Date.now() - startProcessingTime;

    if (transcript) {
      const metrics = {
        speechDuration,
        azureSttTime: resData.metrics?.azureSttTime || 0,
        speechProcessingTime
      };
      await sendWebhookQuery(transcript, metrics);
    } else {
      showToast("No speech recognized by Azure.", "info");
      updateAlwaysListenStatus("ready");
    }
  } catch (err: any) {
    console.error("[PTT] Webhook/Azure fetch exception:", err);
    showToast(`Failed to transcribe: ${err.message || String(err)}`, "error");
    updateAlwaysListenStatus("ready");
  }
}

async function sendWebhookQuery(queryText: string, metrics?: any) {
  showToast(`Recognized: "${queryText.length > 40 ? queryText.substring(0, 40) + '...' : queryText}"`, "success");
  
  console.log("[PTT]\nSending prompt...");
  updateAlwaysListenStatus("sending_to_ai");

  try {
    const response = await fetch("/api/webhook/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        userPrompt: queryText,
        metrics
      }),
    });

    if (!response.ok) {
      const errRes = await response.json().catch(() => ({}));
      showToast(errRes.error || `Failed to submit query (${response.status})`, "error");
      updateAlwaysListenStatus("ready");
    } else {
      console.log("[PTT] Query successfully sent to webhook.");
    }
  } catch (err: any) {
    console.warn("[PTT Info] Webhook fetch exception:", err);
    showToast(`Failed to send query: ${err.message || String(err)}`, "error");
    updateAlwaysListenStatus("ready");
  }
}

// Keyboard Hotkey Interceptions
const keydownHandler = (e: KeyboardEvent) => {
  // Disable hotkeys when editing inputs or contenteditable elements
  if (isTypingInInput()) {
    return;
  }

  const key = e.key.toLowerCase();

  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    if (!isSpacePressed) {
      isSpacePressed = true;
      spacePressedTime = Date.now();
      startPttRecording();
    }
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    updateSpeed(Math.min(60, settings.scrollSpeed + 1));
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    updateSpeed(Math.max(1, settings.scrollSpeed - 1));
  } else if (key === "[") {
    e.preventDefault();
    updateFontSize(Math.max(20, settings.fontSize - 2));
  } else if (key === "]") {
    e.preventDefault();
    updateFontSize(Math.min(110, settings.fontSize + 2));
  } else if (key === "m") {
    e.preventDefault();
    cycleMirrorMode();
  } else if (key === "f") {
    e.preventDefault();
    toggleFullscreen();
  } else if (key === "h") {
    e.preventDefault();
    setSidebarState(!settings.hideControls);
  } else if (e.key === "Escape") {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      setVisualScrollTop(0, true);
    }
  }
};

const keyupHandler = (e: KeyboardEvent) => {
  if (e.code === "Space" || e.key === " ") {
    if (isTypingInInput()) {
      return;
    }

    e.preventDefault();

    if (isSpacePressed) {
      isSpacePressed = false;
      const duration = Date.now() - spacePressedTime;
      stopPttRecording();

      // If it was a quick tap (< 300ms), toggle auto-scroll
      if (duration < 300) {
        toggleAutoScroll(!settings.autoScroll);
      }
    }
  }
};

const logMouseEvent = (e: any) => {
  const type = e.type;
  const button = e.button;
  const buttons = e.buttons;
  const pointerType = e.pointerType;
  const which = e.which;
  const detail = e.detail;

  if (pointerType) {
    console.log(`${type}\nbutton=${button}\nbuttons=${buttons}\npointerType=${pointerType}\nwhich=${which}\ndetail=${detail}`);
  } else {
    console.log(`${type}\nbutton=${button}\nbuttons=${buttons}\nwhich=${which}\ndetail=${detail}`);
  }
};

const isInteractiveElement = (el: HTMLElement | null): boolean => {
  if (!el) return false;
  let current: HTMLElement | null = el;
  while (current && current !== document.body) {
    const tagName = current.tagName.toLowerCase();
    const id = current.id || "";
    const className = typeof current.className === "string" ? current.className : "";
    if (
      tagName === "button" ||
      tagName === "input" ||
      tagName === "select" ||
      tagName === "textarea" ||
      tagName === "a" ||
      id === "sidebar" ||
      id === "stage-header" ||
      id === "mobile-top-bar" ||
      id.includes("toast") ||
      className.includes("toast") ||
      current.getAttribute("role") === "button" ||
      className.includes("cursor-pointer")
    ) {
      return true;
    }
    current = current.parentElement;
  }
  return false;
};

const manualPointerDownHandler = (e: PointerEvent | MouseEvent) => {
  logMouseEvent(e);
  if (settings.controlMode !== "manual" || isTypingInInput()) return;
  
  // If it's a touch event, do not intercept left click to preserve touch scrolling
  if ('pointerType' in e && e.pointerType === 'touch') {
    return;
  }

  if (e.button === 0) { // Left mouse/pointer button
    const target = e.target as HTMLElement;
    if (isInteractiveElement(target)) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (!isLeftMouseDown) {
      isLeftMouseDown = true;
      console.log("[Manual Mode]\nLeft Button Down\nStarting recording...");
      startPttRecording();
    }
  }
};

const manualPointerUpHandler = (e: PointerEvent | MouseEvent) => {
  logMouseEvent(e);
  if (settings.controlMode !== "manual") return;
  
  if ('pointerType' in e && e.pointerType === 'touch') {
    return;
  }

  if (e.button === 0) { // Left mouse/pointer button
    if (isLeftMouseDown) {
      e.preventDefault();
      e.stopPropagation();
      isLeftMouseDown = false;
      console.log("[Manual Mode]\nLeft Button Up\nStopping recording...");
      stopPttRecording();
    }
  }
};

const manualPointerCancelHandler = (e: PointerEvent | MouseEvent) => {
  logMouseEvent(e);
  if (settings.controlMode !== "manual") return;
  
  if ('pointerType' in e && e.pointerType === 'touch') {
    return;
  }

  if (e.button === 0) { // Left mouse/pointer button
    if (isLeftMouseDown) {
      e.preventDefault();
      e.stopPropagation();
      isLeftMouseDown = false;
      console.log("[Manual Mode]\nLeft Button Up (Cancel)\nStopping recording...");
      stopPttRecording();
    }
  }
};

// ============================================================================
// MOBILE AUTO MODE: AUDIO INTERACTION, WAKE LOCK & BACKGROUND RESILIENCE HOOKS
// ============================================================================

const resumeAlwaysListenAudioContext = async () => {
  if (isAlwaysListenEnabled && alwaysListenAudioContext && alwaysListenAudioContext.state === "suspended") {
    console.log("[AlwaysListen] User interaction detected. Resuming AudioContext...");
    await alwaysListenAudioContext.resume().catch(e => console.error("[AlwaysListen] Interaction resume error:", e));
  }
};

const isStreamActive = (stream: MediaStream | null) => {
  if (!stream) return false;
  return stream.getTracks().some(track => track.readyState === 'live' && track.enabled);
};

const handleVisibilityChange = async () => {
  if (document.visibilityState === 'visible') {
    console.log("[Background Lifecycle] Tab/Window focused.");
    if (isAlwaysListenEnabled) {
      const isContextClosed = !alwaysListenAudioContext || alwaysListenAudioContext.state === 'closed';
      const isStreamDead = !isStreamActive(alwaysListenAudioStream);
      
      if (isContextClosed || isStreamDead) {
        console.log("[Background Lifecycle] Audio resources terminated in background. Recovering...");
        stopAlwaysListen();
        await startAlwaysListen();
      } else if (alwaysListenAudioContext && alwaysListenAudioContext.state === 'suspended') {
        console.log("[Background Lifecycle] Resuming suspended alwaysListenAudioContext.");
        await alwaysListenAudioContext.resume().catch(e => console.error(e));
      }
    }
  }
};

const handleDeviceChange = async () => {
  console.log("[Audio Devices] Input device change detected.");
  if (isAlwaysListenEnabled) {
    console.log("[Audio Devices] Re-routing Always Listen to new active input device...");
    stopAlwaysListen();
    await startAlwaysListen();
  }
};

const mobileFabHandler = () => {
  if (isAlwaysListenEnabled) {
    stopAlwaysListen();
  } else {
    startAlwaysListen();
  }
};

// Bind elements
const mobileFabMic = document.getElementById("mobile-fab-mic");
if (mobileFabMic) {
  mobileFabMic.addEventListener("click", mobileFabHandler);
}

window.addEventListener("click", resumeAlwaysListenAudioContext, { passive: true });
window.addEventListener("touchstart", resumeAlwaysListenAudioContext, { passive: true });
document.addEventListener("visibilitychange", handleVisibilityChange);
window.addEventListener("focus", handleVisibilityChange);
if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
}

window.addEventListener("keydown", keydownHandler);
window.addEventListener("keyup", keyupHandler);
window.addEventListener("pointerdown", manualPointerDownHandler, { passive: false });
window.addEventListener("pointerup", manualPointerUpHandler, { passive: false });
window.addEventListener("pointercancel", manualPointerCancelHandler, { passive: false });
window.addEventListener("mousedown", manualPointerDownHandler, { passive: false });
window.addEventListener("mouseup", manualPointerUpHandler, { passive: false });

// Expose cleanup function to window for professional cleanup/unmounting compatibility
(window as any).__cleanupPTT = () => {
  window.removeEventListener("keydown", keydownHandler);
  window.removeEventListener("keyup", keyupHandler);
  window.removeEventListener("pointerdown", manualPointerDownHandler);
  window.removeEventListener("pointerup", manualPointerUpHandler);
  window.removeEventListener("pointercancel", manualPointerCancelHandler);
  window.removeEventListener("mousedown", manualPointerDownHandler);
  window.removeEventListener("mouseup", manualPointerUpHandler);

  window.removeEventListener("click", resumeAlwaysListenAudioContext);
  window.removeEventListener("touchstart", resumeAlwaysListenAudioContext);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  window.removeEventListener("focus", handleVisibilityChange);
  if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
    navigator.mediaDevices.removeEventListener("devicechange", handleDeviceChange);
  }
  const mobileFabMicEl = document.getElementById("mobile-fab-mic");
  if (mobileFabMicEl) {
    mobileFabMicEl.removeEventListener("click", mobileFabHandler);
  }

  if (pttIndicator) {
    pttIndicator.remove();
  }
  isPTTRecording = false;
  
  // Call Always Listen cleanup
  try {
    stopAlwaysListen();
  } catch (e) {
    console.warn("[Cleanup] error during stopAlwaysListen:", e);
  }

  if (activeAudioStream) {
    activeAudioStream.getTracks().forEach((track) => track.stop());
    activeAudioStream = null;
  }
  if (activeProcessorNode) {
    activeProcessorNode.disconnect();
    activeProcessorNode = null;
  }
  if (activeSourceNode) {
    activeSourceNode.disconnect();
    activeSourceNode = null;
  }
  if (activeAudioContext) {
    try {
      activeAudioContext.close();
    } catch (e) {}
    activeAudioContext = null;
  }
};

// Support manual dragging on mobile or mouse scroll grab
let isDragging = false;
let startY = 0;
let startScrollTop = 0;

prompterScrollContainer.addEventListener("mousedown", (e: MouseEvent) => {
  // Only handle left clicks
  if (e.button !== 0) return;
  isDragging = true;
  startY = e.pageY - prompterScrollContainer.offsetTop;
  startScrollTop = getVisualScrollTop();
});

prompterScrollContainer.addEventListener("mouseleave", () => {
  isDragging = false;
});

prompterScrollContainer.addEventListener("mouseup", () => {
  isDragging = false;
});

prompterScrollContainer.addEventListener("mousemove", (e: MouseEvent) => {
  if (!isDragging) return;
  e.preventDefault();
  const y = e.pageY - prompterScrollContainer.offsetTop;
  const walk = (y - startY) * 1.5; // Scroll speed scaling factor
  setVisualScrollTop(startScrollTop - walk);
});

// Listen for window resizes to prevent scrolling offsets from shifting out of bounds
window.addEventListener("resize", () => {
  if (resizeTimeout) clearTimeout(resizeTimeout);
  const prevVisual = getVisualScrollTop();
  resizeTimeout = setTimeout(() => {
    setVisualScrollTop(prevVisual);
  }, 100);
});

// Intercept scroll wheel events when vertically mirrored or in manual mode to maintain correct visual scroll direction
prompterScrollContainer.addEventListener("wheel", (e: WheelEvent) => {
  if (e.ctrlKey) {
    e.preventDefault();
    if (e.deltaY < 0) {
      updateSpeed(settings.scrollSpeed + 0.5);
    } else {
      updateSpeed(settings.scrollSpeed - 0.5);
    }
    return;
  }
  if (isVerticallyMirrored() || settings.controlMode === "manual") {
    e.preventDefault();
    const currentVisual = getVisualScrollTop();
    setVisualScrollTop(currentVisual + e.deltaY);
  }
}, { passive: false });

// Global listener for Ctrl + Mousewheel speed adjustment anywhere
window.addEventListener("wheel", (e: WheelEvent) => {
  if (e.ctrlKey) {
    e.preventDefault();
    if (e.deltaY < 0) {
      updateSpeed(settings.scrollSpeed + 0.5);
    } else {
      updateSpeed(settings.scrollSpeed - 0.5);
    }
  }
}, { passive: false });

/**
 * Sync the latest AI response from the server on startup
 */
async function syncLatestResponse() {
  try {
    const response = await fetch("/api/latest-response");
    if (response.ok) {
      const data = await response.json();
      if (data && data.latestAiResponse && data.latestAiResponse !== "No response received yet.") {
        currentScript = data.latestAiResponse;
        if (scriptTextarea) {
          scriptTextarea.value = currentScript;
        }
        addCompletedBlock(currentScript);
        renderContent();
        saveSettings();
        console.log("[Rendering updated] Initial synced latest response rendered.");
        setTimeout(() => {
          centerNewestBlock(false);
        }, 100);
      }
    }
  } catch (error) {
    console.error("Failed to sync latest response on load:", error);
  }
}

/**
 * Setup Server-Sent Events (SSE) connection to listen for new AI responses in real-time
 */
function setupSseUpdates() {
  const streamUrl = "/api/updates";
  
  console.log("Connecting to SSE live updates channel at:", streamUrl);
  const es = new EventSource(streamUrl);

  es.onopen = () => {
    console.log("[Socket connected] SSE real-time sync stream connected successfully.");
    if (typeof updateConnectionStatus === "function") {
      updateConnectionStatus(true);
    }
  };

  es.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "stream_start") {
        console.log(`[DIAGNOSTIC - SSE STREAM START] New stream started for query: "${data.queryText}"`);
        isGenerating = true;
        updateAlwaysListenStatus("generating");
        currentScript = `# ────────────────────────────\n\n## 🎤 QUESTION\n${data.queryText}\n\n## 💡 ANSWER\n`;
        if (scriptTextarea) {
          scriptTextarea.value = currentScript;
        }
        console.log(`[DIAGNOSTIC - STATE UPDATE] Script content length after start: ${currentScript.length}`);
        renderContent();
      } else if (data.type === "stream_chunk" && data.text) {
        isGenerating = true;
        updateAlwaysListenStatus("streaming");
        currentScript += data.text;
        if (scriptTextarea) {
          scriptTextarea.value = currentScript;
        }
        console.log(`[DIAGNOSTIC - STATE UPDATE] Received chunk of size: ${data.text.length} | Script length: ${currentScript.length}`);
        renderContent();
      } else if (data.type === "stream_end") {
        console.log("[DIAGNOSTIC - SSE STREAM END] Stream finished successfully.");
        isGenerating = false;
        updateAlwaysListenStatus("ready");
        addCompletedBlock(currentScript);
        renderContent();
        saveSettings();
        setTimeout(() => {
          centerNewestBlock(true);
        }, 100);
      } else if (data.type === "stream_error") {
        console.error("[DIAGNOSTIC - SSE STREAM ERROR] Stream error received:", data.error);
        isGenerating = false;
        updateAlwaysListenStatus("ready");
        showToast(`AI generation failed: ${data.error}`, "error");
        renderContent();
      } else if (data.type === "update" && data.formattedQa) {
        console.log("[DIAGNOSTIC - SSE FULL UPDATE] SSE update received. Length:", data.formattedQa.length);
        isGenerating = false;
        currentScript = data.formattedQa;
        if (scriptTextarea) {
          scriptTextarea.value = currentScript;
        }
        console.log(`[DIAGNOSTIC - STATE UPDATE] Script content fully updated, length: ${currentScript.length}`);
        addCompletedBlock(currentScript);
        renderContent();
        saveSettings();
        console.log("[Rendering updated] Teleprompter view updated with new Q&A.");
        setTimeout(() => {
          centerNewestBlock(true);
        }, 100);
      }
    } catch (err) {
      // Fail silently or handle unexpected non-JSON packages gracefully
    }
  };

  es.onerror = (err) => {
    // EventSource has built-in automatic retry. We log a warning instead of a fatal console.error
    // to avoid false positives in testing suites when the server restarts or reloads.
    console.warn("[Socket connection update] SSE real-time sync stream reconnecting...", err);
    if (typeof updateConnectionStatus === "function") {
      updateConnectionStatus(false);
    }
  };
}

// Load AI settings from the backend single source of truth
async function loadBackendSettings() {
  try {
    const res = await fetch("/api/settings");
    if (res.ok) {
      const backendSettings = await res.json();
      
      // Override local settings with active backend settings
      settings.provider = backendSettings.provider ?? settings.provider;
      settings.apiKey = backendSettings.apiKey ?? settings.apiKey;
      settings.baseUrl = backendSettings.baseUrl ?? settings.baseUrl;
      settings.model = backendSettings.model ?? settings.model;
      settings.temperature = backendSettings.temperature ?? settings.temperature;
      settings.maxTokens = backendSettings.maxTokens ?? settings.maxTokens;
      settings.systemPrompt = backendSettings.systemPrompt ?? settings.systemPrompt;

      // Update local client tracker on successful backend fetch
      lastSyncedAiSettingsStr = JSON.stringify({
        provider: settings.provider,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
        temperature: settings.temperature,
        maxTokens: settings.maxTokens,
        systemPrompt: settings.systemPrompt,
      });

      // Update UI elements from updated settings state safely
      if (providerSelect) providerSelect.value = settings.provider;
      if (apiUrlInput) {
        apiUrlInput.value = settings.baseUrl;
        apiUrlInput.disabled = (settings.provider === "gemini");
        apiUrlInput.placeholder = (settings.provider === "gemini") ? "Native Gemini SDK used" : "";
      }
      if (apiKeyInput) apiKeyInput.value = settings.apiKey;
      if (modelNameInput) modelNameInput.value = settings.model;
      if (tempSlider) {
        tempSlider.value = String(settings.temperature);
        tempBadge.innerText = String(settings.temperature);
      }
      if (maxTokensInput) maxTokensInput.value = String(settings.maxTokens);
      if (systemPromptTextarea) systemPromptTextarea.value = settings.systemPrompt;
    }
  } catch (err) {
    console.error("Failed to load backend settings:", err);
  }
}

// Load, render, and start animation clock
async function init() {
  loadSettings();
  syncLatestResponse();
  setupSseUpdates();

  // Initialize mermaid configuration if loaded from CDN
  if (typeof (window as any).mermaid !== "undefined") {
    try {
      (window as any).mermaid.initialize({
        startOnLoad: false,
        theme: "dark",
        securityLevel: "loose",
        suppressErrors: true
      });
    } catch (err) {
      console.error("Mermaid initialization failed:", err);
    }
  }

  // Populate HTML elements from state
  scriptTextarea.value = currentScript;
  
  providerSelect.value = settings.provider;
  onProviderChange(settings.provider);
  
  apiUrlInput.value = settings.baseUrl;
  apiKeyInput.value = settings.apiKey;
  modelNameInput.value = settings.model;
  tempSlider.value = String(settings.temperature);
  tempBadge.innerText = String(settings.temperature);
  maxTokensInput.value = String(settings.maxTokens);
  systemPromptTextarea.value = settings.systemPrompt;
  if (speechLanguageSelect) speechLanguageSelect.value = settings.speechLanguage || "auto";

  updateSpeed(settings.scrollSpeed);
  updateFontSize(settings.fontSize);
  updateLineHeight(settings.lineHeight);
  updateSpacing(settings.paragraphSpacing);
  updateFontWeight(settings.fontWeight);
  applyMirrorMode(settings.mirrorMode);
  applyTheme(settings.theme);
  applyControlMode(settings.controlMode || "auto", true);
  setFocusMode(settings.focusMode);
  setSidebarState(settings.hideControls);

  // Initialise Mobile UI top bar
  if (typeof updateMobileLanguageBadge === "function") {
    updateMobileLanguageBadge();
  }
  if (typeof updateMobileUiForMode === "function") {
    updateMobileUiForMode();
  }

  setActiveTab("script");
  renderContent();

  // Load from backend single source of truth
  await loadBackendSettings();

  // Run the physics loops
  requestAnimationFrame(scrollLoop);
}

// Initialise App
init();
