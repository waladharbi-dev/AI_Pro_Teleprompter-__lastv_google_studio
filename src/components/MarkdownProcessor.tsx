import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { MermaidRenderer, BpmnRenderer, DotRenderer, SvgRenderer } from "./DiagramRenderers";

interface MarkdownProcessorProps {
  content: string;
  isGenerating: boolean;
  fontSize: number;
  fontWeight: string;
  lineHeight: number;
  paragraphSpacing: number;
}

export function MarkdownProcessor({
  content,
  isGenerating,
  fontSize,
  fontWeight,
  lineHeight,
  paragraphSpacing,
}: MarkdownProcessorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [htmlContent, setHtmlContent] = useState("");
  const rootsRef = useRef<any[]>([]);

  // Convert raw Markdown text to standard parsed HTML
  useEffect(() => {
    console.log(`[DIAGNOSTIC - MARKDOWN PROCESSOR INPUT] Received content with length: ${content ? content.length : 0} characters.`);
    if (!content) {
      setHtmlContent("");
      return;
    }

    // Diagnostics for parsed sections in raw markdown
    const hasQuestion = content.includes("QUESTION");
    const hasAnswer = content.includes("ANSWER");
    const mermaidCount = (content.match(/```mermaid/gi) || []).length;
    console.log(`[DIAGNOSTIC - PARSED SECTIONS] QUESTION found: ${hasQuestion} | ANSWER found: ${hasAnswer} | Mermaid blocks found: ${mermaidCount}`);

    let parsedHtml = "";
    if (typeof (window as any).marked !== "undefined") {
      try {
        parsedHtml = (window as any).marked.parse(content);
        console.log(`[DIAGNOSTIC - HTML GENERATED] Marked successfully generated HTML of length: ${parsedHtml.length} characters.`);
      } catch (e) {
        console.error("Marked parsing error:", e);
        parsedHtml = content.replace(/\n/g, "<br />");
        console.log(`[DIAGNOSTIC - HTML GENERATED] Fallback HTML generated of length: ${parsedHtml.length} characters.`);
      }
    } else {
      parsedHtml = content.replace(/\n/g, "<br />");
      console.log(`[DIAGNOSTIC - HTML GENERATED] No marked engine. Fallback HTML generated of length: ${parsedHtml.length} characters.`);
    }

    setHtmlContent(parsedHtml);
  }, [content]);

  // Cleanup all active React roots on component unmount
  useEffect(() => {
    return () => {
      rootsRef.current.forEach((root) => {
        try {
          root.unmount();
        } catch (e) {
          // Ignore cleanup errors
        }
      });
      rootsRef.current = [];
    };
  }, []);

  // Post-process HTML to find fenced diagram code blocks and render interactive widgets
  useEffect(() => {
    if (!containerRef.current || !htmlContent) return;

    // First, unmount any previous custom diagram React roots to prevent leaks and duplication
    rootsRef.current.forEach((root) => {
      try {
        root.unmount();
      } catch (e) {
        // Ignore unmount warnings
      }
    });
    rootsRef.current = [];

    const container = containerRef.current;
    const preElements = Array.from(container.querySelectorAll("pre"));
    console.log(`[DIAGNOSTIC - DIAGRAM EXTRACTION START] Found ${preElements.length} <pre> element(s) in HTML content.`);

    preElements.forEach((pre) => {
      const codeElement = pre.querySelector("code");
      if (!codeElement) return;

      // Extract raw code and identify the visual language class
      const codeText = codeElement.textContent || "";
      const classList = Array.from(codeElement.classList);
      const mermaidClass = classList.find((c) => c.startsWith("language-") || c === "mermaid");
      
      let lang = "";
      if (mermaidClass) {
        if (mermaidClass.startsWith("language-")) {
          lang = mermaidClass.replace("language-", "").toLowerCase();
        } else if (mermaidClass === "mermaid") {
          lang = "mermaid";
        }
      }

      // Support the four core diagram visualization types
      const supportedLangs = ["mermaid", "bpmn", "dot", "svg"];
      if (supportedLangs.includes(lang)) {
        const cleanedCode = codeText.trim();
        if (!cleanedCode) return;

        console.log(`[DIAGNOSTIC - DIAGRAM BLOCK FOUND] Found diagram block of type: ${lang}, size: ${cleanedCode.length} characters.`);

        if (isGenerating) {
          // Render a high-fidelity animated streaming skeleton placeholder while the AI generator is running
          const skeletonDiv = document.createElement("div");
          skeletonDiv.className = "my-6 p-5 bg-zinc-900/30 border border-zinc-800/40 rounded-xl flex flex-col space-y-2 animate-pulse w-full";
          skeletonDiv.style.marginBottom = `${paragraphSpacing}rem`;
          skeletonDiv.innerHTML = `
            <div class="flex items-center space-x-2 text-zinc-400 text-xs uppercase tracking-wider font-semibold">
              <div class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div>
              <span>Streaming dynamic visual flowchart (${lang})...</span>
            </div>
            <pre class="bg-zinc-950/40 p-3 rounded-lg border border-zinc-800/20 font-mono text-xs text-zinc-500 overflow-x-auto">${cleanedCode.substring(0, 120)}${cleanedCode.length > 120 ? "..." : ""}</pre>
          `;
          pre.replaceWith(skeletonDiv);
        } else {
          // Instantiate a wrapper div to inject the corresponding interactive diagram renderer React component
          const rendererDiv = document.createElement("div");
          rendererDiv.className = "diagram-interactive-wrapper w-full";
          rendererDiv.style.marginBottom = `${paragraphSpacing}rem`;
          
          pre.replaceWith(rendererDiv);

          try {
            const root = ReactDOM.createRoot(rendererDiv);
            rootsRef.current.push(root);

            if (lang === "mermaid") {
              root.render(<MermaidRenderer code={cleanedCode} />);
            } else if (lang === "bpmn") {
              root.render(<BpmnRenderer code={cleanedCode} />);
            } else if (lang === "dot") {
              root.render(<DotRenderer code={cleanedCode} />);
            } else if (lang === "svg") {
              root.render(<SvgRenderer code={cleanedCode} />);
            }
          } catch (err) {
            console.error(`Failed to mount interactive renderer for ${lang}:`, err);
          }
        }
      }
    });
  }, [htmlContent, isGenerating, paragraphSpacing]);

  return (
    <div
      ref={containerRef}
      className="markdown-processor-container select-text"
      style={{
        fontSize: `${fontSize}px`,
        fontWeight: fontWeight,
        lineHeight: lineHeight,
      }}
    >
      <div
        className="prose prose-invert max-w-none select-text [&>p]:mb-[var(--p-spacing)] [&>h1]:mb-[var(--p-spacing)] [&>h2]:mb-[var(--p-spacing)] [&>h3]:mb-[var(--p-spacing)] [&>ul]:mb-[var(--p-spacing)] [&>ol]:mb-[var(--p-spacing)] [&>table]:mb-[var(--p-spacing)] [&>pre]:mb-[var(--p-spacing)]"
        style={{
          "--p-spacing": `${paragraphSpacing}rem`,
        } as React.CSSProperties}
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    </div>
  );
}
