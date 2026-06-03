import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

// ─── FIREBASE DOCS ────────────────────────────────────────────────────────────
const SHEETS_DOC   = doc(db, "cargo", "sheets");
const SETTINGS_DOC = doc(db, "cargo", "settings");

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uid      = () => Math.random().toString(36).slice(2, 9);
const cleanNum = v  => parseFloat(String(v).replace(/[$,\s=]/g, "")) || 0;
const cleanBool= v  => v === true || String(v).toLowerCase() === "yes" || String(v).toLowerCase() === "\u05DB\u05DF";

// ─── EMAIL TEMPLATE ───────────────────────────────────────────────────────────
const DEFAULT_TEMPLATE = [
  "Hello,",
  "",
  "Please find the supply order for {{date}} below:",
  "",
  "{{items}}",
  "",
  "Estimated total: ${{totalCost}}",
  "",
  "Please confirm receipt.",
  "",
  "Thank you"
].join("\n");

// ─── ACCESS PIN ───────────────────────────────────────────────────────────────
const ACCESS_PIN = "1234";

// ─── DEFAULT DATA ─────────────────────────────────────────────────────────────
const DEFAULT_SHEETS = [
  {
    id: "s1",
    name: "Uline JFK",
    supplier: "ULINE",
    color: "#2563EB",
    items: [
      { id:"d1", name:"Uline Industrial Tape CLEAR", unitsPerPack:36, orderQty:0, costPerUnit:1.99,  modelNumber:"S-423",   received:false, link:"https://www.uline.com/Product/Detail/S-423", amazonName:"", notes:"" },
      { id:"d2", name:"Colored Handwrap Green",      unitsPerPack:4,  orderQty:0, costPerUnit:26,    modelNumber:"S-2900G", received:false, link:"", amazonName:"", notes:"" },
    ],
  },
  {
    id: "s2",
    name: "Amazon",
    supplier: "AMAZON",
    color: "#F59E0B",
    items: [
      { id:"d3", name:"HP 206A Toner Set",       unitsPerPack:1, orderQty:0, costPerUnit:329.86, modelNumber:"", received:false, link:"", amazonName:"HP 206A Black/Cyan/Magenta/Yellow", notes:"" },
      { id:"d4", name:"Logitech MK235 Keyboard", unitsPerPack:1, orderQty:0, costPerUnit:27.99,  modelNumber:"", received:false, link:"", amazonName:"Logitech MK235 Wireless Keyboard",  notes:"" },
    ],
  },
];

// ─── EXCEL PARSER ─────────────────────────────────────────────────────────────
function parseWorkbook(wb) {
  const COLORS = ["#2563EB","#F59E0B","#10B981","#8B5CF6","#EF4444","#06B6D4","#EC4899"];
  const result = [];

  for (const sheetName of wb.SheetNames) {
    const ws      = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(ws, { header:1, defval:"" });
    if (!rawRows.length) continue;

    // Find header row containing "מוצר"
    let headerIdx = -1;
    let supplier  = "";
    for (let i = 0; i < Math.min(rawRows.length, 5); i++) {
      const row = rawRows[i];
      if (row.some(c => String(c).trim() === "\u05DE\u05D5\u05E6\u05E8")) { headerIdx = i; break; }
      if (i === 1 && row[0]) supplier = String(row[0]).trim();
    }
    if (headerIdx === -1) continue;

    const headers = rawRows[headerIdx].map(h => String(h).trim());
    const dataRows = rawRows.slice(headerIdx + 1);
    const idx = name => headers.findIndex(h => h === name);

    const nameIdx  = idx("\u05DE\u05D5\u05E6\u05E8");
    const packIdx  = idx("\u05D9\u05D7\u05D9\u05D3\u05D5\u05EA \u05D1\u05DE\u05D0\u05E8\u05D6");
    const qtyIdx   = idx("\u05DB\u05DE\u05D5\u05EA \u05DC\u05D4\u05D6\u05DE\u05E0\u05D4");
    const costIdx  = idx("\u05E2\u05DC\u05D5\u05EA \u05DC\u05D9\u05D7\u05D9\u05D3\u05D4");
    const modelIdx = idx("MODEL Number");
    const rcvdIdx  = idx("\u05E7\u05D9\u05D1\u05DC\u05E0\u05D5 \u05D0\u05EA \u05D4\u05D4\u05D6\u05DE\u05E0\u05D4");
    const linkIdx  = idx("Link");
    const aNameIdx = idx("\u05E9\u05DD \u05D1\u05D0\u05DE\u05D6\u05D5\u05DF");

    if (nameIdx === -1) continue;

    const isAmazon = sheetName.toLowerCase().includes("amazon") || supplier.toLowerCase().includes("amazon");

    // Build display name
    let displayName = sheetName
      .replace(/april\s*/i, "")
      .trim();
    if (!displayName) displayName = sheetName;

    const items = dataRows
      .map(row => ({
        id:           uid(),
        name:         String(row[nameIdx] || "").trim(),
        unitsPerPack: packIdx  >= 0 ? cleanNum(row[packIdx])             : 1,
        orderQty:     qtyIdx   >= 0 ? cleanNum(row[qtyIdx])              : 0,
        costPerUnit:  costIdx  >= 0 ? cleanNum(row[costIdx])             : 0,
        modelNumber:  modelIdx >= 0 ? String(row[modelIdx] || "").trim() : "",
        received:     rcvdIdx  >= 0 ? cleanBool(row[rcvdIdx])            : false,
        link:         linkIdx  >= 0 ? String(row[linkIdx] || "").trim()  : "",
        amazonName:   aNameIdx >= 0 ? String(row[aNameIdx] || "").trim() : "",
        notes:        "",
      }))
      .filter(r => r.name.length > 0 && !r.name.startsWith("\u05DE\u05D3\u05D1\u05E7\u05D5\u05EA"));

    if (!items.length) continue;

    result.push({
      id:       uid(),
      name:     displayName,
      supplier: isAmazon ? "AMAZON" : "ULINE",
      color:    COLORS[result.length % COLORS.length],
      items,
    });
  }
  return result;
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg:      "#F1F5F9",
  surface: "#FFFFFF",
  border:  "#E2E8F0",
  text:    "#1E293B",
  muted:   "#64748B",
  subtle:  "#94A3B8",
  primary: "#2563EB",
  success: "#10B981",
  warning: "#F59E0B",
  danger:  "#EF4444",
  hover:   "#F8FAFC",
};

