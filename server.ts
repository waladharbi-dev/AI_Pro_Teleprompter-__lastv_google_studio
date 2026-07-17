import express, { Request, Response } from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import fs from "fs";
import os from "os";

// Global State Variable to store the last response received from the AI
let latestAiResponse: string = "No response received yet.";

// Array of active Server-Sent Events connections
let sseClients: Response[] = [];

// Keep-alive heartbeat interval for active SSE connections (every 15 seconds)
setInterval(() => {
  const active: Response[] = [];
  sseClients.forEach((client) => {
    try {
      client.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
      active.push(client);
    } catch (err) {
      // Clean up failing clients silently
    }
  });
  sseClients = active;
}, 15000);

interface AISettings {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
}

// Global active settings for the AI Engine
let activeSettings: AISettings = {
  provider: "gemini",
  apiKey: process.env.GEMINI_API_KEY || "",
  baseUrl: "",
  model: "gemini-3.1-flash-lite",
  temperature: 0.7,
  maxTokens: 2048,
  systemPrompt: "Answer concisely with a single short sentence or phrase. Do NOT use Markdown, headings, emojis, dividers, code blocks, or extra commentary.",
};
// ====================================================
// SPEECH LAYER ABSTRACTION (Step 12)
// ====================================================
interface SpeechTranscriptionResult {
  text: string;
  detectedLanguage?: string;
  confidence?: number;
  partialTranscripts?: string[];
}

interface ISpeechService {
  transcribeWav(buffer: Buffer, language?: string): Promise<SpeechTranscriptionResult>;
}

class AzureSpeechService implements ISpeechService {
  private key: string;
  private region: string;
  private speechConfig: sdk.SpeechConfig | null = null;
  private autoDetectConfig: sdk.AutoDetectSourceLanguageConfig | null = null;

  constructor() {
    this.key = process.env.AZURE_SPEECH_KEY || "";
    this.region = process.env.AZURE_SPEECH_REGION || "";
  }

  isConfigured(): boolean {
    return !!(this.key && this.region);
  }

  private getSpeechConfig(): sdk.SpeechConfig {
    if (!this.speechConfig) {
      this.speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);
      
      // 1. Enable Detailed output format to retrieve numeric transcription confidence scores (via NBest array in result JSON)
      this.speechConfig.outputFormat = sdk.OutputFormat.Detailed;
      
      // 2. Set Language ID Mode to "AtStart" as we submit short discrete WAV recordings of single sentences/commands.
      // This allows the service to determine the spoken language (English or Arabic) with maximum accuracy at the start,
      // preventing language switching errors or recognition confusion during short utterances.
      this.speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, "AtStart");
      
      // 3. Configure robust silence and segmentation timeouts to avoid premature cuts and NoMatch cases
      this.speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs, "6000");
      this.speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs, "3000");
      this.speechConfig.setProperty(sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs, "3000");
    }
    return this.speechConfig;
  }

  private getAutoDetectConfig(): sdk.AutoDetectSourceLanguageConfig {
    if (!this.autoDetectConfig) {
      // Support English and Arabic with automatic language detection
      this.autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages(["en-US", "ar-SA"]);
    }
    return this.autoDetectConfig;
  }

  async transcribeWav(buffer: Buffer, language?: string): Promise<SpeechTranscriptionResult> {
    if (!this.isConfigured()) {
      throw new Error("Azure Speech credentials not configured on the server.");
    }

    const speechConfig = this.getSpeechConfig();
    const audioConfig = sdk.AudioConfig.fromWavFileInput(buffer);

    let recognizer: sdk.SpeechRecognizer;
    if (language && language !== "auto") {
      speechConfig.speechRecognitionLanguage = language;
      recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    } else {
      speechConfig.speechRecognitionLanguage = "";
      const autoDetectConfig = this.getAutoDetectConfig();
      recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetectConfig, audioConfig);
    }

    // 4. Set up PhraseListGrammar to bias the acoustic and language model towards control keywords and command phrases.
    // This forces correct transcription of key phrases, which then allows our cleanup filters to run reliably.
    const phraseList = sdk.PhraseListGrammar.fromRecognizer(recognizer);
    phraseList.addPhrases([
      "stop fan", "stop the fan", "stop",
      "go ahead", "go", "continue",
      "thank you", "speed up", "slow down",
      "scroll", "prompter", "teleprompter",
      "توقف المروحة", "توقف", "شكرا لك", "شكرا",
      "يا", "استمر", "تابع", "أسرع", "أبطأ"
    ]);

    return new Promise<SpeechTranscriptionResult>((resolve, reject) => {
      let detectedLang: string | undefined = undefined;
      let confidence: number | undefined = undefined;
      const partials: string[] = [];

      recognizer.recognizing = (s, e) => {
        if (e.result.text) {
          const partialText = e.result.text.trim();
          partials.push(partialText);
          console.log(`[DIAGNOSTIC - PARTIAL TRANSCRIPT] "${partialText}"`);
        }
      };

      recognizer.recognizeOnceAsync(
        (result) => {
          let text = "";
          if (result.reason === sdk.ResultReason.RecognizedSpeech && result.text) {
            text = result.text.trim();
            console.log(`[DIAGNOSTIC - RECOGNIZED TEXT] "${text}"`);

            // Extract transcription confidence from detailed JSON NBest candidates
            if (result.json) {
              try {
                const parsed = JSON.parse(result.json);
                if (parsed.NBest && parsed.NBest.length > 0) {
                  const best = parsed.NBest[0];
                  if (typeof best.Confidence === "number") {
                    confidence = best.Confidence;
                    console.log(`[DIAGNOSTIC - DETECTED TRANSCRIPTION CONFIDENCE] Confidence: ${confidence}`);
                  }
                }
              } catch (jsonErr) {
                console.warn("[Azure STT] Failed to parse result detailed JSON for confidence:", jsonErr);
              }
            }

            // Extract language
            if (language && language !== "auto") {
              detectedLang = language;
              if (confidence === undefined || isNaN(confidence)) {
                confidence = 0.95;
              }
            } else {
              const langResult = sdk.AutoDetectSourceLanguageResult.fromResult(result);
              if (langResult && langResult.language) {
                detectedLang = langResult.language;
                
                // Map LID confidence if detailed confidence is not set
                if (confidence === undefined || isNaN(confidence)) {
                  const lidConf = langResult.languageDetectionConfidence;
                  if (lidConf === "High") {
                    confidence = 0.95;
                  } else if (lidConf === "Medium") {
                    confidence = 0.65;
                  } else if (lidConf === "Low") {
                    confidence = 0.35;
                  } else {
                    confidence = 0.50;
                  }
                  console.log(`[DIAGNOSTIC - DETECTED LANGUAGE] Language: ${detectedLang} | Mapped LID Confidence: ${confidence}`);
                } else {
                  console.log(`[DIAGNOSTIC - DETECTED LANGUAGE] Language: ${detectedLang} | LID Level: ${langResult.languageDetectionConfidence}`);
                }
              }
            }
          } else if (result.reason === sdk.ResultReason.NoMatch) {
            const noMatchDetails = sdk.NoMatchDetails.fromResult(result);
            console.log(`[DIAGNOSTIC - NO MATCH] Reason: ${sdk.NoMatchReason[noMatchDetails.reason]}`);
          }

          resolve({
            text,
            detectedLanguage: detectedLang,
            confidence: confidence === undefined || isNaN(confidence) ? 0.95 : confidence,
            partialTranscripts: partials
          });
          recognizer.close();
        },
        (err) => {
          console.error("[Azure STT] recognizeOnceAsync failed:", err);
          recognizer.close();
          reject(err);
        }
      );
    });
  }
}

