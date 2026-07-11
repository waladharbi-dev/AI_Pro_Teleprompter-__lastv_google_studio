import React, { Component, useState, useRef, useEffect } from "react";
import { Copy, Download, ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2, AlertTriangle, Check } from "lucide-react";

// ==========================================
// 1. Error Boundary Component
// ==========================================
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  resetBoundary = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      return this.props.fallback(this.state.error, this.resetBoundary);
    }
    return this.props.children;
  }
}

// Fallback UI for rendering failures
export function RenderErrorFallback({ error, code, reset, language }: { error: Error; code: string; reset: () => void; language: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div id={`error-boundary-${language}`} className="my-6 p-5 bg-red-950/20 border border-red-900/30 rounded-xl flex flex-col space-y-4 text-left select-text">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2.5 text-red-400">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold uppercase tracking-wider">Failed to render {language}</h4>
            <p className="text-xs text-red-400/80 mt-0.5">An error occurred while compiling the diagram visualization.</p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={reset}
            className="px-3 py-1.5 bg-red-900/35 hover:bg-red-900/50 text-red-200 hover:text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            Retry Render
          </button>
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white text-xs font-medium rounded-lg transition-colors cursor-pointer"
          >
            {showRaw ? "Hide Source" : "Show Source"}
          </button>
        </div>
      </div>

      <div className="bg-red-950/40 p-3 rounded-lg border border-red-900/20 font-mono text-xs text-red-300 max-h-40 overflow-y-auto whitespace-pre-wrap select-text">
        {error.message || String(error)}
      </div>

      {showRaw && (
        <div className="relative space-y-2">
          <div className="flex justify-between items-center text-[11px] text-zinc-400">
            <span>Raw Code Block ({language})</span>
            <button onClick={handleCopy} className="flex items-center space-x-1 hover:text-white cursor-pointer transition-colors">
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? "Copied!" : "Copy Code"}</span>
            </button>
          </div>
          <pre className="bg-zinc-950/90 border border-zinc-800/80 p-4 rounded-xl overflow-x-auto text-xs font-mono text-zinc-300 max-h-60 select-text">
            <code>{code}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ==========================================
// 2. Action Bar Component (Reusable)
// ==========================================
interface ActionBarProps {
  onCopy: () => void;
  onDownload: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onToggleFullscreen: () => void;
  isFullscreen: boolean;
  copied: boolean;
  title: string;
}

export function ActionBar({
  onCopy,
  onDownload,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onToggleFullscreen,
  isFullscreen,
  copied,
  title,
}: ActionBarProps) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-900/60 px-4 py-2 text-xs font-medium text-zinc-400 select-none">
      <span className="font-semibold text-zinc-300 uppercase tracking-wider text-[11px]">{title}</span>
      <div className="flex items-center space-x-1.5">
        <button
          onClick={onCopy}
          className="p-1.5 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors cursor-pointer flex items-center space-x-1"
          title="Copy Diagram Code"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span className="sr-only">Copy</span>
        </button>
        <button
          onClick={onDownload}
          className="p-1.5 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors cursor-pointer"
          title="Download as SVG"
        >
          <Download className="w-3.5 h-3.5" />
        </button>
        <div className="h-4 w-px bg-zinc-800 mx-1" />
        <button
          onClick={onZoomIn}
          className="p-1.5 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors cursor-pointer"
          title="Zoom In"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onZoomOut}
          className="p-1.5 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors cursor-pointer"
          title="Zoom Out"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onResetZoom}
          className="p-1.5 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors cursor-pointer"
          title="Reset View"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <div className="h-4 w-px bg-zinc-800 mx-1" />
        <button
          onClick={onToggleFullscreen}
          className="p-1.5 hover:bg-zinc-800 hover:text-white rounded-lg transition-colors cursor-pointer"
          title={isFullscreen ? "Exit Fullscreen" : "Maximize Diagram"}
        >
          {isFullscreen ? <Minimize2 className="w-3.5 h-3.5 text-emerald-400" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>
    </div>
  );
}