// ─── SHARED STYLES ────────────────────────────────────────────────────────────
const S = {
  input: {
    width:"100%", background:C.surface, border:`1px solid ${C.border}`,
    color:C.text, borderRadius:6, padding:"8px 10px", fontSize:13,
    outline:"none", boxSizing:"border-box", fontFamily:"inherit",
    transition:"border-color .15s",
  },
  btn: {
    background:C.primary, border:"none", color:"#fff", borderRadius:6,
    padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer",
    fontFamily:"inherit",
  },
  ghost: {
    background:"transparent", border:`1px solid ${C.border}`, color:C.muted,
    borderRadius:6, padding:"8px 14px", fontSize:13, cursor:"pointer",
    fontFamily:"inherit", transition:"all .15s",
  },
  cancel: {
    background:C.surface, border:`1px solid ${C.border}`, color:C.muted,
    borderRadius:6, padding:"9px 0", fontSize:13, cursor:"pointer",
    fontFamily:"inherit", flex:1,
  },
  primary: {
    background:C.primary, border:"none", color:"#fff", borderRadius:6,
    padding:"9px 0", fontSize:13, fontWeight:600, cursor:"pointer",
    fontFamily:"inherit", flex:2,
  },
  icon: {
    background:"none", border:"none", cursor:"pointer", fontSize:13,
    padding:"3px 6px", borderRadius:4, transition:"all 0.15s", color:C.subtle,
  },
  stepBtn: {
    width:22, height:22, borderRadius:4, background:C.hover,
    border:`1px solid ${C.border}`, color:C.muted, cursor:"pointer",
    fontSize:14, display:"flex", alignItems:"center", justifyContent:"center",
    fontWeight:700, padding:0,
  },
};

// ─── SPINNER ──────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:C.bg }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{ width:32, height:32, border:`3px solid ${C.border}`, borderTop:`3px solid ${C.primary}`, borderRadius:"50%", animation:"spin .8s linear infinite" }} />
    </div>
  );
}

// ─── QTY STEPPER ─────────────────────────────────────────────────────────────
function QtyStep({ value, onChange }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4, justifyContent:"center" }}>
      <button style={S.stepBtn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span style={{ minWidth:28, textAlign:"center", fontFamily:"monospace", fontWeight:700, fontSize:13, color:value > 0 ? C.primary : C.subtle }}>
        {value}
      </span>
      <button style={S.stepBtn} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

// ─── INLINE EDIT ──────────────────────────────────────────────────────────────
function InlineEdit({ value, type="text", placeholder="—", onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  const commit = () => {
    setEditing(false);
    const v = type === "number" ? (parseFloat(draft) || 0) : draft;
    if (v !== value) onCommit(v);
  };

  if (editing) return (
    <input autoFocus type={type} value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key==="Enter") commit(); if (e.key==="Escape") setEditing(false); }}
      style={{ width:"100%", background:C.hover, border:`1px solid ${C.primary}`, color:C.text, borderRadius:4, padding:"3px 6px", fontSize:12, outline:"none", textAlign:"center", boxSizing:"border-box", direction:"ltr" }}
    />
  );

  return (
    <span
      title="Click to edit"
      onClick={() => { setDraft(value); setEditing(true); }}
      onMouseEnter={e => { e.currentTarget.style.background = C.hover; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
      style={{ cursor:"text", color:value ? C.text : C.subtle, fontSize:12, display:"block", textAlign:"center", padding:"2px 4px", borderRadius:3, direction:"ltr", transition:"background .1s" }}
    >
      {value || <span style={{ color:C.subtle, fontStyle:"italic" }}>{placeholder}</span>}
    </span>
  );
}

// ─── BADGE ────────────────────────────────────────────────────────────────────
function Badge({ label, color }) {
  return (
    <span style={{ background:`${color}18`, color, border:`1px solid ${color}30`, borderRadius:99, padding:"1px 7px", fontSize:10, fontWeight:700, whiteSpace:"nowrap" }}>
      {label}
    </span>
  );
}

// ─── PIN SCREEN ───────────────────────────────────────────────────────────────
function PinScreen({ onUnlock }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);

  const submit = () => {
    if (pin === ACCESS_PIN) { onUnlock(); }
    else { setErr(true); setPin(""); setTimeout(() => setErr(false), 2000); }
  };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ background:C.surface, borderRadius:16, padding:"40px 48px", boxShadow:"0 4px 24px rgba(0,0,0,0.08)", border:`1px solid ${C.border}`, textAlign:"center", minWidth:320 }}>
        <div style={{ background:C.primary, width:48, height:48, borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, margin:"0 auto 16px" }}>✈️</div>
        <div style={{ fontSize:20, fontWeight:700, color:C.text, marginBottom:4 }}>Cargo Supply CRM</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:28 }}>Enter your PIN to continue</div>
        <input
          type="password" value={pin} autoFocus placeholder="••••"
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key==="Enter" && submit()}
          style={{ ...S.input, textAlign:"center", letterSpacing:"0.3em", fontSize:20, padding:"12px 18px", marginBottom:err?8:12, border:`1px solid ${err ? C.danger : C.border}` }}
        />
        {err && <div style={{ color:C.danger, fontSize:12, marginBottom:8 }}>Incorrect PIN. Try again.</div>}
        <button onClick={submit} style={{ ...S.btn, width:"100%", padding:"11px 0", fontSize:14, justifyContent:"center" }}>
          Unlock
        </button>
      </div>
    </div>
  );
}