const speechService = new AzureSpeechService();

// ====================================================
// MODEL ROUTER & REGISTRY (Step 2)
// ====================================================
interface ModelStats {
  name: string;
  alias: string;
  latency: number;
  successCount: number;
  failures: number;
  timeoutCount: number;
  lastError: string | null;
  circuitState: "CLOSED" | "OPEN" | "HALF_OPEN";
  healthScore: number;
  lastStateChange: number;
  failureStreak: number;
}

class ModelRouter {
  public models: Map<string, ModelStats> = new Map();

  constructor() {
    // Register standard Gemini models supported by our guidelines
    this.registerModel("gemini-3.5-flash", "Gemini 3.5 Flash", 150);
    this.registerModel("gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite", 100);
    this.registerModel("gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview", 300);
  }

  private registerModel(name: string, alias: string, defaultLatency: number) {
    this.models.set(name, {
      name,
      alias,
      latency: defaultLatency,
      successCount: 1,
      failures: 0,
      timeoutCount: 0,
      lastError: null,
      circuitState: "CLOSED",
      healthScore: 100,
      lastStateChange: Date.now(),
      failureStreak: 0,
    });
  }

  getHealthiestModel(provider: string, preferredModel?: string): ModelStats {
    if (provider !== "gemini") {
      const customKey = `${provider}:${preferredModel || "default"}`;
      if (!this.models.has(customKey)) {
        this.registerModel(preferredModel || "default", customKey, 200);
      }
      return this.models.get(customKey)!;
    }

    let bestModel: ModelStats | null = null;
    let highestScore = -1;
    const now = Date.now();

    for (const [name, stats] of this.models.entries()) {
      // Step 4: Cooldown period retry mechanism
      if (stats.circuitState === "OPEN") {
        const cooldown = 10000; // 10 seconds cooldown
        if (now - stats.lastStateChange > cooldown) {
          stats.circuitState = "HALF_OPEN";
          stats.healthScore = 30;
          stats.lastStateChange = now;
          console.log(`[Circuit Breaker] Model ${stats.alias} cooldown complete. Promoted to HALF_OPEN.`);
        }
      }

      this.recalculateHealth(stats);

      if (stats.circuitState === "OPEN") continue;

      let score = stats.healthScore;
      if (preferredModel && stats.name === preferredModel) {
        score += 15; // Give preferred model from settings a healthy boost
      }

      if (score > highestScore) {
        highestScore = score;
        bestModel = stats;
      }
    }

    if (!bestModel) {
      bestModel = this.models.get("gemini-3.1-flash-lite") || Array.from(this.models.values())[0];
    }

    return bestModel!;
  }

  private recalculateHealth(stats: ModelStats) {
    if (stats.circuitState === "OPEN") {
      stats.healthScore = 0;
      return;
    }

    let score = 100;
    score -= stats.failures * 15;
    score -= stats.timeoutCount * 25;
    score -= stats.failureStreak * 20;

    if (stats.latency > 1000) {
      score -= Math.min(25, (stats.latency - 1000) / 100);
    }

    if (stats.circuitState === "HALF_OPEN") {
      score = Math.min(30, score);
    }

    stats.healthScore = Math.max(1, Math.min(100, score));
  }

  recordSuccess(name: string, latency: number) {
    const stats = this.models.get(name);
    if (!stats) return;

    stats.successCount++;
    stats.failureStreak = 0;
    stats.latency = Math.round(stats.latency * 0.8 + latency * 0.2);

    if (stats.circuitState === "HALF_OPEN" || stats.circuitState === "OPEN") {
      stats.circuitState = "CLOSED";
      stats.lastStateChange = Date.now();
      console.log(`[Circuit Breaker] Probe success! Model ${stats.alias} returned to CLOSED state.`);
    }
    this.recalculateHealth(stats);
  }