// ==========================================
// 3. Zoom / Pan Wrapper Component
// ==========================================
interface ZoomPanContainerProps {
  children: React.ReactNode;
  scale: number;
  setScale: React.Dispatch<React.SetStateAction<number>>;
  position: { x: number; y: number };
  setPosition: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  isFullscreen: boolean;
}

export function ZoomPanContainer({
  children,
  scale,
  setScale,
  position,
  setPosition,
  containerRef,
  isFullscreen,
}: ZoomPanContainerProps) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button") || (e.target as HTMLElement).closest("a")) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y,
    });
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = 1.1;
    const nextScale = e.deltaY < 0 ? scale * zoomFactor : scale / zoomFactor;
    setScale(Math.max(0.1, Math.min(10, nextScale)));
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUpOrLeave}
      onMouseLeave={handleMouseUpOrLeave}
      onWheel={handleWheel}
      className={`relative overflow-hidden select-none bg-zinc-950/60 transition-all ${
        isFullscreen ? "h-[calc(100vh-120px)] w-full" : "h-96 w-full"
      } ${isDragging ? "cursor-grabbing" : "cursor-grab"}`}
    >
      <div
        style={{
          transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
          transformOrigin: "center center",
          transition: isDragging ? "none" : "transform 0.15s ease-out",
        }}
        className="w-full h-full flex items-center justify-center p-6"
      >
        {children}
      </div>
    </div>
  );
}

// ==========================================
// 4. Specialized Diagram Renderers
// ==========================================

// Base component logic with Zoom / Pan and Action Bar
interface RendererWrapperProps {
  code: string;
  language: string;
  title: string;
  renderDiagram: (container: HTMLDivElement) => void | Promise<void>;
  dependencies?: any[];
}

function DiagramRendererWrapper({ code, language, title, renderDiagram, dependencies = [] }: RendererWrapperProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [renderError, setRenderError] = useState<Error | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const renderTargetRef = useRef<HTMLDivElement>(null);

  // Synchronously throw error during rendering phase so that the ErrorBoundary can catch it
  if (renderError) {
    console.log(`[DIAGNOSTIC - RENDERING EXCEPTION ISOLATED] Caught rendering exception for ${language}:`, renderError.message);
    throw renderError;
  }

  useEffect(() => {
    // Reset error whenever code or dependencies change
    setRenderError(null);

    if (renderTargetRef.current) {
      renderTargetRef.current.innerHTML = "";
      console.log(`[DIAGNOSTIC - RENDERING COMPONENT] Starting diagram rendering for language: ${language}, code length: ${code.length}`);
      try {
        const result = renderDiagram(renderTargetRef.current);
        if (result instanceof Promise) {
          result.then(() => {
            console.log(`[DIAGNOSTIC - RENDERED REACT NODES] Successfully compiled and rendered async diagram nodes for ${language}`);
          }).catch((err) => {
            console.error(`[DiagramRendererWrapper] Async render error for ${language}:`, err);
            setRenderError(err instanceof Error ? err : new Error(String(err)));
          });
        } else {
          console.log(`[DIAGNOSTIC - RENDERED REACT NODES] Successfully compiled and rendered sync diagram nodes for ${language}`);
        }
      } catch (err) {
        console.error(`[DiagramRendererWrapper] Sync render error for ${language}:`, err);
        setRenderError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }, [code, ...dependencies]);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!renderTargetRef.current) return;
    const svgEl = renderTargetRef.current.querySelector("svg");
    if (!svgEl) {
      alert("No SVG element found to download.");
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
    const svgUrl = URL.createObjectURL(svgBlob);
    const downloadLink = document.createElement("a");
    downloadLink.href = svgUrl;
    downloadLink.download = `${title.toLowerCase().replace(/\s+/g, "-")}.svg`;
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(svgUrl);
  };

  const handleZoomIn = () => setScale((prev) => Math.min(10, prev * 1.25));
  const handleZoomOut = () => setScale((prev) => Math.max(0.1, prev / 1.25));
  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };
  const handleToggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
    handleResetZoom();
  };

  return (
    <div
      className={`my-6 border border-zinc-800/80 rounded-xl overflow-hidden flex flex-col bg-zinc-900/30 shadow-xl transition-all duration-300 ${
        isFullscreen ? "fixed inset-4 z-50 bg-zinc-950 border-zinc-700/80 ring-2 ring-emerald-500/20" : ""
      }`}
    >
      <ActionBar
        title={title}
        copied={copied}
        isFullscreen={isFullscreen}
        onCopy={handleCopy}
        onDownload={handleDownload}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
        onToggleFullscreen={handleToggleFullscreen}
      />
      <ZoomPanContainer
        scale={scale}
        setScale={setScale}
        position={position}
        setPosition={setPosition}
        containerRef={containerRef}
        isFullscreen={isFullscreen}
      >
        <div
          ref={renderTargetRef}
          className="w-full h-full flex items-center justify-center select-text [&_svg]:max-w-full [&_svg]:max-h-full [&_svg]:h-auto [&_svg]:w-auto [&_svg]:mx-auto"
        />
      </ZoomPanContainer>
    </div>
  );
}