// ─── ITEM MODAL ───────────────────────────────────────────────────────────────
function ItemModal({ item, isAmazon, onSave, onClose }) {
  const blank = { id:uid(), name:"", unitsPerPack:1, orderQty:0, costPerUnit:0, modelNumber:"", received:false, link:"", amazonName:"", notes:"" };
  const [form, setForm] = useState(item ? { ...item } : blank);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const ff  = e => { e.target.style.borderColor = C.primary; };
  const fb  = e => { e.target.style.borderColor = C.border; };

  const fields = [
    { key:"name",         label:"Item Name",             type:"text"   },
    ...(isAmazon
      ? [{ key:"amazonName", label:"Amazon Product Name", type:"text" }]
      : [{ key:"modelNumber", label:"Model Number",       type:"text" }]
    ),
    ...(!isAmazon ? [{ key:"unitsPerPack", label:"Units per Pack", type:"number" }] : []),
    { key:"orderQty",    label:"Order Quantity",          type:"number" },
    { key:"costPerUnit", label:"Cost per Unit ($)",       type:"number" },
    { key:"link",        label:"Product Link",            type:"text"   },
    { key:"notes",       label:"Notes",                   type:"text"   },
  ];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.4)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:C.surface, borderRadius:14, padding:28, width:440, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.15)", border:`1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:20, color:C.text }}>{item ? "Edit Item" : "Add New Item"}</div>
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:C.muted, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{f.label}</div>
            <input type={f.type} value={form[f.key]}
              onChange={e => set(f.key, f.type==="number" ? (parseFloat(e.target.value)||0) : e.target.value)}
              style={{ ...S.input, direction:"ltr" }}
              onFocus={ff} onBlur={fb}
            />
          </div>
        ))}
        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button style={S.cancel} onClick={onClose}>Cancel</button>
          <button style={S.primary} onClick={() => { onSave({ ...form }); onClose(); }}>
            {item ? "Save Changes" : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SHEET MODAL ──────────────────────────────────────────────────────────────
function SheetModal({ sheet, onSave, onClose }) {
  const PALETTE = ["#2563EB","#F59E0B","#10B981","#8B5CF6","#EF4444","#06B6D4","#EC4899","#F97316"];
  const [name,     setName]     = useState(sheet ? sheet.name     : "");
  const [supplier, setSupplier] = useState(sheet ? sheet.supplier : "ULINE");
  const [color,    setColor]    = useState(sheet ? sheet.color    : PALETTE[0]);
  const ff = e => { e.target.style.borderColor = C.primary; };
  const fb = e => { e.target.style.borderColor = C.border; };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.4)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:C.surface, borderRadius:14, padding:28, width:380, boxShadow:"0 20px 60px rgba(0,0,0,0.15)", border:`1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:20, color:C.text }}>{sheet ? "Edit Tab" : "New Tab"}</div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:C.muted, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>Tab Name</div>
          <input value={name} onChange={e => setName(e.target.value)} style={S.input} onFocus={ff} onBlur={fb} />
        </div>

        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:C.muted, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>Supplier</div>
          <select value={supplier} onChange={e => setSupplier(e.target.value)} style={{ ...S.input, cursor:"pointer" }} onFocus={ff} onBlur={fb}>
            <option value="ULINE">Uline</option>
            <option value="AMAZON">Amazon</option>
            <option value="OTHER">Other</option>
          </select>
        </div>

        <div style={{ marginBottom:20 }}>
          <div style={{ fontSize:11, color:C.muted, marginBottom:8, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>Color</div>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {PALETTE.map(col => (
              <button key={col} onClick={() => setColor(col)}
                style={{ width:28, height:28, borderRadius:6, background:col, border:`3px solid ${color===col ? C.text : "transparent"}`, cursor:"pointer", transition:"border .1s" }} />
            ))}
          </div>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          <button style={S.cancel} onClick={onClose}>Cancel</button>
          <button style={S.primary} onClick={() => { if (name.trim()) { onSave({ name:name.trim(), supplier, color }); onClose(); } }}>
            {sheet ? "Save" : "Create Tab"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── TEMPLATE EDITOR ──────────────────────────────────────────────────────────
function TemplateEditor({ template, onSave, onClose }) {
  const [val, setVal] = useState(template);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.4)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:C.surface, borderRadius:14, padding:28, width:520, boxShadow:"0 20px 60px rgba(0,0,0,0.15)", border:`1px solid ${C.border}` }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:700, marginBottom:8, color:C.text }}>Edit Email Template</div>
        <div style={{ fontSize:12, color:C.muted, marginBottom:16, lineHeight:1.8 }}>
          Variables:&nbsp;
          {["{{date}}", "{{items}}", "{{totalCost}}"].map(v => (
            <code key={v} style={{ background:C.bg, padding:"1px 6px", borderRadius:3, color:C.primary, margin:"0 3px", fontSize:11 }}>{v}</code>
          ))}
        </div>
        <textarea value={val} rows={12} onChange={e => setVal(e.target.value)}
          style={{ width:"100%", background:C.bg, border:`1px solid ${C.border}`, color:C.text, borderRadius:8, padding:14, fontSize:13, outline:"none", resize:"vertical", lineHeight:1.8, boxSizing:"border-box", fontFamily:"inherit" }}
          onFocus={e => { e.target.style.borderColor=C.primary; }}
          onBlur={e => { e.target.style.borderColor=C.border; }}
        />
        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button style={S.cancel} onClick={onClose}>Cancel</button>
          <button style={S.primary} onClick={() => { onSave(val); onClose(); }}>Save Template</button>
        </div>
      </div>
    </div>
  );
}

// ─── SEND EMAIL FLOW ──────────────────────────────────────────────────────────
function SendFlow({ orderItems, sheetName, template, onClose }) {
  const [step,    setStep]    = useState("input");
  const [to,      setTo]      = useState("");
  const [subject, setSubject] = useState("Supply Order \u2013 " + new Date().toLocaleDateString());
  const [preview, setPreview] = useState(null);
  const total = orderItems.reduce((s,i) => s + i.orderQty * i.costPerUnit, 0).toFixed(2);

  const buildBody = () => {
    const date = new Date().toLocaleDateString("en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
    const lines = orderItems.map(i => {
      let line = i.name + " - Qty: " + i.orderQty + " | Cost: $" + (i.orderQty * i.costPerUnit).toFixed(2);
      if (i.link && i.link.startsWith("http")) line += "\n\nLink: " + i.link;
      return line;
    }).join("\n\n");
    return template
      .replace("{{date}}", date)
      .replace("{{items}}", lines)
      .replace("{{totalCost}}", total);
  };

  const doSend = () => {
    const uri = `mailto:${encodeURIComponent(preview.to)}?subject=${encodeURIComponent(preview.subject)}&body=${encodeURIComponent(preview.body)}`;
    window.open(uri, "_self");
    setStep("sent");
  };

  const lbl = { fontSize:10, color:C.subtle, textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 };
  const box = { background:C.bg, borderRadius:6, padding:"8px 12px", fontSize:13, color:C.text };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,0.4)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }}
      onClick={step==="sending" ? undefined : onClose}>
      <div style={{ background:C.surface, borderRadius:14, padding:28, width:480, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.15)", border:`1px solid ${C.border}` }}
        onClick={e => e.stopPropagation()}>

        {step === "input" && <>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:4, color:C.text }}>Send Order Email</div>
          <div style={{ fontSize:12, color:C.muted, marginBottom:16 }}>{sheetName} &middot; {orderItems.length} items &middot; ${total}</div>
          <div style={{ background:C.bg, borderRadius:8, padding:"10px 14px", marginBottom:18, maxHeight:140, overflowY:"auto" }}>
            {orderItems.map(i => (
              <div key={i.id} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:C.muted, padding:"4px 0", borderBottom:`1px solid ${C.border}` }}>
                <span>{i.name}</span>
                <span style={{ color:C.primary, fontFamily:"monospace", fontWeight:600 }}>x{i.orderQty} = ${(i.orderQty*i.costPerUnit).toFixed(2)}</span>
              </div>
            ))}
          </div>
          {[
            { l:"Recipient", v:to,      s:setTo      },
            { l:"Subject",   v:subject, s:setSubject },
          ].map(f => (
            <div key={f.l} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:C.muted, marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>{f.l}</div>
              <input value={f.v} onChange={e => f.s(e.target.value)} style={{ ...S.input, direction:"ltr" }}
                onFocus={e => { e.target.style.borderColor=C.primary; }} onBlur={e => { e.target.style.borderColor=C.border; }} />
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:20 }}>
            <button style={S.cancel} onClick={onClose}>Cancel</button>
            <button disabled={!to.trim()} onClick={() => { setPreview({ to, subject, body:buildBody() }); setStep("preview"); }}
              style={{ ...S.primary, background:to.trim()?C.primary:C.border, color:to.trim()?"#fff":C.muted, cursor:to.trim()?"pointer":"not-allowed" }}>
              Preview &rarr;
            </button>
          </div>
        </>}

        {step === "preview" && preview && <>
          <div style={{ fontSize:16, fontWeight:700, marginBottom:20, color:C.text }}>Email Preview</div>
          {[{ l:"To", v:preview.to }, { l:"Subject", v:preview.subject }].map(f => (
            <div key={f.l} style={{ marginBottom:12 }}>
              <div style={lbl}>{f.l}</div>
              <div style={box}>{f.v}</div>
            </div>
          ))}
          <div style={{ marginBottom:20 }}>
            <div style={lbl}>Body</div>
            <div style={{ ...box, whiteSpace:"pre-wrap", lineHeight:1.8, maxHeight:200, overflowY:"auto", fontSize:12, color:C.muted }}>{preview.body}</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button style={S.cancel} onClick={() => setStep("input")}>&larr; Back</button>
            <button style={S.primary} onClick={doSend}>Send Now &#9993;</button>
          </div>
        </>}

        {step === "sent" && (
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>&#9993;</div>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:6, color:C.text }}>Email Client Opened</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:24 }}>Draft ready to {preview && preview.to} — hit Send in your mail app.</div>
            <button style={{ ...S.btn, margin:"0 auto" }} onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [unlocked,       setUnlocked]       = useState(false);
  const [sheets,         setSheets]         = useState(null);
  const [template,       setTemplate]       = useState(DEFAULT_TEMPLATE);
  const [activeSheet,    setActiveSheet]    = useState(0);
  const [search,         setSearch]         = useState("");
  const [showAdd,        setShowAdd]        = useState(false);
  const [editItem,       setEditItem]       = useState(null);
  const [showTpl,        setShowTpl]        = useState(false);
  const [showEmail,      setShowEmail]      = useState(false);
  const [showSheetModal, setShowSheetModal] = useState(false);
  const [editSheetIdx,   setEditSheetIdx]   = useState(null);
  const [syncStatus,     setSyncStatus]     = useState("ok");
  const fileRef   = useRef();
  const saveTimer = useRef(null);

  // ── PIN ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    try { if (sessionStorage.getItem("cargo-unlocked") === "1") setUnlocked(true); } catch {}
  }, []);

  const handleUnlock = () => {
    try { sessionStorage.setItem("cargo-unlocked", "1"); } catch {}
    setUnlocked(true);
  };

  // ── Firebase ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!unlocked) return;
    const unsub = onSnapshot(SHEETS_DOC, snap => {
      if (snap.exists()) { setSheets(snap.data().sheets || DEFAULT_SHEETS); }
      else { setDoc(SHEETS_DOC, { sheets: DEFAULT_SHEETS }); setSheets(DEFAULT_SHEETS); }
    }, () => {
      setSheets(DEFAULT_SHEETS);
      setSyncStatus("error");
    });
    getDoc(SETTINGS_DOC).then(snap => {
      if (snap.exists()) setTemplate(snap.data().template || DEFAULT_TEMPLATE);
    }).catch(() => {});
    return () => unsub();
  }, [unlocked]);

  const saveSheets = newSheets => {
    setSyncStatus("syncing");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await setDoc(SHEETS_DOC, { sheets: newSheets });
      setSyncStatus("ok");
    }, 800);
  };

  const setAndSave = newSheets => { setSheets(newSheets); saveSheets(newSheets); };

  // ── Sheet operations ───────────────────────────────────────────────────────
  const addSheet    = data => { const s = { id:uid(), items:[], ...data }; setAndSave([...sheets, s]); setActiveSheet(sheets.length); };
  const updateSheet = (idx, data) => setAndSave(sheets.map((s,i) => i===idx ? { ...s, ...data } : s));
  const deleteSheet = idx => { setAndSave(sheets.filter((_,i) => i!==idx)); setActiveSheet(Math.max(0, activeSheet - 1)); };

  // ── Item operations ────────────────────────────────────────────────────────
  const patchSheetItems = (si, items) => setAndSave(sheets.map((s,i) => i===si ? { ...s, items } : s));
  const upsertItem = item => {
    const items = sheets[activeSheet].items;
    patchSheetItems(activeSheet, items.find(i=>i.id===item.id) ? items.map(i=>i.id===item.id?item:i) : [...items,item]);
  };
  const removeItem = id => patchSheetItems(activeSheet, sheets[activeSheet].items.filter(i=>i.id!==id));
  const patchItem  = (id, patch) => patchSheetItems(activeSheet, sheets[activeSheet].items.map(i=>i.id===id?{...i,...patch}:i));

  // ── Excel import (smart merge) ────────────────────────────────────────────
  const mergeSheets = (current, incoming) => {
    const result = current.map(s => ({ ...s, items: [...s.items] }));
    let added = 0;
    for (const imp of incoming) {
      const idx = result.findIndex(s => s.name.toLowerCase() === imp.name.toLowerCase());
      if (idx >= 0) {
        const isAllDefaults = result[idx].items.every(i => /^d\d+$/.test(i.id));
        if (isAllDefaults) {
          result[idx] = { ...result[idx], items: imp.items };
          added += imp.items.length;
        } else {
          const existing = new Set(result[idx].items.map(i => i.name.toLowerCase()));
          const newItems = imp.items.filter(i => !existing.has(i.name.toLowerCase()));
          result[idx].items.push(...newItems);
          added += newItems.length;
        }
      } else {
        result.push(imp);
        added += imp.items.length;
      }
    }
    return { sheets: result, added };
  };

  const handleExcel = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type:"array" });
        const parsed = parseWorkbook(wb);
        if (parsed.length > 0) {
          const { sheets: merged, added } = mergeSheets(sheets, parsed);
          setAndSave(merged);
          setActiveSheet(0);
          alert(added > 0
            ? "Added " + added + " new item(s)."
            : "No new items \u2014 everything is already up to date.");
        } else {
          alert("No data found. Make sure sheets have a \u05DE\u05D5\u05E6\u05E8 column header.");
        }
      } catch (err) { alert("Error: " + err.message); }
      e.target.value = "";
    };
    reader.readAsArrayBuffer(file);
  };

  // ── Guards ─────────────────────────────────────────────────────────────────
  if (!unlocked) return <PinScreen onUnlock={handleUnlock} />;
  if (!sheets)   return <Spinner />;

  const si     = Math.min(activeSheet, sheets.length - 1);
  const sheet  = sheets[si];
  if (!sheet)  return <Spinner />;

  const resetQty = () => {
    if (!window.confirm("Reset all order quantities to 0 for this tab?")) return;
    patchSheetItems(si, sheet.items.map(i => ({ ...i, orderQty: 0 })));
  };

  const isAmazon   = sheet.supplier === "AMAZON";
  const filtered   = sheet.items.filter(i =>
    !search
    || i.name.toLowerCase().includes(search.toLowerCase())
    || (i.modelNumber||"").toLowerCase().includes(search.toLowerCase())
    || (i.amazonName||"").toLowerCase().includes(search.toLowerCase())
  );
  const orderItems  = sheet.items.filter(i => i.orderQty > 0 && !i.received);
  const orderTotal  = orderItems.reduce((s,i) => s + i.orderQty*i.costPerUnit, 0).toFixed(2);
  const globalTotal = sheets.reduce((s,sh) => s + sh.items.filter(i=>i.orderQty>0&&!i.received).reduce((a,i)=>a+i.orderQty*i.costPerUnit,0), 0).toFixed(2);
  const globalOrder = sheets.reduce((n,sh) => n + sh.items.filter(i=>i.orderQty>0&&!i.received).length, 0);

  const COLS = isAmazon
    ? "2fr 1.4fr 1fr 0.8fr 0.8fr 0.6fr 0.5fr 52px"
    : "2fr 0.7fr 1fr 0.7fr 0.8fr 0.85fr 0.6fr 0.5fr 52px";

  const colHeaders = isAmazon
    ? ["Item Name", "Amazon Name", "Order Qty", "Unit ($)", "Total", "Link", "Rcvd", ""]
    : ["Item Name", "Per Pack", "Order Qty", "Unit ($)", "Total", "Model #", "Link", "Rcvd", ""];

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'DM Sans','Segoe UI',sans-serif" }}>
      <style>
        {"@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');" +
         "::-webkit-scrollbar{width:5px;height:5px}" +
         "::-webkit-scrollbar-track{background:" + C.bg + "}" +
         "::-webkit-scrollbar-thumb{background:" + C.border + ";border-radius:3px}"}
      </style>

      {/* ── HEADER ── */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, position:"sticky", top:0, zIndex:20, boxShadow:"0 1px 3px rgba(0,0,0,0.05)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12 }}>
          <div style={{ background:C.primary, borderRadius:8, width:34, height:34, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 }}>&#9992;&#65039;</div>
          <div>
            <div style={{ fontSize:14, fontWeight:700, color:C.text }}>Cargo Supply CRM</div>
            <div style={{ fontSize:11, color:C.subtle }}>
              {globalOrder > 0
                ? <span style={{ color:C.primary, fontWeight:600 }}>{globalOrder} items to order &middot; ${globalTotal}</span>
                : "All caught up"
              }
              &nbsp;&middot;&nbsp;
              <span style={{ color:syncStatus==="syncing"?C.warning:syncStatus==="error"?C.danger:C.success, fontWeight:600 }}>
                {syncStatus==="syncing" ? "Syncing\u2026" : syncStatus==="error" ? "Offline (local only)" : "Saved \u2713"}
              </span>
            </div>
          </div>
        </div>

        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items..."
            style={{ ...S.input, width:180, padding:"7px 12px" }}
            onFocus={e=>{e.target.style.borderColor=C.primary;}} onBlur={e=>{e.target.style.borderColor=C.border;}}
          />
          <input type="file" accept=".xlsx,.xls,.csv" ref={fileRef} onChange={handleExcel} style={{ display:"none" }} />
          <button style={S.ghost} onClick={()=>fileRef.current.click()}
            onMouseEnter={e=>{e.currentTarget.style.background=C.bg;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            &#11014; Import Excel
          </button>
          <button style={S.ghost} onClick={()=>setShowTpl(true)}
            onMouseEnter={e=>{e.currentTarget.style.background=C.bg;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            &#9993; Template
          </button>
          <button style={{ ...S.ghost, borderColor:`${C.primary}40`, color:C.primary }}
            onClick={()=>setShowAdd(true)}
            onMouseEnter={e=>{e.currentTarget.style.background=`${C.primary}08`;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
            + Add Item
          </button>
          <button disabled={orderItems.length===0} onClick={()=>setShowEmail(true)}
            style={{ ...S.btn, background:orderItems.length?C.primary:C.border, color:orderItems.length?"#fff":C.subtle, cursor:orderItems.length?"pointer":"not-allowed" }}>
            &#9993; Order{orderItems.length > 0 ? " (" + orderItems.length + ")" : ""}
          </button>
        </div>
      </div>

      {/* ── TABS ── */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"0 24px", display:"flex", alignItems:"center", gap:0, overflowX:"auto" }}>
        {sheets.map((s, i) => {
          const sheetOrder = s.items.filter(it=>it.orderQty>0&&!it.received).length;
          const active     = si === i;
          return (
            <div key={s.id} style={{ display:"flex", alignItems:"center", position:"relative" }}>
              <button onClick={() => { setActiveSheet(i); setSearch(""); }}
                style={{ padding:"13px 16px", border:"none", background:"transparent", cursor:"pointer", fontFamily:"inherit", fontSize:13, fontWeight:600, color:active?s.color:C.muted, borderBottom:active?`2px solid ${s.color}`:"2px solid transparent", transition:"all .15s", whiteSpace:"nowrap", display:"flex", alignItems:"center", gap:7, outline:"none" }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:s.color, display:"inline-block", flexShrink:0 }} />
                {s.name}
                <Badge label={s.supplier} color={s.color} />
                {sheetOrder > 0 && (
                  <span style={{ background:s.color, color:"#fff", borderRadius:99, padding:"0 6px", fontSize:10, fontWeight:700 }}>{sheetOrder}</span>
                )}
              </button>
              {active && (
                <button onClick={() => { setEditSheetIdx(i); setShowSheetModal(true); }}
                  style={{ ...S.icon, fontSize:11, marginLeft:-6, padding:"2px 5px" }}
                  title="Edit tab"
                  onMouseEnter={e=>{e.currentTarget.style.color=C.primary;}} onMouseLeave={e=>{e.currentTarget.style.color=C.subtle;}}>
                  &#9998;
                </button>
              )}
            </div>
          );
        })}
        <button onClick={() => { setEditSheetIdx(null); setShowSheetModal(true); }}
          style={{ padding:"13px 14px", border:"none", background:"transparent", cursor:"pointer", fontFamily:"inherit", fontSize:13, color:C.subtle, whiteSpace:"nowrap", outline:"none" }}
          onMouseEnter={e=>{e.currentTarget.style.color=C.primary;}} onMouseLeave={e=>{e.currentTarget.style.color=C.subtle;}}>
          + New Tab
        </button>
      </div>

      {/* ── STATS BAR ── */}
      <div style={{ background:C.surface, borderBottom:`1px solid ${C.border}`, padding:"12px 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ display:"flex", gap:32 }}>
          {[
            { label:"Total Items", value:sheet.items.length,                                              color:C.text    },
            { label:"To Order",    value:orderItems.length,                                               color:C.primary },
            { label:"Received",    value:sheet.items.filter(i=>i.received).length,                        color:C.success },
            { label:"Order Total", value:"$" + orderTotal,                                                color:C.warning },
          ].map(stat => (
            <div key={stat.label}>
              <div style={{ fontSize:10, color:C.subtle, textTransform:"uppercase", letterSpacing:"0.06em", fontWeight:600 }}>{stat.label}</div>
              <div style={{ fontSize:20, fontWeight:700, color:stat.color, lineHeight:1.2 }}>{stat.value}</div>
            </div>
          ))}
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {orderItems.length > 0 && (
            <button onClick={resetQty}
              style={{ ...S.ghost, color:C.warning, borderColor:`${C.warning}30`, fontSize:12 }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${C.warning}08`;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
              ↺ Reset Qty
            </button>
          )}
          {sheets.length > 1 && (
            <button onClick={() => deleteSheet(si)}
              style={{ ...S.ghost, color:C.danger, borderColor:`${C.danger}30`, fontSize:12 }}
              onMouseEnter={e=>{e.currentTarget.style.background=`${C.danger}08`;}} onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
              Delete Tab
            </button>
          )}
        </div>
      </div>

      {/* ── TABLE HEADER ── */}
      <div style={{ display:"grid", gridTemplateColumns:COLS, gap:8, padding:"8px 24px", borderBottom:`1px solid ${C.border}`, position:"sticky", top:56, zIndex:9, background:C.bg }}>
        {colHeaders.map((h,i) => (
          <span key={i} style={{ fontSize:10, color:C.subtle, letterSpacing:"0.07em", textTransform:"uppercase", fontWeight:700, textAlign:i===0?"left":"center" }}>
            {h}
          </span>
        ))}
      </div>

      {/* ── TABLE ROWS ── */}
      <div style={{ background:C.surface }}>
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:60, color:C.subtle, fontSize:13 }}>
            {search ? "No items match your search." : "No items yet. Import Excel or click \u201C+ Add Item\u201D."}
          </div>
        )}
        {filtered.map(item => (
          <div key={item.id}
            style={{ display:"grid", gridTemplateColumns:COLS, gap:8, padding:"9px 24px", borderBottom:`1px solid ${C.border}`, alignItems:"center", transition:"background .08s" }}
            onMouseEnter={e => { e.currentTarget.style.background = C.hover; }}
            onMouseLeave={e => { e.currentTarget.style.background = C.surface; }}>

            {/* Name */}
            <div style={{ display:"flex", alignItems:"center", gap:8, overflow:"hidden" }}>
              {item.orderQty > 0 && !item.received && (
                <span style={{ width:6, height:6, borderRadius:"50%", background:sheet.color, flexShrink:0 }} />
              )}
              <span title={item.name} onDoubleClick={() => setEditItem(item)}
                style={{ fontSize:13, fontWeight:500, color:item.received?C.subtle:C.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration:item.received?"line-through":"none" }}>
                {item.name}
              </span>
              {item.received && <Badge label="Rcvd" color={C.success} />}
            </div>

            {/* Per pack or Amazon name */}
            {isAmazon
              ? <InlineEdit value={item.amazonName||""} placeholder="—" onCommit={v => patchItem(item.id, { amazonName:v })} />
              : <InlineEdit value={item.unitsPerPack} type="number" onCommit={v => patchItem(item.id, { unitsPerPack:v })} />
            }

            <QtyStep value={item.orderQty} onChange={v => patchItem(item.id, { orderQty:v })} />

            <InlineEdit value={item.costPerUnit>0?item.costPerUnit.toFixed(2):""} type="number" placeholder="0.00" onCommit={v => patchItem(item.id, { costPerUnit:v })} />

            {/* Total */}
            <div style={{ textAlign:"center", fontFamily:"monospace", fontSize:12, fontWeight:600, color:item.orderQty>0&&!item.received?C.primary:C.subtle }}>
              {item.orderQty > 0 ? "$" + (item.orderQty*item.costPerUnit).toFixed(2) : "\u2014"}
            </div>

            {/* Model (Uline only) */}
            {!isAmazon && (
              <InlineEdit value={item.modelNumber||""} placeholder="—" onCommit={v => patchItem(item.id, { modelNumber:v })} />
            )}

            {/* Link */}
            <div style={{ textAlign:"center" }}>
              {item.link && item.link.startsWith("http")
                ? <a href={item.link} target="_blank" rel="noopener noreferrer"
                    style={{ color:C.primary, fontSize:12, textDecoration:"none", fontWeight:500 }}>
                    &#128279; Open
                  </a>
                : <InlineEdit value={item.link||""} placeholder="+ URL" onCommit={v => patchItem(item.id, { link:v })} />
              }
            </div>

            {/* Received checkbox */}
            <div style={{ display:"flex", justifyContent:"center" }}>
              <button onClick={() => patchItem(item.id, { received:!item.received })}
                title={item.received ? "Mark as pending" : "Mark as received"}
                style={{ width:22, height:22, borderRadius:5, border:`2px solid ${item.received?C.success:C.border}`, background:item.received?`${C.success}15`:"transparent", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", color:C.success, transition:"all .15s" }}>
                {item.received ? "\u2713" : ""}
              </button>
            </div>

            {/* Edit / Delete */}
            <div style={{ display:"flex", gap:2, justifyContent:"center" }}>
              <button style={S.icon} onClick={() => setEditItem(item)}
                onMouseEnter={e=>{e.currentTarget.style.color=C.primary;e.currentTarget.style.background=`${C.primary}10`;}}
                onMouseLeave={e=>{e.currentTarget.style.color=C.subtle;e.currentTarget.style.background="transparent";}}>
                &#9998;
              </button>
              <button style={S.icon} onClick={() => removeItem(item.id)}
                onMouseEnter={e=>{e.currentTarget.style.color=C.danger;e.currentTarget.style.background=`${C.danger}10`;}}
                onMouseLeave={e=>{e.currentTarget.style.color=C.subtle;e.currentTarget.style.background="transparent";}}>
                &#215;
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── FOOTER ── */}
      {orderItems.length > 0 && (
        <div style={{ padding:"12px 24px", borderTop:`1px solid ${C.border}`, display:"flex", justifyContent:"flex-end", alignItems:"center", gap:20, fontSize:13, background:C.surface, position:"sticky", bottom:0, zIndex:10 }}>
          <span style={{ color:C.muted }}>{orderItems.length} items to order in {sheet.name}</span>
          <span style={{ color:C.primary, fontWeight:700, fontFamily:"monospace", fontSize:14 }}>Total: ${orderTotal}</span>
        </div>
      )}

      {/* ── MODALS ── */}
      {showAdd && (
        <ItemModal isAmazon={isAmazon} onSave={upsertItem} onClose={() => setShowAdd(false)} />
      )}
      {editItem && (
        <ItemModal item={editItem} isAmazon={isAmazon} onSave={upsertItem} onClose={() => setEditItem(null)} />
      )}
      {showTpl && (
        <TemplateEditor template={template} onSave={tpl => { setTemplate(tpl); setDoc(SETTINGS_DOC, { template:tpl }); }} onClose={() => setShowTpl(false)} />
      )}
      {showEmail && (
        <SendFlow orderItems={orderItems} sheetName={sheet.name} template={template} onClose={() => setShowEmail(false)} />
      )}
      {showSheetModal && (
        <SheetModal
          sheet={editSheetIdx !== null ? sheets[editSheetIdx] : null}
          onSave={data => editSheetIdx !== null ? updateSheet(editSheetIdx, data) : addSheet(data)}
          onClose={() => { setShowSheetModal(false); setEditSheetIdx(null); }}
        />
      )}
    </div>
  );
}