  recordFailure(name: string, error: string, isTimeout: boolean = false) {
    const stats = this.models.get(name);
    if (!stats) return;

    stats.failures++;
    stats.failureStreak++;
    stats.lastError = error;
    if (isTimeout) {
      stats.timeoutCount++;
    }

    // Determine if the error is a quota/rate-limit error (e.g., 429, RESOURCE_EXHAUSTED)
    const isQuotaError = 
      error.includes("429") || 
      error.toLowerCase().includes("quota") || 
      error.includes("RESOURCE_EXHAUSTED") || 
      error.toLowerCase().includes("rate limit");

    // Step 4: Open circuit on repeated non-quota failures
    if (!isQuotaError && stats.failureStreak >= 3 && stats.circuitState !== "OPEN") {
      stats.circuitState = "OPEN";
      stats.lastStateChange = Date.now();
      console.warn(`[Circuit Breaker] Model ${stats.alias} failed consecutively ${stats.failureStreak} times. Circuit OPENED.`);
    } else if (isQuotaError) {
      console.log(`[Circuit Breaker] Quota/Rate Limit error detected on ${stats.alias}. Keeping circuit CLOSED.`);
    }

    this.recalculateHealth(stats);
  }

  resetCircuits() {
    for (const stats of this.models.values()) {
      stats.circuitState = "CLOSED";
      stats.failureStreak = 0;
      stats.lastError = null;
      stats.lastStateChange = Date.now();
      stats.healthScore = 100;
    }
    console.log("[Circuit Breaker] All model circuits have been manually reset/closed.");
  }
}

// ====================================================
// HEALTH MONITOR BACKGROUND RUNNER (Step 3)
// ====================================================
function startBackgroundHealthMonitor(router: ModelRouter) {
  // Disable background health monitor by default to conserve API quota and prevent circuit-breaker locks on free-tier keys
  console.log("[Health Monitor] Background health monitor disabled to prevent API key quota exhaustion.");
  return;
}

// ====================================================
// LIGHTWEIGHT SEQUENTIAL QUEUE (Step 9)
// ====================================================
interface QueueItem {
  id: string;
  prompt: string | any[];
  config: any;
  callbacks: any;
  priority: number;
  abortController: AbortController;
  runner: (signal: AbortSignal) => Promise<void>;
}

class RequestQueue {
  private queue: Array<QueueItem> = [];
  private activeItem: QueueItem | null = null;

  enqueue(item: QueueItem) {
    this.queue.push(item);
    this.queue.sort((a, b) => b.priority - a.priority);
    this.processNext();
  }

  cancel(id: string) {
    if (this.activeItem && this.activeItem.id === id) {
      this.activeItem.abortController.abort();
      this.activeItem = null;
    }
    this.queue = this.queue.filter(item => item.id !== id);
    this.processNext();
  }

  cancelAll() {
    if (this.activeItem) {
      this.activeItem.abortController.abort();
      this.activeItem = null;
    }
    this.queue.forEach(item => item.abortController.abort());
    this.queue = [];
  }

  replace(newItem: QueueItem) {
    // Step 8: Cancel running obsolete generations and clear queue instantly
    this.cancelAll();
    this.enqueue(newItem);
  }

  private async processNext() {
    if (this.activeItem || this.queue.length === 0) return;

    this.activeItem = this.queue.shift() || null;
    if (!this.activeItem) return;

    try {
      await this.activeItem.runner(this.activeItem.abortController.signal);
    } catch (err) {
      console.error("Queue execution error:", err);
    } finally {
      this.activeItem = null;
      this.processNext();
    }
  }
}

// ====================================================
// AI ORCHESTRATOR (Step 1)
// ====================================================
interface OrchestratorConfig {
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

interface OrchestratorCallbacks {
  onStart?: (modelName: string) => void;
  onChunk?: (text: string) => void;
  onSuccess?: (fullText: string, stats: any) => void;
  onError?: (err: any) => void;
}

class AIOrchestrator {
  public router = new ModelRouter();
  public queue = new RequestQueue();

  constructor() {
    startBackgroundHealthMonitor(this.router);
  }

