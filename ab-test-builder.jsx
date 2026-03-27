import { useState, useRef, useEffect } from "react";

// ─── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert frontend developer and A/B testing specialist with deep knowledge of SiteSpect's client-side variation system.

The user will describe design changes they want to test on a webpage. Your job is to:
1. Analyze the request and the provided HTML source
2. Generate precise CSS and JavaScript changes as separate "factors" for SiteSpect
3. For each change, suggest the most appropriate SiteSpect trigger

Respond ONLY with a valid JSON object in this exact structure:
{
  "summary": "Brief human-readable summary of what changes will be made",
  "factors": [
    {
      "id": "unique_snake_case_id",
      "name": "Human readable factor name",
      "type": "css" | "html" | "attribute" | "js",
      "selector": "CSS selector string",
      "changes": [
        {
          "property": "CSS property or attribute name",
          "value": "new value",
          "changeType": "set_css" | "insert_html" | "set_attribute" | "custom_js"
        }
      ],
      "trigger": {
        "type": "path" | "query" | "hash" | "custom_js",
        "value": "trigger value or JS code",
        "rationale": "Why this trigger was chosen"
      },
      "sitespect_instructions": "Step-by-step instructions for entering this in SiteSpect UI"
    }
  ]
}

Rules:
- Split CSS changes and JS/HTML changes into SEPARATE factors
- Each factor = one Variation in SiteSpect with a specific CSS selector
- Prefer path triggers for page-level changes, query triggers for parameter-based pages
- Use custom_js triggers for SPA or dynamic content
- Be specific with CSS selectors based on the actual HTML provided
- For CSS changes: use set_css type, list each property/value pair
- For HTML changes: use insert_html type with full HTML string
- For attribute changes: use set_attribute type
- Do not include any text outside the JSON object`;

// ─── Utilities ────────────────────────────────────────────────────────────────

const VAR_COLORS = ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function applyFactorsToDoc(doc, factors) {
  factors.forEach((factor) => {
    try {
      const els = doc.querySelectorAll(factor.selector);
      els.forEach((el) => {
        factor.changes?.forEach((change) => {
          if (change.changeType === "set_css") el.style[change.property] = change.value;
          else if (change.changeType === "insert_html") el.innerHTML = change.value;
          else if (change.changeType === "set_attribute") el.setAttribute(change.property, change.value);
          else if (change.changeType === "custom_js") {
            try { (new Function("el", change.value))(el); } catch (e) {}
          }
        });
      });
    } catch (e) {}
  });
}

function generateExport(variation, pagePath = "/") {
  const jsSnippet = `// ============================================================
// SiteSpect Client-Side Variation Export
// Variation: ${variation.name}
// Generated: ${new Date().toISOString()}
// Trigger Path: ${pagePath}
// ============================================================