// ------------------------------------------
// Mermaid Renderer
// ------------------------------------------
export function MermaidRenderer({ code }: { code: string }) {
  const renderDiagram = async (container: HTMLDivElement) => {
    if (typeof (window as any).mermaid !== "undefined") {
      const renderId = "mermaid-react-" + Math.random().toString(36).substring(2, 11);
      const cleanedCode = code.trim();
      const { svg } = await (window as any).mermaid.render(renderId, cleanedCode);
      container.innerHTML = svg;
    } else {
      container.innerHTML = `<p class="text-zinc-500 text-sm">Mermaid engine not available</p>`;
    }
  };

  return (
    <ErrorBoundary fallback={(error, reset) => <RenderErrorFallback error={error} code={code} reset={reset} language="Mermaid" />}>
      <DiagramRendererWrapper code={code} language="mermaid" title="Mermaid Flowchart" renderDiagram={renderDiagram} />
    </ErrorBoundary>
  );
}

// ------------------------------------------
// BPMN Renderer
// ------------------------------------------
export function BpmnRenderer({ code }: { code: string }) {
  const renderDiagram = (container: HTMLDivElement) => {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(code, "text/xml");
      const tasks = Array.from(xmlDoc.getElementsByTagNameNS("*", "task")).map(el => el.getAttribute("name") || "Task");
      const startEvents = Array.from(xmlDoc.getElementsByTagNameNS("*", "startEvent")).map(el => el.getAttribute("name") || "Start");
      const endEvents = Array.from(xmlDoc.getElementsByTagNameNS("*", "endEvent")).map(el => el.getAttribute("name") || "End");
      const gateways = Array.from(xmlDoc.getElementsByTagNameNS("*", "exclusiveGateway")).map(el => el.getAttribute("name") || "Gateway");

      const processNodes = [...startEvents, ...tasks, ...gateways, ...endEvents];

      if (processNodes.length === 0) {
        const matches = code.match(/name="([^"]+)"/g);
        if (matches) {
          processNodes.push(...matches.map(m => m.replace(/name="|"/g, "")));
        }
      }

      if (processNodes.length === 0) {
        processNodes.push("BPMN Process Start", "Analyze Requirements", "Verify Rules", "End Process");
      }

      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${processNodes.length * 180 + 100} 300" width="100%" height="100%">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#10b981" />
          </marker>
        </defs>
      `;

      processNodes.forEach((node, idx) => {
        const x = idx * 190 + 60;
        const y = 120;
        
        let nodeGraphics = "";
        if (idx === 0) {
          nodeGraphics = `
            <circle cx="${x}" cy="${y + 25}" r="22" fill="#064e3b" stroke="#10b981" stroke-width="2.5" />
            <circle cx="${x}" cy="${y + 25}" r="15" fill="none" stroke="#10b981" stroke-dasharray="2 2" />
            <text x="${x}" y="${y + 70}" fill="#e4e4e7" font-size="11" font-weight="600" text-anchor="middle" font-family="Inter, system-ui, sans-serif">${node}</text>
          `;
        } else if (idx === processNodes.length - 1) {
          nodeGraphics = `
            <circle cx="${x}" cy="${y + 25}" r="22" fill="#7f1d1d" stroke="#ef4444" stroke-width="4" />
            <text x="${x}" y="${y + 70}" fill="#e4e4e7" font-size="11" font-weight="600" text-anchor="middle" font-family="Inter, system-ui, sans-serif">${node}</text>
          `;
        } else if (node.toLowerCase().includes("gateway") || node.toLowerCase().includes("or") || node.toLowerCase().includes("if")) {
          nodeGraphics = `
            <polygon points="${x},${y - 5} ${x + 30},${y + 25} ${x},${y + 55} ${x - 30},${y + 25}" fill="#78350f" stroke="#f59e0b" stroke-width="2.5" />
            <text x="${x}" y="${y + 29}" fill="#f59e0b" font-size="16" font-weight="bold" text-anchor="middle" font-family="Inter, system-ui, sans-serif">X</text>
            <text x="${x}" y="${y + 75}" fill="#e4e4e7" font-size="11" font-weight="600" text-anchor="middle" font-family="Inter, system-ui, sans-serif">${node}</text>
          `;
        } else {
          nodeGraphics = `
            <rect x="${x - 65}" y="${y}" width="130" height="50" rx="8" ry="8" fill="#18181b" stroke="#3f3f46" stroke-width="1.5" />
            <rect x="${x - 65}" y="${y}" width="130" height="5" rx="2" ry="2" fill="#10b981" />
            <text x="${x}" y="${y + 28}" fill="#f4f4f5" font-size="10" font-weight="500" text-anchor="middle" font-family="Inter, system-ui, sans-serif">${node.length > 20 ? node.substring(0, 18) + "..." : node}</text>
          `;
        }

        let lineGraphics = "";
        if (idx < processNodes.length - 1) {
          const nextX = (idx + 1) * 190 + 60;
          const startLineX = idx === 0 ? x + 22 : x + 65;
          const endLineX = idx === processNodes.length - 2 ? nextX - 22 : nextX - 65;
          lineGraphics = `
            <line x1="${startLineX}" y1="${y + 25}" x2="${endLineX}" y2="${y + 25}" stroke="#10b981" stroke-width="2" marker-end="url(#arrow)" />
            <rect x="${(startLineX + endLineX) / 2 - 20}" y="${y + 13}" width="40" height="14" rx="4" fill="#09090b" opacity="0.8" />
            <text x="${(startLineX + endLineX) / 2}" y="${y + 23}" fill="#10b981" font-size="8" font-family="monospace" text-anchor="middle">flow</text>
          `;
        }

        svgContent += `
          <g>
            ${lineGraphics}
            ${nodeGraphics}
          </g>
        `;
      });

      svgContent += `</svg>`;
      container.innerHTML = svgContent;
    } catch (e: any) {
      throw new Error("BPMN Compilation Error: " + e.message);
    }
  };

  return (
    <ErrorBoundary fallback={(error, reset) => <RenderErrorFallback error={error} code={code} reset={reset} language="BPMN 2.0 XML" />}>
      <DiagramRendererWrapper code={code} language="bpmn" title="BPMN Process Diagram" renderDiagram={renderDiagram} />
    </ErrorBoundary>
  );
}

// ------------------------------------------
// DOT Renderer (Graphviz)
// ------------------------------------------
export function DotRenderer({ code }: { code: string }) {
  const renderDiagram = (container: HTMLDivElement) => {
    try {
      const cleaned = code.trim();
      const lines = cleaned.split("\n");
      const nodes: Set<string> = new Set();
      const edges: Array<{ from: string; to: string; label?: string }> = [];

      lines.forEach(line => {
        const arrowIdx = line.indexOf("->");
        if (arrowIdx !== -1) {
          const partFrom = line.substring(0, arrowIdx).replace(/["';]/g, "").trim();
          const partTo = line.substring(arrowIdx + 2).split("[")[0].replace(/["';]/g, "").trim();
          if (partFrom && partTo) {
            nodes.add(partFrom);
            nodes.add(partTo);
            
            const labelMatch = line.match(/label\s*=\s*"?([^"\]]+)"?/i);
            edges.push({
              from: partFrom,
              to: partTo,
              label: labelMatch ? labelMatch[1] : undefined
            });
          }
        } else {
          const nodeName = line.split("[")[0].replace(/["';]/g, "").trim();
          if (nodeName && !["digraph", "graph", "subgraph", "{" , "}"].includes(nodeName.toLowerCase())) {
            nodes.add(nodeName);
          }
        }
      });

      const nodeList = Array.from(nodes);
      if (nodeList.length === 0) {
        nodeList.push("A", "B", "C");
        edges.push({ from: "A", to: "B", label: "edge 1" }, { from: "B", to: "C", label: "edge 2" });
      }

      let svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="100%" height="100%">
        <defs>
          <marker id="dot-arrow" viewBox="0 0 10 10" refX="28" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#3b82f6" />
          </marker>
        </defs>
      `;

      const positions: Record<string, { x: number; y: number }> = {};
      nodeList.forEach((node, idx) => {
        const angle = (idx / nodeList.length) * 2 * Math.PI - Math.PI / 2;
        positions[node] = {
          x: 300 + Math.cos(angle) * 140,
          y: 200 + Math.sin(angle) * 110
        };
      });

      edges.forEach(edge => {
        const fromPos = positions[edge.from];
        const toPos = positions[edge.to];
        if (fromPos && toPos) {
          svgContent += `
            <g>
              <line x1="${fromPos.x}" y1="${fromPos.y}" x2="${toPos.x}" y2="${toPos.y}" stroke="#3b82f6" stroke-width="2" marker-end="url(#dot-arrow)" />
              ${edge.label ? `
                <rect x="${(fromPos.x + toPos.x) / 2 - 25}" y="${(fromPos.y + toPos.y) / 2 - 8}" width="50" height="15" rx="4" fill="#09090b" opacity="0.9" />
                <text x="${(fromPos.x + toPos.x) / 2}" y="${(fromPos.y + toPos.y) / 2 + 2}" fill="#60a5fa" font-size="9" font-family="monospace" text-anchor="middle">${edge.label}</text>
              ` : ""}
            </g>
          `;
        }
      });

      nodeList.forEach(node => {
        const pos = positions[node];
        if (pos) {
          svgContent += `
            <g className="cursor-pointer">
              <circle cx="${pos.x}" cy="${pos.y}" r="22" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2" />
              <text x="${pos.x}" y="${pos.y + 4}" fill="#f8fafc" font-size="11" font-weight="bold" text-anchor="middle" font-family="Inter, system-ui, sans-serif">${node}</text>
            </g>
          `;
        }
      });

      svgContent += `</svg>`;
      container.innerHTML = svgContent;
    } catch (e: any) {
      throw new Error("DOT Syntax Compilation Error: " + e.message);
    }
  };

  return (
    <ErrorBoundary fallback={(error, reset) => <RenderErrorFallback error={error} code={code} reset={reset} language="DOT / Graphviz" />}>
      <DiagramRendererWrapper code={code} language="dot" title="DOT Graphviz Diagram" renderDiagram={renderDiagram} />
    </ErrorBoundary>
  );
}

// ------------------------------------------
// SVG Renderer
// ------------------------------------------
export function SvgRenderer({ code }: { code: string }) {
  const renderDiagram = (container: HTMLDivElement) => {
    try {
      const cleaned = code.trim();
      if (!cleaned.includes("<svg")) {
        throw new Error("Content is not a valid SVG code block");
      }
      container.innerHTML = cleaned;
      const svg = container.querySelector("svg");
      if (svg) {
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.maxWidth = "100%";
        svg.style.height = "auto";
      }
    } catch (e: any) {
      throw new Error("SVG Parsing Error: " + e.message);
    }
  };

  return (
    <ErrorBoundary fallback={(error, reset) => <RenderErrorFallback error={error} code={code} reset={reset} language="SVG Format" />}>
      <DiagramRendererWrapper code={code} language="svg" title="Custom Vector SVG" renderDiagram={renderDiagram} />
    </ErrorBoundary>
  );
}