  async send(
    prompt: string | any[],
    config: OrchestratorConfig,
    callbacks: OrchestratorCallbacks,
    priority: number = 0
  ): Promise<void> {
    const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const abortController = new AbortController();

    const runner = async (signal: AbortSignal) => {
      const startTime = Date.now();
      let streamStartTime = 0;
      let modelUsed = "";
      let retryCount = 0;
      let fallbackUsed = false;
      const triedModels: string[] = [];

      const executeWithRetry = async (): Promise<void> => {
        const preferredModel = config.model;
        const provider = config.provider || "gemini";

        let modelStats = this.router.getHealthiestModel(provider, preferredModel);

        if (triedModels.includes(modelStats.name)) {
          const sortedModels = Array.from(this.router.models.values())
            .filter(m => !triedModels.includes(m.name) && m.circuitState !== "OPEN")
            .sort((a, b) => b.healthScore - a.healthScore);

          if (sortedModels.length > 0) {
            modelStats = sortedModels[0];
            fallbackUsed = true;
          } else {
            throw new Error("All healthy models failed and circuits are open.");
          }
        }

        modelUsed = modelStats.name;
        triedModels.push(modelUsed);
        callbacks.onStart?.(modelStats.alias);

        const runAttempt = async (attempt: number): Promise<string> => {
          const attemptStart = Date.now();
          const geminiKey = config.apiKey || process.env.GEMINI_API_KEY;

          if (provider === "gemini" && (!config.baseUrl || config.baseUrl.trim() === "")) {
            if (!geminiKey) {
              throw new Error("Gemini API key is missing.");
            }

            const ai = new GoogleGenAI({
              apiKey: geminiKey,
              httpOptions: { headers: { "User-Agent": "aistudio-build" } },
            });

            const activeModel = modelStats.name;
            const modelConfig: any = {
              temperature: config.temperature !== undefined ? Number(config.temperature) : 0.7,
            };

            if (config.systemPrompt && config.systemPrompt.trim() !== "") {
              modelConfig.systemInstruction = config.systemPrompt;
            }
            if (config.maxTokens) {
              modelConfig.maxOutputTokens = Number(config.maxTokens);
            }

            // Step 7: Request Timeout
            const requestTimeoutMs = 8000;
            const timeoutAbort = setTimeout(() => {
              abortController.abort("Timeout");
            }, requestTimeoutMs);

            try {
              console.log(`[Orchestrator] Attempting model ${activeModel} (attempt ${attempt + 1})...`);

              const streamResponse = await ai.models.generateContentStream({
                model: activeModel,
                contents: prompt,
                config: modelConfig,
              });

              clearTimeout(timeoutAbort);

              if (signal.aborted) {
                throw new Error("Aborted");
              }

              let accumulatedText = "";
              for await (const chunk of streamResponse) {
                if (signal.aborted) {
                  throw new Error("Aborted");
                }
                if (!streamStartTime) {
                  streamStartTime = Date.now();
                }
                const chunkText = chunk.text || "";
                accumulatedText += chunkText;
                callbacks.onChunk?.(chunkText);
              }

              const latency = Date.now() - attemptStart;
              this.router.recordSuccess(activeModel, latency);
              return accumulatedText;
            } catch (err: any) {
              clearTimeout(timeoutAbort);
              if (err.name === "AbortError" || signal.aborted || abortController.signal.aborted || err === "Timeout") {
                throw new Error("Aborted");
              }
              throw err;
            }
          } else {
            // Universal custom endpoint / OpenAI streaming path
            let finalBaseUrl = config.baseUrl ? config.baseUrl.trim() : "";
            let finalApiKey = config.apiKey ? config.apiKey.trim() : "";
            let finalModel = config.model ? config.model.trim() : "";

            if (provider === "openai") {
              if (!finalBaseUrl) finalBaseUrl = "https://api.openai.com/v1";
              if (!finalModel) finalModel = "gpt-4o-mini";
            } else if (provider === "groq") {
              if (!finalBaseUrl) finalBaseUrl = "https://api.groq.com/openai/v1";
              if (!finalModel) finalModel = "llama3-8b-8192";
            } else if (provider === "deepseek") {
              if (!finalBaseUrl) finalBaseUrl = "https://api.deepseek.com/v1";
              if (!finalModel) finalModel = "deepseek-chat";
            } else if (provider === "ollama") {
              if (!finalBaseUrl) finalBaseUrl = "http://localhost:11434/v1";
              if (!finalModel) finalModel = "llama3";
            } else if (provider === "lm-studio") {
              if (!finalBaseUrl) finalBaseUrl = "http://localhost:1234/v1";
              if (!finalModel) finalModel = "meta-llama-3-8b-instruct";
            }

            const endpointUrl = `${finalBaseUrl.replace(/\/+$/, "")}/chat/completions`;
            const headers: Record<string, string> = {
              "Content-Type": "application/json",
              "Connection": "keep-alive", // Step 10: Connection Reuse
            };

            if (finalApiKey) {
              headers["Authorization"] = `Bearer ${finalApiKey}`;
            }

            const messages = [];
            if (config.systemPrompt && config.systemPrompt.trim() !== "") {
              messages.push({ role: "system", content: config.systemPrompt });
            }
            if (typeof prompt === "string") {
              messages.push({ role: "user", content: prompt });
            } else {
              // Convert multi-part prompt to simple string fallback
              const textContent = prompt.map((p: any) => p.text || "").join(" ");
              messages.push({ role: "user", content: textContent });
            }

            const bodyPayload: any = {
              model: finalModel,
              messages,
              temperature: config.temperature !== undefined ? Number(config.temperature) : 0.7,
              stream: true,
            };

            if (config.maxTokens) {
              bodyPayload.max_tokens = Number(config.maxTokens);
            }

            const requestTimeoutMs = 8000;
            const timeoutAbort = setTimeout(() => {
              abortController.abort("Timeout");
            }, requestTimeoutMs);

            try {
              const response = await fetch(endpointUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(bodyPayload),
                signal,
              });

              clearTimeout(timeoutAbort);

              if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Provider returned status ${response.status}: ${errText}`);
              }

              if (!response.body) {
                throw new Error("Empty body");
              }

              const reader = response.body.getReader();
              const decoder = new TextDecoder("utf-8");
              let buffer = "";
              let accumulatedText = "";

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
                    const dataStr = trimmed.slice(6).trim();
                    if (dataStr === "[DONE]") continue;

                    try {
                      const parsed = JSON.parse(dataStr);
                      const text = parsed.choices?.[0]?.delta?.content || "";
                      if (text) {
                        if (!streamStartTime) {
                          streamStartTime = Date.now();
                        }
                        accumulatedText += text;
                        callbacks.onChunk?.(text);
                      }
                    } catch (err) {
                      // Skip partial parse errors
                    }
                  }
                }
              }

              const latency = Date.now() - attemptStart;
              this.router.recordSuccess(modelUsed, latency);
              return accumulatedText;
            } catch (err: any) {
              clearTimeout(timeoutAbort);
              throw err;
            }
          }
        };

        const maxRetries = 2;
        let attempt = 0;
        while (attempt <= maxRetries) {
          try {
            if (signal.aborted) throw new Error("Aborted");
            const resultText = await runAttempt(attempt);
            return callbacks.onSuccess?.(resultText, {
              requestId,
              startTime,
              streamStartTime,
              endTime: Date.now(),
              modelUsed,
              retryCount,
              fallbackUsed,
            });
          } catch (err: any) {
            if (err.message === "Aborted") {
              console.log("[Orchestrator] Request aborted.");
              throw err;
            }

            attempt++;
            retryCount++;

            const isTimeout = err.message === "Timeout" || err.name === "TimeoutError";
            const isTransient = isTimeout || err.status === 429 || err.status === 503 || err.status === 504 || err.message.includes("fetch") || err.message.includes("network");

            // Step 6: Exponential backoff with jitter
            if (isTransient && attempt <= maxRetries) {
              const delay = Math.min(3000, 300 * Math.pow(2, attempt)) + Math.random() * 200;
              console.log(`[Orchestrator] Transient error. Retrying in ${Math.round(delay)}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            } else {
              this.router.recordFailure(modelUsed, err.message || String(err), isTimeout);
              console.warn(`[Orchestrator] Model ${modelUsed} failed. Transitioning fallback.`);
              break;
            }
          }
        }

        // Step 5: Automatically fallback to next healthiest model
        await executeWithRetry();
      };

      try {
        await executeWithRetry();
      } catch (err: any) {
        if (err.message === "Aborted") {
          callbacks.onError?.(new Error("Generation cancelled by user."));
        } else {
          callbacks.onError?.(err);
        }
      }
    };