(function() {
  'use strict';

  var factors = ${JSON.stringify(
    variation.factors.map((f) => ({ id: f.id, name: f.name, selector: f.selector, changes: f.changes })),
    null, 2
  )};

  function applyFactor(factor) {
    var els = document.querySelectorAll(factor.selector);
    if (!els.length) return;
    els.forEach(function(el) {
      factor.changes.forEach(function(change) {
        switch (change.changeType) {
          case 'set_css': el.style[change.property] = change.value; break;
          case 'insert_html': el.innerHTML = change.value; break;
          case 'set_attribute': el.setAttribute(change.property, change.value); break;
          case 'custom_js': try { (new Function('el', change.value))(el); } catch(e) {} break;
        }
      });
    });
  }

  function applyAll() { factors.forEach(applyFactor); }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  } else { applyAll(); }

  var obs = new MutationObserver(applyAll);
  obs.observe(document.documentElement, { childList: true, subtree: true });
})();`;

  const jsonManifest = {
    variation: variation.name,
    exported_at: new Date().toISOString(),
    page_path: pagePath,
    factors: variation.factors.map((f) => ({
      factor_name: f.name,
      sitespect_type: "Client Side",
      selector: f.selector,
      trigger: f.trigger,
      changes: f.changes,
      sitespect_instructions: f.sitespect_instructions,
    })),
  };

  return { jsSnippet, jsonManifest };
}

const makeControl = () => ({ id: "control", name: "Control", isControl: true, factors: [], messages: [] });
const makeVariation = (n) => ({ id: uid(), name: `Variation ${n}`, isControl: false, factors: [], messages: [] });

// ─── DeviceToggle ─────────────────────────────────────────────────────────────

function DeviceToggle({ device, onChange }) {
  return (
    <div style={{ display: "flex", gap: "3px", background: "#161616", borderRadius: "8px", padding: "3px", border: "1px solid #222" }}>
      {[
        { id: "desktop", label: "Desktop", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg> },
        { id: "mobile", label: "Mobile", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="18" r="1"/></svg> },
      ].map((d) => (
        <button key={d.id} onClick={() => onChange(d.id)} style={{
          display: "flex", alignItems: "center", gap: "5px", padding: "5px 11px",
          borderRadius: "6px", border: "none", cursor: "pointer", fontSize: "12px", fontWeight: "500",
          background: device === d.id ? "#7c3aed" : "transparent",
          color: device === d.id ? "#fff" : "#555", transition: "all 0.15s",
        }}>
          {d.icon} {d.label}
        </button>
      ))}
    </div>
  );
}

// ─── FactorCard ───────────────────────────────────────────────────────────────

function FactorCard({ factor, onRemove }) {
  const [open, setOpen] = useState(false);
  const typeColor = { css: "#3b82f6", html: "#10b981", js: "#f59e0b", attribute: "#ec4899" }[factor.type] || "#888";
  const triggerLabel = { path: "Path", query: "Query", hash: "Hash", custom_js: "Custom JS" }[factor.trigger?.type] || "Path";
  return (
    <div style={{ background: "#171717", border: "1px solid #222", borderRadius: "8px", overflow: "hidden", marginBottom: "5px" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "7px", padding: "9px 11px", cursor: "pointer" }}>
        <span style={{ background: typeColor + "22", color: typeColor, fontSize: "9px", fontWeight: "700", letterSpacing: "0.08em", padding: "2px 5px", borderRadius: "3px", textTransform: "uppercase", flexShrink: 0 }}>{factor.type}</span>
        <span style={{ flex: 1, fontSize: "12px", color: "#bbb", fontWeight: "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{factor.name}</span>
        <span style={{ fontSize: "10px", color: "#7c3aed", background: "#7c3aed18", padding: "1px 5px", borderRadius: "3px", flexShrink: 0 }}>{triggerLabel}</span>
        <button onClick={(e) => { e.stopPropagation(); onRemove(factor.id); }} style={{ background: "none", border: "none", color: "#383838", cursor: "pointer", padding: "2px", display: "flex" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#383838" strokeWidth="2" style={{ transform: open ? "rotate(180deg)" : "none", transition: "0.2s", flexShrink: 0 }}><path d="M6 9l6 6 6-6"/></svg>
      </div>
      {open && (
        <div style={{ padding: "0 11px 11px", borderTop: "1px solid #1e1e1e" }}>
          <div style={{ marginTop: "9px" }}>
            <div style={{ fontSize: "9px", color: "#3a3a3a", fontWeight: "700", letterSpacing: "0.07em", marginBottom: "3px" }}>SELECTOR</div>
            <code style={{ fontSize: "11px", color: "#a78bfa", background: "#160f28", padding: "4px 7px", borderRadius: "4px", display: "block" }}>{factor.selector}</code>
          </div>
          <div style={{ marginTop: "7px" }}>
            <div style={{ fontSize: "9px", color: "#3a3a3a", fontWeight: "700", letterSpacing: "0.07em", marginBottom: "3px" }}>CHANGES</div>
            {factor.changes?.map((c, i) => (
              <div key={i} style={{ display: "flex", gap: "7px", fontSize: "11px", marginBottom: "2px" }}>
                <span style={{ color: "#484848", minWidth: "100px", flexShrink: 0 }}>{c.property}:</span>
                <span style={{ color: "#bbb", wordBreak: "break-all" }}>{c.value}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "7px" }}>
            <div style={{ fontSize: "9px", color: "#3a3a3a", fontWeight: "700", letterSpacing: "0.07em", marginBottom: "3px" }}>TRIGGER → {triggerLabel.toUpperCase()}</div>
            <code style={{ fontSize: "11px", color: "#34d399", background: "#071510", padding: "4px 7px", borderRadius: "4px", display: "block", marginBottom: "4px" }}>{factor.trigger?.value}</code>
            <p style={{ fontSize: "10px", color: "#484848", margin: 0, lineHeight: "1.6" }}>{factor.trigger?.rationale}</p>
          </div>
          {factor.sitespect_instructions && (
            <div style={{ marginTop: "7px" }}>
              <div style={{ fontSize: "9px", color: "#3a3a3a", fontWeight: "700", letterSpacing: "0.07em", marginBottom: "3px" }}>SITESPECT SETUP</div>
              <p style={{ fontSize: "10px", color: "#555", margin: 0, lineHeight: "1.6", whiteSpace: "pre-wrap" }}>{factor.sitespect_instructions}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── ExportModal ──────────────────────────────────────────────────────────────

function ExportModal({ variation, onClose }) {
  const [tab, setTab] = useState("js");
  const [copied, setCopied] = useState(false);
  const { jsSnippet, jsonManifest } = generateExport(variation);
  const content = tab === "js" ? jsSnippet : JSON.stringify(jsonManifest, null, 2);
  const copy = () => { navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "24px" }}>
      <div style={{ background: "#111", border: "1px solid #252525", borderRadius: "13px", width: "100%", maxWidth: "740px", maxHeight: "82vh", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "15px 17px", borderBottom: "1px solid #1c1c1c" }}>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff" }}>Export — {variation.name}</div>
            <div style={{ fontSize: "10px", color: "#444", marginTop: "2px" }}>{variation.factors.length} factor{variation.factors.length !== 1 ? "s" : ""} · SiteSpect Client-Side</div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: "7px", alignItems: "center" }}>
            <div style={{ display: "flex", background: "#1a1a1a", borderRadius: "7px", padding: "3px" }}>
              {[{ id: "js", label: "JS Snippet" }, { id: "json", label: "JSON Manifest" }].map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)} style={{ padding: "4px 10px", borderRadius: "5px", border: "none", background: tab === t.id ? "#7c3aed" : "transparent", color: tab === t.id ? "#fff" : "#555", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>{t.label}</button>
              ))}
            </div>
            <button onClick={copy} style={{ padding: "6px 12px", borderRadius: "6px", border: "none", background: copied ? "#10b981" : "#7c3aed", color: "#fff", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>{copied ? "✓ Copied" : "Copy"}</button>
            <button onClick={onClose} style={{ background: "#1a1a1a", border: "1px solid #222", borderRadius: "6px", color: "#555", width: "28px", height: "28px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px" }}>✕</button>
          </div>
        </div>
        {tab === "js" && (
          <div style={{ padding: "8px 17px", background: "#0c1520", borderBottom: "1px solid #16253a" }}>
            <p style={{ margin: 0, fontSize: "11px", color: "#5b9bd5", lineHeight: "1.6" }}>
              <strong>SiteSpect:</strong> New A/B Campaign → Variations → Find &amp; Replace → Type: <strong>Client Side</strong> → paste into <strong>Custom JavaScript</strong>.
            </p>
          </div>
        )}
        <pre style={{ flex: 1, overflow: "auto", margin: 0, padding: "13px 17px", fontSize: "11px", lineHeight: "1.7", color: "#a3e635", background: "#0a0a0a", fontFamily: "monospace", borderRadius: "0 0 13px 13px" }}>
          {content}
        </pre>
      </div>
    </div>
  );
}

// ─── VariationTabBar ──────────────────────────────────────────────────────────

function VariationTabBar({ variations, activeId, onSelect, onAdd, onRename, onDelete }) {
  const [editingId, setEditingId] = useState(null);
  const [editVal, setEditVal] = useState("");

  const startEdit = (v, e) => {
    if (v.isControl) return;
    e.stopPropagation();
    setEditingId(v.id); setEditVal(v.name);
  };
  const commitEdit = (id) => { if (editVal.trim()) onRename(id, editVal.trim()); setEditingId(null); };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px", padding: "8px 14px", borderBottom: "1px solid #1a1a1a", background: "#0f0f0f", overflowX: "auto", flexShrink: 0 }}>
      <span style={{ fontSize: "9px", color: "#333", fontWeight: "700", letterSpacing: "0.1em", marginRight: "6px", flexShrink: 0, whiteSpace: "nowrap" }}>PREVIEW</span>
      {variations.map((v, idx) => {
        const color = v.isControl ? "#4b5563" : VAR_COLORS[(idx - 1) % VAR_COLORS.length];
        const isActive = v.id === activeId;
        return (
          <div
            key={v.id}
            onClick={() => onSelect(v.id)}
            style={{
              display: "flex", alignItems: "center", gap: "6px",
              padding: "5px 10px", borderRadius: "7px", cursor: "pointer", flexShrink: 0,
              background: isActive ? color + "20" : "transparent",
              border: `1px solid ${isActive ? color + "60" : "#1e1e1e"}`,
              transition: "all 0.15s",
            }}
          >
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: color, flexShrink: 0 }} />
            {editingId === v.id ? (
              <input
                autoFocus value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onBlur={() => commitEdit(v.id)}
                onKeyDown={(e) => e.key === "Enter" && commitEdit(v.id)}
                onClick={(e) => e.stopPropagation()}
                style={{ background: "transparent", border: "none", outline: "none", color: "#fff", fontSize: "12px", fontWeight: "600", width: "80px" }}
              />
            ) : (
              <span
                onDoubleClick={(e) => startEdit(v, e)}
                title={v.isControl ? "Control — original" : "Double-click to rename"}
                style={{ fontSize: "12px", fontWeight: "600", color: isActive ? "#fff" : "#555", userSelect: "none", whiteSpace: "nowrap" }}
              >
                {v.name}
              </span>
            )}
            {v.factors.length > 0 && (
              <span style={{ fontSize: "9px", color: color, background: color + "20", padding: "1px 4px", borderRadius: "3px" }}>{v.factors.length}</span>
            )}
            {!v.isControl && variations.filter(x => !x.isControl).length > 1 && (
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
                style={{ background: "none", border: "none", color: "#333", cursor: "pointer", padding: "0 0 0 1px", display: "flex", lineHeight: 1 }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
        );
      })}
      <button
        onClick={onAdd}
        style={{
          display: "flex", alignItems: "center", gap: "4px", padding: "5px 9px",
          borderRadius: "7px", border: "1px dashed #252525", background: "transparent",
          color: "#444", cursor: "pointer", fontSize: "11px", flexShrink: 0, transition: "all 0.15s",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
        Add Variation
      </button>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function ABTestBuilder() {
  const [device, setDevice] = useState("desktop");
  const [htmlSource, setHtmlSource] = useState("");
  const [variations, setVariations] = useState([makeControl(), makeVariation(1)]);
  const [activeVarId, setActiveVarId] = useState("control");
  const [promptText, setPromptText] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeCodeTab, setActiveCodeTab] = useState("html");
  const [showExport, setShowExport] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const fileInputRef = useRef(null);
  const iframeRef = useRef(null);
  const chatEndRef = useRef(null);

  const activeVar = variations.find((v) => v.id === activeVarId) || variations[0];
  const varCount = variations.filter((v) => !v.isControl).length;

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [activeVar.messages]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !htmlSource) return;
    const inject = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc) applyFactorsToDoc(doc, activeVar.factors);
      } catch (e) {}
    };
    iframe.onload = inject;
    const t = setTimeout(inject, 100);
    return () => clearTimeout(t);
  }, [activeVar.factors, previewKey, activeVarId, htmlSource]);

  const updateVar = (id, fn) => setVariations((prev) => prev.map((v) => v.id === id ? { ...v, ...fn(v) } : v));

  const handleFileUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setHtmlSource(ev.target.result);
      setPreviewKey((k) => k + 1);
      setVariations((prev) => prev.map((v) => ({ ...v, messages: [...v.messages, { role: "system", text: `✓ Loaded "${file.name}" (${(file.size / 1024).toFixed(1)} KB)` }] })));
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handlePrompt = async () => {
    if (!promptText.trim() || activeVar.isControl || !htmlSource) return;
    const userMsg = { role: "user", text: promptText };
    updateVar(activeVarId, (v) => ({ messages: [...v.messages, userMsg] }));
    setPromptText("");
    setLoading(true);

    const truncatedHTML = htmlSource.slice(0, 8000);
    const history = activeVar.messages
      .filter((m) => m.role === "user" || m.role === "assistant_raw")
      .map((m) => ({ role: m.role === "assistant_raw" ? "assistant" : "user", content: m.text }));

    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 1000, system: SYSTEM_PROMPT,
          messages: [...history, { role: "user", content: `Page HTML:\n\`\`\`html\n${truncatedHTML}\n\`\`\`\n\nRequest: ${promptText}` }],
        }),
      });
      const data = await res.json();
      const raw = data.content?.map((b) => b.text || "").join("") || "";
      let parsed;
      try { const m = raw.match(/\{[\s\S]*\}/); parsed = JSON.parse(m?.[0] || raw); }
      catch { updateVar(activeVarId, (v) => ({ messages: [...v.messages, { role: "system", text: "⚠️ Could not parse response." }] })); setLoading(false); return; }

      updateVar(activeVarId, (v) => {
        const newFactors = parsed.factors || [];
        const newIds = new Set(newFactors.map((f) => f.id));
        return {
          messages: [...v.messages, { role: "assistant", text: parsed.summary || "Changes generated.", factorCount: newFactors.length }, { role: "assistant_raw", text: raw }],
          factors: [...v.factors.filter((f) => !newIds.has(f.id)), ...newFactors],
        };
      });
      setPreviewKey((k) => k + 1);
    } catch (err) {
      updateVar(activeVarId, (v) => ({ messages: [...v.messages, { role: "system", text: `⚠️ Error: ${err.message}` }] }));
    }
    setLoading(false);
  };

  const addVariation = () => {
    const n = varCount + 1;
    const nv = makeVariation(n);
    setVariations((prev) => [...prev, nv]);
    setActiveVarId(nv.id);
  };

  const codeContent = (() => {
    if (activeCodeTab === "html") return htmlSource || "<!-- No source loaded -->";
    if (activeCodeTab === "css") {
      const cf = activeVar.factors.filter((f) => f.type === "css");
      return cf.length ? cf.flatMap((f) => f.changes?.map((c) => `/* ${f.name} */\n${f.selector} { ${c.property}: ${c.value}; }`)).join("\n\n") : "/* No CSS changes for this variation */";
    }
    const jf = activeVar.factors.filter((f) => f.type !== "css");
    return jf.length ? jf.map((f) => `/* ${f.name} | ${f.selector} */\n// Trigger: ${f.trigger?.type} → ${f.trigger?.value}`).join("\n\n") : "// No JS/HTML changes";
  })();

  const activeVarColor = activeVar.isControl ? "#4b5563" : VAR_COLORS[(variations.indexOf(activeVar) - 1) % VAR_COLORS.length];
  const canExport = !activeVar.isControl && activeVar.factors.length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0d0d0d", color: "#e5e7eb", fontFamily: "'DM Sans', 'Inter', system-ui, sans-serif" }}>

      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #171717", background: "#111", flexShrink: 0, gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "9px" }}>
          <div style={{ width: "26px", height: "26px", background: "#7c3aed", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: "700", color: "#fff", lineHeight: 1 }}>A/B Test Builder</div>
            <div style={{ fontSize: "10px", color: "#3a3a3a", marginTop: "2px" }}>Describe the design changes you want to test</div>
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          <DeviceToggle device={device} onChange={setDevice} />
          <button
            onClick={() => canExport && setShowExport(true)}
            disabled={!canExport}
            style={{
              display: "flex", alignItems: "center", gap: "5px", padding: "6px 13px",
              borderRadius: "7px", border: "none",
              background: canExport ? "#7c3aed" : "#181818",
              color: canExport ? "#fff" : "#383838",
              fontSize: "12px", fontWeight: "600",
              cursor: canExport ? "pointer" : "not-allowed",
              transition: "all 0.15s",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Export {canExport ? `(${activeVar.factors.length})` : ""}
          </button>
        </div>
      </div>

      {/* Main split */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

        {/* LEFT PANEL */}
        <div style={{ width: "390px", flexShrink: 0, borderRight: "1px solid #171717", display: "flex", flexDirection: "column", background: "#111" }}>

          {/* Import */}
          <div style={{ padding: "11px 13px", borderBottom: "1px solid #171717" }}>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".html,.htm" style={{ display: "none" }} />
            <button
              onClick={() => fileInputRef.current?.click()}
              style={{
                width: "100%", padding: "8px 11px", background: "#161616",
                border: "1px dashed #252525", borderRadius: "8px", color: "#555",
                cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
              {htmlSource ? "✓ Page loaded — import another" : "Import page source (.html)"}
            </button>
          </div>

          {/* Active variation indicator */}
          <div style={{ padding: "7px 13px", borderBottom: "1px solid #171717", display: "flex", alignItems: "center", gap: "7px", background: "#0f0f0f" }}>
            <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: activeVarColor, flexShrink: 0 }} />
            <span style={{ fontSize: "11px", fontWeight: "600", color: "#666" }}>{activeVar.name}</span>
            {activeVar.isControl
              ? <span style={{ fontSize: "10px", color: "#333", marginLeft: "2px" }}>— select a variation to prompt</span>
              : <span style={{ fontSize: "10px", color: "#444", marginLeft: "2px" }}>— {activeVar.factors.length} factor{activeVar.factors.length !== 1 ? "s" : ""}</span>
            }
          </div>

          {/* Chat */}
          <div style={{ flex: 1, overflowY: "auto", padding: "13px", display: "flex", flexDirection: "column", gap: "7px" }}>
            {activeVar.messages.filter((m) => m.role !== "assistant_raw").length === 0 && (
              <div style={{ textAlign: "center", padding: "30px 16px" }}>
                <div style={{ fontSize: "26px", marginBottom: "9px" }}>{activeVar.isControl ? "🔒" : "🧪"}</div>
                <div style={{ fontSize: "12px", color: "#333", lineHeight: "1.9" }}>
                  {activeVar.isControl
                    ? "Control shows the original page.\nSwitch to a variation tab to make changes."
                    : "Describe the design changes you want\nto test for this variation."}
                </div>
              </div>
            )}
            {activeVar.messages.filter((m) => m.role !== "assistant_raw").map((msg, i) => (
              <div key={i} style={{ display: "flex", justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}>
                <div style={{
                  maxWidth: "88%", padding: "8px 11px", borderRadius: "9px", fontSize: "12px", lineHeight: "1.6",
                  background: msg.role === "user" ? "#7c3aed" : msg.role === "system" ? "#141414" : "#191b22",
                  color: msg.role === "user" ? "#fff" : msg.role === "system" ? "#484848" : "#bbb",
                  border: msg.role === "assistant" ? "1px solid #202020" : "none",
                }}>
                  {msg.text}
                  {msg.role === "assistant" && msg.factorCount > 0 && (
                    <div style={{ marginTop: "4px", fontSize: "10px", color: "#7c3aed", fontWeight: "600" }}>↓ {msg.factorCount} factor{msg.factorCount !== 1 ? "s" : ""} added</div>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex" }}>
                <div style={{ padding: "8px 11px", borderRadius: "9px", background: "#191b22", border: "1px solid #202020", fontSize: "12px", color: "#404040" }}>Analyzing…</div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Factors */}
          {activeVar.factors.length > 0 && (
            <div style={{ padding: "10px 13px", borderTop: "1px solid #171717", maxHeight: "250px", overflowY: "auto" }}>
              <div style={{ fontSize: "9px", color: "#383838", fontWeight: "700", letterSpacing: "0.09em", marginBottom: "7px" }}>SITESPECT FACTORS ({activeVar.factors.length})</div>
              {activeVar.factors.map((f) => (
                <FactorCard key={f.id} factor={f} onRemove={(id) => updateVar(activeVarId, (v) => ({ factors: v.factors.filter((x) => x.id !== id) }))} />
              ))}
            </div>
          )}

          {/* Prompt input */}
          <div style={{ padding: "11px 13px", borderTop: "1px solid #171717" }}>
            <div style={{ fontSize: "9px", color: "#383838", fontWeight: "700", letterSpacing: "0.07em", marginBottom: "6px" }}>DESIGN CHANGE PROMPT</div>
            <textarea
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handlePrompt(); }}
              disabled={activeVar.isControl}
              placeholder={activeVar.isControl ? "Select a variation tab to prompt changes…" : "e.g., Make the CTA button orange and larger…"}
              style={{
                width: "100%", minHeight: "72px", background: "#161616",
                border: "1px solid #202020", borderRadius: "8px",
                color: activeVar.isControl ? "#2a2a2a" : "#ddd",
                fontSize: "12px", padding: "9px 11px",
                resize: "vertical", outline: "none", boxSizing: "border-box",
                lineHeight: "1.6", fontFamily: "inherit",
                cursor: activeVar.isControl ? "not-allowed" : "text",
              }}
            />
            <button
              onClick={handlePrompt}
              disabled={loading || !promptText.trim() || activeVar.isControl}
              style={{
                width: "100%", marginTop: "6px", padding: "9px",
                background: (loading || !promptText.trim() || activeVar.isControl) ? "#161616" : "#7c3aed",
                border: "none", borderRadius: "8px",
                color: (loading || !promptText.trim() || activeVar.isControl) ? "#383838" : "#fff",
                fontSize: "13px", fontWeight: "600",
                cursor: (loading || !promptText.trim() || activeVar.isControl) ? "not-allowed" : "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: "6px",
                transition: "background 0.15s",
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              {loading ? "Applying…" : "Apply Changes"}
            </button>
            <div style={{ fontSize: "9px", color: "#2a2a2a", textAlign: "center", marginTop: "4px" }}>⌘ + Enter to submit</div>
          </div>
        </div>

        {/* RIGHT PANEL */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

          {/* Variation tab bar */}
          <VariationTabBar
            variations={variations}
            activeId={activeVarId}
            onSelect={(id) => { setActiveVarId(id); setPreviewKey((k) => k + 1); }}
            onAdd={addVariation}
            onRename={(id, name) => setVariations((prev) => prev.map((v) => v.id === id ? { ...v, name } : v))}
            onDelete={(id) => { setVariations((prev) => prev.filter((v) => v.id !== id)); if (activeVarId === id) setActiveVarId("control"); }}
          />

          {/* Preview */}
          <div style={{ flex: 1, background: "#090909", display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: "18px" }}>
            {htmlSource ? (
              <div style={{
                width: device === "mobile" ? "375px" : "100%",
                minHeight: "100%",
                boxShadow: `0 0 0 1px ${activeVarColor}40, 0 16px 48px #00000099`,
                borderRadius: device === "mobile" ? "18px" : "8px",
                overflow: "hidden", transition: "width 0.3s ease", background: "#fff",
              }}>
                {/* Variation badge */}
                <div style={{
                  background: activeVar.isControl ? "#1f2937ee" : activeVarColor + "ee",
                  color: "#fff", fontSize: "9px", fontWeight: "700", letterSpacing: "0.09em",
                  padding: "5px 11px", display: "flex", alignItems: "center", gap: "6px",
                }}>
                  <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#ffffff99" }} />
                  {activeVar.name.toUpperCase()}
                  {activeVar.isControl
                    ? " — ORIGINAL (NO CHANGES)"
                    : ` — ${activeVar.factors.length} FACTOR${activeVar.factors.length !== 1 ? "S" : ""} APPLIED`
                  }
                </div>
                <iframe
                  key={`${previewKey}-${activeVarId}`}
                  ref={iframeRef}
                  srcDoc={htmlSource}
                  style={{ width: "100%", height: "580px", border: "none", display: "block" }}
                  title="Page Preview"
                  sandbox="allow-scripts allow-same-origin"
                />
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: "12px" }}>
                <div style={{ width: "64px", height: "64px", border: "1px dashed #1e1e1e", borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#252525" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                </div>
                <div style={{ fontSize: "12px", color: "#2a2a2a", textAlign: "center", lineHeight: "1.9" }}>
                  Import a page source to see a live preview
                </div>
              </div>
            )}
          </div>

          {/* Code viewer */}
          <div style={{ borderTop: "1px solid #171717", flexShrink: 0 }}>
            <div style={{ display: "flex", background: "#0f0f0f", borderBottom: "1px solid #171717" }}>
              {[
                { id: "html", label: "HTML" },
                { id: "css", label: `CSS${activeVar.factors.filter((f) => f.type === "css").length > 0 ? ` (${activeVar.factors.filter((f) => f.type === "css").length})` : ""}` },
                { id: "js", label: `JS${activeVar.factors.filter((f) => f.type !== "css").length > 0 ? ` (${activeVar.factors.filter((f) => f.type !== "css").length})` : ""}` },
              ].map((t) => (
                <button key={t.id} onClick={() => setActiveCodeTab(t.id)} style={{
                  padding: "8px 16px", border: "none", cursor: "pointer",
                  background: activeCodeTab === t.id ? "#171717" : "transparent",
                  color: activeCodeTab === t.id ? "#7c3aed" : "#383838",
                  fontSize: "11px", fontWeight: "600",
                  borderBottom: activeCodeTab === t.id ? "2px solid #7c3aed" : "2px solid transparent",
                }}>{t.label}</button>
              ))}
            </div>
            <pre style={{
              margin: 0, padding: "11px 14px", background: "#0a0a0a", color: "#303030",
              fontSize: "11px", lineHeight: "1.7", fontFamily: "monospace",
              height: "130px", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {codeContent}
            </pre>
          </div>
        </div>
      </div>

      {showExport && <ExportModal variation={activeVar} onClose={() => setShowExport(false)} />}
    </div>
  );
}