    // Step 8 & 9: Sequential replacement of voice queries
    const queueItem: QueueItem = {
      id: requestId,
      prompt,
      config,
      callbacks,
      priority,
      abortController,
      runner,
    };

    if (priority >= 10) {
      this.queue.replace(queueItem);
    } else {
      this.queue.enqueue(queueItem);
    }
  }
}

const orchestrator = new AIOrchestrator();

// ====================================================
// OBSERVABILITY LOGGING (Step 13)
// ====================================================
function logTimingMetrics(metrics: {
  speechDuration?: number;
  speechProcessingTime?: number;
  azureSttTime?: number;
  aiQueueWait: number;
  modelUsed: string;
  retryCount: number;
  fallbackUsed: boolean;
  streamingStart: number;
  streamingEnd: number;
  totalResponseTime: number;
}) {
  const structuredLog = {
    timestamp: new Date().toISOString(),
    event: "TimingMetrics",
    metrics: {
      speechDurationMs: metrics.speechDuration || 0,
      speechProcessingTimeMs: metrics.speechProcessingTime || 0,
      azureSttTimeMs: metrics.azureSttTime || 0,
      aiQueueWaitMs: metrics.aiQueueWait,
      modelUsed: metrics.modelUsed,
      retryCount: metrics.retryCount,
      fallbackUsed: metrics.fallbackUsed,
      timeToFirstTokenMs: metrics.streamingStart,
      timeToLastTokenMs: metrics.streamingEnd,
      totalResponseTimeMs: metrics.totalResponseTime,
    }
  };
  console.log(`[OBSERVABILITY] ${JSON.stringify(structuredLog, null, 2)}`);
}

/**
 * Helper function to fetch response from the AI.
 * Uses the new AIOrchestrator pipeline.
 */
async function fetchAiResponse(userPrompt: string, config: any = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    orchestrator.send(
      userPrompt,
      {
        ...activeSettings,
        ...config,
      },
      {
        onSuccess: (fullText) => resolve(fullText),
        onError: (err) => reject(err),
      },
      5 // Normal priority
    );
  });
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

  // Body parsing middleware
  app.use(express.json());

  // Webhook Receiver Endpoint: Accepts user prompts and updates global state with AI response
  app.post("/api/webhook/query", async (req: Request, res: Response) => {
    const { userPrompt, metrics: clientMetrics } = req.body;

    if (!userPrompt || typeof userPrompt !== "string") {
      res.status(400).json({ error: "Invalid payload: 'userPrompt' is required and must be a string." });
      return;
    }

    const cleanedPrompt = cleanTranscript(userPrompt);
    if (!cleanedPrompt) {
      console.log(`[AI Webhook] Prompt is empty or contains only noise artifacts after cleanup. Ignoring request.`);
      res.json({ success: true, status: "ignored_noise" });
      return;
    }

    try {
      console.log(`[AI response process started] userPrompt: "${cleanedPrompt}" (original: "${userPrompt}")`);

      // Respond instantly to client for 0ms perceived UI delay
      res.json({ success: true, status: "enqueued" });

      const enqueueTime = Date.now();
      let streamStart = 0;

      // Broadcast start to SSE teleprompter clients
      sseClients.forEach((client) => {
        client.write(`data: ${JSON.stringify({ type: "stream_start", queryText: cleanedPrompt })}\n\n`);
      });

      let accumulatedAnswer = "";

      await orchestrator.send(
        cleanedPrompt,
        activeSettings,
        {
          onStart: (alias) => {
            console.log(`[Orchestrator Stream] Starting stream via model ${alias}`);
          },
          onChunk: (text) => {
            if (!streamStart) streamStart = Date.now();
            accumulatedAnswer += text;
            sseClients.forEach((client) => {
              client.write(`data: ${JSON.stringify({ type: "stream_chunk", text })}\n\n`);
            });
          },
          onSuccess: (fullText, stats) => {
            // صياغة النمط المطلوب: Q1 سؤالي ثم في السطر التالي الرد A1
            const cleanResponse = `Q1: ${cleanedPrompt.trim()}\nA1: ${fullText.trim()}`;
            latestAiResponse = cleanResponse;

            console.log(`[AI response received] Streaming completed. Broadcasting final state update.`);
            sseClients.forEach((client) => {
              client.write(`data: ${JSON.stringify({ type: "update", formattedQa: cleanResponse })}\n\n`);
              client.write(`data: ${JSON.stringify({ type: "stream_end" })}\n\n`);
            });

            // Log Metrics
            const now = Date.now();
            const aiQueueWait = stats.startTime - enqueueTime;
            const streamingStart = streamStart ? (streamStart - stats.startTime) : 0;
            const streamingEnd = now - stats.startTime;
            const totalResponseTime = now - enqueueTime;

            logTimingMetrics({
              speechDuration: clientMetrics?.speechDuration,
              speechProcessingTime: clientMetrics?.speechProcessingTime,
              azureSttTime: clientMetrics?.azureSttTime,
              aiQueueWait,
              modelUsed: stats.modelUsed,
              retryCount: stats.retryCount,
              fallbackUsed: stats.fallbackUsed,
              streamingStart,
              streamingEnd,
              totalResponseTime,
            });
          },
          onError: (err) => {
            console.error("[Orchestrator Stream] Pipeline failed:", err);
            sseClients.forEach((client) => {
              client.write(`data: ${JSON.stringify({ type: "stream_error", error: err.message || String(err) })}\n\n`);
            });
          },
        },
        10 // Highest priority for live voice
      );
    } catch (error: any) {
      console.error("Webhook AI query failed:", error);
    }
  });

  // Lightweight transcript cleanup to remove duplicated consecutive words/phrases and obvious recognition artifacts
  function cleanTranscript(text: string, confidence?: number): string {
    if (!text) return "";
    
    // 1. Remove known silence/noise artifacts (like "Stop Fan", "Stop fan.", "Go ahead.", "Go ahead", "Thank you.", etc.)
    const trimmed = text.trim();
    const lowercaseText = trimmed.toLowerCase();
    
    // Filter out obvious noise phrases (both English and Arabic equivalents)
    const noisePhrases = new Set([
      "stop fan", "stop fan.", "stop the fan", "stop the fan.",
      "go ahead", "go ahead.", "thank you", "thank you.",
      "شكرا", "شكرا لك", "يا", "توقف", "توقف المروحة", "توقف المروحة."
    ]);
    
    const isNoisePhrase = noisePhrases.has(lowercaseText) || lowercaseText === "fan" || lowercaseText === "fan.";
    const isLowConfidence = confidence !== undefined && confidence < 0.45;
    
    if (isNoisePhrase) {
      console.log(`[Transcript Cleanup] Filtered out exact noise artifact: "${text}" (confidence: ${confidence ?? "N/A"})`);
      return "";
    }
    
    if (isLowConfidence) {
      // Check if low-confidence transcript contains any noise command substrings or noise fragments
      const lowConfidenceNoisePatterns = ["stop fan", "stop the fan", "thank you", "go ahead", "توقف", "المروحة", "شكرا"];
      for (const pattern of lowConfidenceNoisePatterns) {
        if (lowercaseText.includes(pattern)) {
          console.log(`[Transcript Cleanup] Filtered out low-confidence noise artifact: "${text}" (matched low-confidence pattern: "${pattern}", confidence: ${confidence})`);
          return "";
        }
      }
      
      // If the entire transcript has extremely low confidence and is short, discard it as background noise
      if (confidence !== undefined && confidence < 0.25 && trimmed.length < 15) {
        console.log(`[Transcript Cleanup] Discarded extremely low confidence transcript: "${text}" (confidence: ${confidence})`);
        return "";
      }
    }

    // 2. Remove adjacent consecutive duplicated words, ignoring punctuation and casing (e.g., "is, is" -> "is")
    const words = trimmed.split(/\s+/);
    const cleanedWords: string[] = [];
    for (let i = 0; i < words.length; i++) {
      const currentClean = words[i].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "").toLowerCase();
      const prevClean = i > 0 ? words[i - 1].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "").toLowerCase() : "";
      
      if (i === 0 || currentClean !== prevClean || currentClean === "") {
        cleanedWords.push(words[i]);
      } else {
        console.log(`[Transcript Cleanup] Removed adjacent duplicate word: "${words[i]}"`);
      }
    }
    
    // 3. Remove adjacent consecutive duplicated 2-word phrases (stutters e.g., "go to go to" -> "go to")
    let i = 0;
    const finalWords: string[] = [];
    while (i < cleanedWords.length) {
      if (i + 3 < cleanedWords.length) {
        const w1 = cleanedWords[i].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "").toLowerCase();
        const w2 = cleanedWords[i+1].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "").toLowerCase();
        const w3 = cleanedWords[i+2].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "").toLowerCase();
        const w4 = cleanedWords[i+3].replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "").toLowerCase();
        
        if (w1 === w3 && w2 === w4 && w1 !== "" && w2 !== "") {
          console.log(`[Transcript Cleanup] Removed consecutive duplicate phrase stutter: "${cleanedWords[i]} ${cleanedWords[i+1]}"`);
          finalWords.push(cleanedWords[i]);
          finalWords.push(cleanedWords[i+1]);
          i += 4;
          continue;
        }
      }
      finalWords.push(cleanedWords[i]);
      i++;
    }
    
    return finalWords.join(" ").trim();
  }

  // Helper function to analyze received WAV buffer
  function analyzeWavBuffer(buffer: Buffer, speechLang: string) {
    let channels = 1;
    let sampleRate = 16000;
    let bitsPerSample = 16;
    let dataSize = 0;
    let dataOffset = 44;

    try {
      if (buffer.length >= 44 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WAVE") {
        let offset = 12;
        while (offset < buffer.length - 8) {
          const chunkId = buffer.toString("ascii", offset, offset + 4);
          const chunkSize = buffer.readUInt32LE(offset + 4);
          if (chunkId === "fmt ") {
            channels = buffer.readUInt16LE(offset + 8 + 2);
            sampleRate = buffer.readUInt32LE(offset + 8 + 4);
            bitsPerSample = buffer.readUInt16LE(offset + 8 + 14);
          } else if (chunkId === "data") {
            dataSize = chunkSize;
            dataOffset = offset + 8;
            break;
          }
          offset += 8 + chunkSize;
        }

        if (dataSize === 0) {
          channels = buffer.readUInt16LE(22);
          sampleRate = buffer.readUInt32LE(24);
          bitsPerSample = buffer.readUInt16LE(34);
          dataSize = buffer.readUInt32LE(40);
          dataOffset = 44;
        }
      }
    } catch (e) {
      console.warn("[Diagnostics] Error parsing WAV structure, using fallbacks:", e);
    }

    const bytesPerSample = bitsPerSample / 8;
    const numSamples = Math.floor(dataSize / (channels * bytesPerSample));
    const duration = sampleRate > 0 ? numSamples / sampleRate : 0;

    let sumSquare = 0;
    let peak = 0;
    let silentSamples = 0;
    const silenceThreshold = 0.01; // -40dB

    try {
      if (bitsPerSample === 16) {
        for (let i = 0; i < numSamples; i++) {
          const idx = dataOffset + i * channels * 2;
          if (idx + 1 >= buffer.length) break;
          const sample16 = buffer.readInt16LE(idx);
          const val = sample16 / 32768;
          sumSquare += val * val;
          const absVal = Math.abs(val);
          if (absVal > peak) peak = absVal;
          if (absVal < silenceThreshold) silentSamples++;
        }
      } else if (bitsPerSample === 8) {
        for (let i = 0; i < numSamples; i++) {
          const idx = dataOffset + i * channels;
          if (idx >= buffer.length) break;
          const sample8 = buffer.readUInt8(idx);
          const val = (sample8 - 128) / 128;
          sumSquare += val * val;
          const absVal = Math.abs(val);
          if (absVal > peak) peak = absVal;
          if (absVal < silenceThreshold) silentSamples++;
        }
      }
    } catch (e) {
      console.error("[Diagnostics] Error computing PCM metrics:", e);
    }

    const rms = numSamples > 0 ? Math.sqrt(sumSquare / numSamples) : 0;
    const silencePercentage = numSamples > 0 ? (silentSamples / numSamples) * 100 : 0;

    console.log("==================================================");
    console.log("🎙️ [Azure STT DIAGNOSTICS] Uploaded WAV File Analysis:");
    console.log(`- speechRecognitionLanguage: ${speechLang}`);
    console.log(`- Sample Rate: ${sampleRate} Hz`);
    console.log(`- Channels: ${channels}`);
    console.log(`- Bits Per Sample: ${bitsPerSample} bit`);
    console.log(`- Audio Duration: ${duration.toFixed(3)} seconds`);
    console.log(`- RMS Level: ${rms.toFixed(5)} (${(20 * Math.log10(rms || 0.00001)).toFixed(2)} dBFS)`);
    console.log(`- Peak Amplitude: ${peak.toFixed(5)} (${(20 * Math.log10(peak || 0.00001)).toFixed(2)} dBFS)`);
    console.log(`- Silence Percentage: ${silencePercentage.toFixed(2)}%`);
    console.log("==================================================");
  }

  // Azure Speech-to-Text Endpoint: Accepts raw PCM WAV audio from client, transcribes via Microsoft Speech SDK
  app.post("/api/azure-stt", express.raw({ type: "audio/wav", limit: "20mb" }), async (req: Request, res: Response) => {
    if (!req.body || !(req.body instanceof Buffer) || req.body.length === 0) {
      res.status(400).json({ error: "No audio data received." });
      return;
    }

    const language = typeof req.query.language === "string" ? req.query.language : "auto";

    // 1. Analyze the WAV buffer and log all statistics requested (for EVERY uploaded WAV file)
    analyzeWavBuffer(req.body, speechService.isConfigured() ? (language === "auto" ? "en-US" : language) : "gemini-fallback");

    // 2. Save received WAV to disk asynchronously to remove main loop block
    fs.writeFile("debug_received.wav", req.body, (fsErr) => {
      if (fsErr) {
        console.error("[Azure STT Debug] Failed to save WAV to disk:", fsErr);
      } else {
        console.log(`[Azure STT Debug] Saved last received WAV asynchronously.`);
      }
    });

    const sttStart = Date.now();

    // 3. Transcription process (Azure with AIOrchestrator Fallback)
    if (!speechService.isConfigured()) {
      console.warn("[Azure STT] Configuration missing on server: AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing in env. Falling back to Gemini API.");
      
      try {
        console.log(`[Azure STT Fallback] Transcribing via AIOrchestrator (language: ${language})...`);
        let promptText = "Transcribe this speech to text.";
        if (language && language !== "auto") {
          const langLabel = language.startsWith("ar") ? "Arabic" : "English";
          promptText += ` The language is ${langLabel} (${language}).`;
        }
        promptText += " Output ONLY the transcription. Do not include any notes, explanations, formatting, or metadata. If there is no speech or only background noise, respond with an empty string.";

        let transcript = "";
        await orchestrator.send(
          [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: req.body.toString("base64")
              }
            },
            promptText
          ],
          {
            model: "gemini-3.1-flash-lite",
            provider: "gemini",
            temperature: 0.1,
          },
          {
            onChunk: () => {},
            onSuccess: (fullText) => {
              transcript = fullText.trim();
            },
            onError: (err) => {
              throw err;
            }
          },
          10 // Highest priority
        );

        const cleanedText = cleanTranscript(transcript);
        const azureSttTime = Date.now() - sttStart;
        console.log(`[Azure STT Fallback] successfully transcribed: "${cleanedText}" (original: "${transcript}") in ${azureSttTime}ms`);
        res.json({
          text: cleanedText,
          metrics: {
            azureSttTime
          }
        });
        return;
      } catch (geminiErr: any) {
        console.error("[Azure STT Fallback] Exception during AIOrchestrator fallback transcription:", geminiErr);
        res.status(500).json({ error: `Azure credentials missing and AIOrchestrator fallback failed: ${geminiErr.message || String(geminiErr)}` });
        return;
      }
    }

    try {
      console.log(`[Azure STT] Received audio buffer of size: ${req.body.length} bytes (language: ${language}). Transcribing...`);

      const result = await speechService.transcribeWav(req.body, language);
      const azureSttTime = Date.now() - sttStart;
      
      const cleanedText = cleanTranscript(result.text, result.confidence);

      console.log("==================================================");
      console.log("🎙️ [Azure STT DIAGNOSTICS]");
      console.log(`- Final Transcript (Raw): "${result.text}"`);
      console.log(`- Final Transcript (Cleaned): "${cleanedText}"`);
      console.log(`- Selected/Detected Language: ${result.detectedLanguage || "Unknown/Fallback"}`);
      console.log(`- Confidence: ${result.confidence !== undefined ? result.confidence : "N/A"}`);
      console.log(`- Latency: ${azureSttTime} ms`);
      console.log("==================================================");

      res.json({
        text: cleanedText,
        detectedLanguage: result.detectedLanguage,
        confidence: result.confidence,
        metrics: {
          azureSttTime
        }
      });
    } catch (err: any) {
      console.error("[Azure STT] Azure Speech transcription failed, attempting AIOrchestrator fallback as backup...", err);
      
      try {
        console.log(`[Azure STT Fallback Backup] Transcribing via AIOrchestrator...`);
        let transcript = "";
        await orchestrator.send(
          [
            {
              inlineData: {
                mimeType: "audio/wav",
                data: req.body.toString("base64")
              }
            },
            "Transcribe this speech to text. Output ONLY the transcription. Do not include any notes, explanations, formatting, or metadata. If there is no speech or only background noise, respond with an empty string."
          ],
          {
            model: "gemini-3.1-flash-lite",
            provider: "gemini",
            temperature: 0.1,
          },
          {
            onChunk: () => {},
            onSuccess: (fullText) => {
              transcript = fullText.trim();
            },
            onError: (err) => {
              throw err;
            }
          },
          10 // Highest priority
        );

        const cleanedText = cleanTranscript(transcript);
        const azureSttTime = Date.now() - sttStart;
        console.log(`[Azure STT Fallback Backup] successfully transcribed: "${cleanedText}" (original: "${transcript}") in ${azureSttTime}ms`);
        res.json({
          text: cleanedText,
          metrics: {
            azureSttTime
          }
        });
      } catch (geminiErr: any) {
        console.error("[Azure STT Fallback Backup] Backup transcription also failed:", geminiErr);
        res.status(500).json({ error: `Azure STT failed and fallback backup failed: ${geminiErr.message || String(geminiErr)}` });
      }
    }
  });

  // Sync Endpoint: Returns the latest stored AI response
  app.get("/api/latest-response", (req: Request, res: Response) => {
    res.json({ latestAiResponse });
  });

  // GET /api/settings: returns the current active server settings
  app.get("/api/settings", (req: Request, res: Response) => {
    res.json(activeSettings);
  });

  // POST /api/settings: updates active server settings in memory immediately
  app.post("/api/settings", (req: Request, res: Response) => {
    const { provider, apiKey, baseUrl, model, temperature, maxTokens, systemPrompt } = req.body;
    
    let hasChanged = false;

    if (provider !== undefined && provider !== activeSettings.provider) {
      activeSettings.provider = provider;
      hasChanged = true;
    }
    if (apiKey !== undefined && apiKey !== activeSettings.apiKey) {
      activeSettings.apiKey = apiKey;
      hasChanged = true;
    }
    if (baseUrl !== undefined && baseUrl !== activeSettings.baseUrl) {
      activeSettings.baseUrl = baseUrl;
      hasChanged = true;
    }
    if (model !== undefined && model !== activeSettings.model) {
      activeSettings.model = model;
      hasChanged = true;
    }
    if (temperature !== undefined && Number(temperature) !== activeSettings.temperature) {
      activeSettings.temperature = Number(temperature);
      hasChanged = true;
    }
    if (maxTokens !== undefined && Number(maxTokens) !== activeSettings.maxTokens) {
      activeSettings.maxTokens = Number(maxTokens);
      hasChanged = true;
    }
    if (systemPrompt !== undefined && systemPrompt !== activeSettings.systemPrompt) {
      activeSettings.systemPrompt = systemPrompt;
      hasChanged = true;
    }

    if (hasChanged) {
      console.log("[Settings Updated] Active AI engine settings updated on server:", activeSettings);
      // Reset circuit breakers on settings change to allow retrying with the new configuration
      orchestrator.router.resetCircuits();
    } else {
      console.log("[Settings Sync] Received duplicate settings update. Skipping circuit breaker reset.");
    }
    
    res.json({ success: true, settings: activeSettings });
  });

  // Manual reset of circuit breakers
  app.post("/api/reset-circuits", (req: Request, res: Response) => {
    orchestrator.router.resetCircuits();
    res.json({ success: true, message: "Circuit breakers have been reset." });
  });

  // SSE Updates Stream endpoint for real-time React subscription
  app.get("/api/updates", (req: Request, res: Response) => {
    // Prevent socket timeout and buffer delay
    req.socket.setKeepAlive(true);
    req.socket.setNoDelay(true);
    req.socket.setTimeout(0);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.flushHeaders();

    // Send connection initialization event with current latest response
    res.write(`data: ${JSON.stringify({ type: "init", latestAiResponse })}\n\n`);
    console.log("[Socket connected] New client subscribed to SSE live updates.");

    sseClients.push(res);

    req.on("close", () => {
      console.log("[Socket disconnected] Client unsubscribed from SSE updates.");
      sseClients = sseClients.filter((client) => client !== res);
    });
  });

  // API Route: AI Stream proxy
  app.post("/api/stream", async (req, res) => {
    const {
      prompt,
      provider = "gemini",
      apiKey,
      baseUrl,
      model,
      temperature = 0.7,
      maxTokens,
      systemPrompt,
    } = req.body;

    if (!prompt) {
      res.status(400).json({ error: "Prompt is required" });
      return;
    }

    // Set SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    try {
      await orchestrator.send(
        prompt,
        {
          provider,
          apiKey,
          baseUrl,
          model,
          temperature,
          maxTokens,
          systemPrompt,
        },
        {
          onChunk: (text) => {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          },
          onSuccess: (fullText) => {
            res.write("data: [DONE]\n\n");
            res.end();
          },
          onError: (err) => {
            res.write(`data: ${JSON.stringify({ error: err.message || String(err) })}\n\n`);
            res.end();
          },
        },
        5 // Medium priority for manual streams
      );
    } catch (error: any) {
      console.error("Streaming error:", error);
      res.write(`data: ${JSON.stringify({ error: `Connection failed: ${error.message}` })}\n\n`);
      res.end();
    }
  });

  // Serve static assets in production or mount Vite middleware in development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Teleprompter Server running on port ${PORT}`);
  });
}

startServer();
