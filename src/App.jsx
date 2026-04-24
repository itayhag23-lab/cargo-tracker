import { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { db } from "./firebase";
import { doc, onSnapshot, setDoc, getDoc } from "firebase/firestore";

// ─────────────────────────────────────────────────────────────────────────────
// Templates use single quotes on purpose — do NOT convert to backticks
// ${{totalCost}} would break as a JS template expression inside backticks
// ─────────────────────────────────────────────────────────────────────────────
const EN_TEMPLATE = 'Hello,\n\nPlease find the supply order for {{date}} below:\n\n{{items}}\n\nEstimated total: ${{totalCost}}\n\nPlease confirm receipt.\n\nThank you';
const HE_TEMPLATE = 'שלום,\n\nמצ"ב רשימת הזמנה לחידוש ציוד – {{date}}\n\n{{items}}\n\nסה"כ עלות משוערת: ${{totalCost}}\n\nאנא אשר קבלת ההזמנה.\n\nתודה';

const T = {
  en: {
    dir: "ltr",
    title: "Supply Tracker — Cargo Ops",
    subtitle: (count, order, total) => count + " items · " + order + " to order · Total: $" + total,
    search: "Search...",
    importBtn: "⬆ Excel",
    tplBtn: "✉ Template",
    addBtn: "+ Item",
    sendBtn: "✉ Send Order",
    catAll: "All",
    catNames: { "ציוד קרגו": "Cargo", "ציוד מטבח": "Kitchen", "ציוד משרדי": "Office" },
    cols: ["Item Name", "Per Pack", "Order Qty", "Unit ($)", "Total", "Model", "Link", "Rcvd", ""],
    noItems: "No items found",
    enterPin: "Enter PIN to access",
    pinPh: "PIN",
    wrongPin: "Incorrect PIN. Try again.",
    unlockBtn: "Unlock",
    editTitle: "Edit Item",
    addTitle: "Add New Item",
    catLabel: "Category",
    newCat: "+ New category",
    itemName: "Item Name",
    model: "MODEL Number",
    perPack: "Units per Pack",
    orderQty: "Order Quantity",
    costPer: "Cost per Unit ($)",
    linkLabel: "Product Link (URL)",
    notesLabel: "Notes",
    cancelBtn: "Cancel",
    saveBtn: "Save",
    addItemBtn: "Add",
    tplTitle: "Edit Email Template",
    tplVars: "Variables:",
    saveTpl: "Save Template",
    sendTitle: "Send Order Email",
    recipientLabel: "Recipient",
    subjectLabel: "Subject",
    defaultSubject: "Supply Order – ",
    previewTitle: "Email Preview",
    toLabel: "To",
    subLabel: "Subject",
    bodyLabel: "Body",
    backBtn: "← Back",
    sendNow: "Send Now ✉",
    sending: "Sending...",
    sentTitle: "Email sent!",
    sentTo: "Order sent to",
    closeBtn: "Close",
    errTitle: "Send failed",
    retryBtn: "Retry",
    previewBtn: "Preview →",
    openLink: "🔗 Open",
    addLink: "+ URL",
    rcvdTitle: "Mark received",
    footerItems: "items to order",
    footerTotal: "Total",
    defaultTemplate: EN_TEMPLATE,
    syncing: "Syncing...",
    syncOk: "Saved ✓",
  },
  he: {
    dir: "rtl",
    title: "מערכת ניהול ציוד — קרגו",
    subtitle: (count, order, total) => count + " פריטים · " + order + " להזמנה · סה\"כ: $" + total,
    search: "חיפוש...",
    importBtn: "⬆ Excel",
    tplBtn: "✉ תבנית",
    addBtn: "+ פריט",
    sendBtn: "✉ שלח הזמנה",
    catAll: "הכל",
    catNames: { "ציוד קרגו": "ציוד קרגו", "ציוד מטבח": "ציוד מטבח", "ציוד משרדי": "ציוד משרדי" },
    cols: ["שם מוצר", "ב/מארז", "כמות להזמנה", "לי' ($)", "סה\"כ", "Model", "קישור", "התקבל", ""],
    noItems: "אין פריטים",
    enterPin: "הכנס קוד כניסה",
    pinPh: "קוד גישה",
    wrongPin: "קוד שגוי. נסה שוב.",
    unlockBtn: "כניסה",
    editTitle: "עריכת פריט",
    addTitle: "הוספת פריט חדש",
    catLabel: "קטגוריה",
    newCat: "+ קטגוריה חדשה",
    itemName: "שם מוצר",
    model: "MODEL Number",
    perPack: "יחידות במארז",
    orderQty: "כמות להזמנה",
    costPer: "עלות ליחידה ($)",
    linkLabel: "קישור למוצר (URL)",
    notesLabel: "הערות",
    cancelBtn: "ביטול",
    saveBtn: "שמור",
    addItemBtn: "הוסף",
    tplTitle: "עריכת תבנית מייל",
    tplVars: "משתני תבנית:",
    saveTpl: "שמור תבנית",
    sendTitle: "שליחת מייל הזמנה",
    recipientLabel: "כתובת נמען",
    subjectLabel: "נושא",
    defaultSubject: "הזמנת ציוד – ",
    previewTitle: "תצוגה מקדימה",
    toLabel: "נמען",
    subLabel: "נושא",
    bodyLabel: "גוף המייל",
    backBtn: "← חזור",
    sendNow: "שלח עכשיו ✉",
    sending: "שולח...",
    sentTitle: "נשלח בהצלחה",
    sentTo: "ההזמנה נשלחה אל",
    closeBtn: "סגור",
    errTitle: "שגיאה בשליחה",
    retryBtn: "נסה שוב",
    previewBtn: "תצוגה מקדימה →",
    openLink: "🔗 פתח",
    addLink: "+ URL",
    rcvdTitle: "סמן כהתקבל",
    footerItems: "פריטים להזמנה",
    footerTotal: "סה\"כ",
    defaultTemplate: HE_TEMPLATE,
    syncing: "שומר...",
    syncOk: "נשמר ✓",
  },
};

const ACCESS_PIN = "(Ronen#Cargo!)";

const DEFAULT_ITEMS = [
  { id: "d1", category: "ציוד קרגו",  name: "Uline Industrial Tape CLEAR",  unitsPerPack: 36,   orderQty: 0, costPerUnit: 1.99,  modelNumber: "S-423",      received: false, link: "https://www.uline.com/Product/Detail/S-423", notes: "" },
  { id: "d2", category: "ציוד קרגו",  name: "Colored Handwrap - Green",     unitsPerPack: 4,    orderQty: 0, costPerUnit: 26.00, modelNumber: "S-2900G",    received: false, link: "", notes: "" },
  { id: "d3", category: "ציוד מטבח",  name: "Paper Towels",                 unitsPerPack: 30,   orderQty: 0, costPerUnit: 42.00, modelNumber: "S-7711",     received: false, link: "", notes: "" },
  { id: "d4", category: "ציוד משרדי", name: "BIC Gel Pen - Medium Blue",    unitsPerPack: 1,    orderQty: 0, costPerUnit: 1.30,  modelNumber: "S-21758BLU", received: false, link: "", notes: "" },
];

const ALL_CATS = ["ציוד קרגו", "ציוד מטבח", "ציוד משרדי"];
const uid = () => Math.random().toString(36).slice(2, 9);
const ITEMS_DOC = doc(db, "cargo", "items");
const SETTINGS_DOC = doc(db, "cargo", "settings");

// ── EXCEL IMPORT ──────────────────────────────────────────────────────────────
function findCol(headers, candidates) {
  for (const h of headers) {
    const hn = h.toLowerCase().trim();
    for (const c of candidates) {
      if (hn.includes(c.toLowerCase())) return h;
    }
  }
  return null;
}

function parseExcelRows(rows) {
  if (!rows.length) return [];
  const headers = Object.keys(rows[0]);
  const nameKey   = findCol(headers, ["מוצר", "product", "item name", "name", "item"]);
  const packKey   = findCol(headers, ["יחידות במארז", "units per pack", "per pack", "pack"]);
  const qtyKey    = findCol(headers, ["כמות להזמנה", "order qty", "order quantity", "quantity", "qty"]);
  const costKey   = findCol(headers, ["עלות ליחידה", "cost per unit", "unit cost", "unit price", "price"]);
  const modelKey  = findCol(headers, ["model number", "model", "מודל", "מק\"ט", "sku", "part"]);
  const rcvdKey   = findCol(headers, ["קיבלנו", "received", "התקבל"]);
  const linkKey   = findCol(headers, ["link", "קישור", "url", "website"]);
  const notesKey  = findCol(headers, ["הערות", "notes", "note", "remarks"]);
  if (!nameKey) return [];
  const cleanNum  = (v) => parseFloat(String(v).replace(/[$,\s]/g, "")) || 0;
  const cleanBool = (v) => { const s = String(v).toLowerCase().trim(); return s==="yes"||s==="כן"||s==="true"||s==="1"||s==="v"||s==="✓"; };
  return rows.map(r => ({
    id: uid(), category: "ציוד קרגו",
    name:         nameKey  ? String(r[nameKey]).trim()  : "",
    unitsPerPack: packKey  ? cleanNum(r[packKey])       : 1,
    orderQty:     qtyKey   ? cleanNum(r[qtyKey])        : 0,
    costPerUnit:  costKey  ? cleanNum(r[costKey])       : 0,
    modelNumber:  modelKey ? String(r[modelKey]).trim() : "",
    received:     rcvdKey  ? cleanBool(r[rcvdKey])      : false,
    link:         linkKey  ? String(r[linkKey]).trim()  : "",
    notes:        notesKey ? String(r[notesKey]).trim() : "",
  })).filter(r => r.name.length > 0);
}

// ── STYLES ────────────────────────────────────────────────────────────────────
const S = {
  input:   { width:"100%", background:"#27272a", border:"1px solid #3f3f46", color:"#e4e4e7", borderRadius:6, padding:"8px 10px", fontSize:13, outline:"none", boxSizing:"border-box", fontFamily:"inherit" },
  ghost:   { background:"transparent", border:"1px solid #3f3f46", color:"#a1a1aa", borderRadius:7, padding:"7px 14px", fontSize:13, cursor:"pointer", fontFamily:"inherit" },
  primary: { background:"#f59e0b", border:"none", color:"#000", borderRadius:6, padding:"9px 0", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:"inherit", flex:2 },
  cancel:  { background:"#27272a", border:"1px solid #3f3f46", color:"#a1a1aa", borderRadius:6, padding:"9px 0", fontSize:13, cursor:"pointer", fontFamily:"inherit", flex:1 },
  icon:    { background:"none", border:"none", cursor:"pointer", fontSize:14, padding:"2px 5px", borderRadius:3, transition:"color 0.15s" },
  stepBtn: { width:20, height:20, borderRadius:4, background:"#27272a", border:"1px solid #3f3f46", color:"#a1a1aa", cursor:"pointer", fontSize:15, display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, padding:0 },
};

// ── SMALL COMPONENTS ──────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:"#09090b" }}>
      <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
      <div style={{ width:32, height:32, border:"3px solid #3f3f46", borderTop:"3px solid #f59e0b", borderRadius:"50%", animation:"spin .8s linear infinite" }} />
    </div>
  );
}

function QtyStep({ value, onChange }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:4, justifyContent:"center" }}>
      <button style={S.stepBtn} onClick={() => onChange(Math.max(0, value - 1))}>−</button>
      <span style={{ minWidth:28, textAlign:"center", fontFamily:"monospace", fontWeight:700, fontSize:13, color: value > 0 ? "#fbbf24" : "#52525b" }}>{value}</span>
      <button style={S.stepBtn} onClick={() => onChange(value + 1)}>+</button>
    </div>
  );
}

function InlineEdit({ value, type="text", placeholder="—", onCommit }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { setEditing(false); const v = type==="number" ? (parseFloat(draft)||0) : draft; if (v !== value) onCommit(v); };
  if (editing) return (
    <input autoFocus type={type} value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key==="Enter") commit(); if (e.key==="Escape") setEditing(false); }}
      style={{ width:"100%", background:"#1c1c1f", border:"1px solid #f59e0b", color:"#e4e4e7", borderRadius:4, padding:"3px 6px", fontSize:12, outline:"none", textAlign:"center", boxSizing:"border-box", direction:"ltr" }}
    />
  );
  return (
    <span title="Click to edit" onClick={() => { setDraft(value); setEditing(true); }}
      onMouseEnter={e => { e.currentTarget.style.background="#27272a"; }}
      onMouseLeave={e => { e.currentTarget.style.background="transparent"; }}
      style={{ cursor:"text", color: value ? "#e4e4e7" : "#3f3f46", fontSize:12, display:"block", textAlign:"center", padding:"2px 4px", borderRadius:3, direction:"ltr" }}>
      {value || <span style={{ color:"#3f3f46" }}>{placeholder}</span>}
      {value && <span style={{ opacity:0.2, fontSize:8, marginLeft:2 }}>✎</span>}
    </span>
  );
}

// ── PIN SCREEN ────────────────────────────────────────────────────────────────
function PinScreen({ t, onUnlock }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState(false);
  const submit = () => {
    if (pin === ACCESS_PIN) { onUnlock(); }
    else { setErr(true); setPin(""); setTimeout(() => setErr(false), 2000); }
  };
  return (
    <div style={{ minHeight:"100vh", background:"#09090b", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:20, direction: t.dir }}>
      <div style={{ fontSize:36 }}>✈</div>
      <div style={{ fontSize:15, fontWeight:700, color:"#fafafa" }}>{t.enterPin}</div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:10 }}>
        <input type="password" value={pin} autoFocus placeholder={t.pinPh}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => e.key==="Enter" && submit()}
          style={{ width:200, background:"#18181b", border:"1px solid "+(err?"#ef4444":"#3f3f46"), color:"#e4e4e7", borderRadius:8, padding:"11px 18px", fontSize:16, outline:"none", textAlign:"center", letterSpacing:"0.3em", direction:"ltr", fontFamily:"monospace", transition:"border-color .2s" }}
        />
        {err && <div style={{ color:"#ef4444", fontSize:12 }}>{t.wrongPin}</div>}
        <button onClick={submit} style={{ width:200, background:"#f59e0b", border:"none", color:"#000", borderRadius:8, padding:"10px 0", fontSize:14, fontWeight:700, cursor:"pointer", fontFamily:"inherit" }}>
          {t.unlockBtn}
        </button>
      </div>
    </div>
  );
}

// ── ITEM MODAL ────────────────────────────────────────────────────────────────
function ItemModal({ t, item, existingCats, onSave, onClose }) {
  const blank = { id:uid(), category:ALL_CATS[0], name:"", unitsPerPack:1, orderQty:0, costPerUnit:0, modelNumber:"", received:false, link:"", notes:"" };
  const [form, setForm] = useState(item ? { ...item } : blank);
  const [customCat, setCustomCat] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cats = [...new Set([...ALL_CATS, ...existingCats])];
  const ff = e => { e.target.style.borderColor="#f59e0b"; };
  const fb = e => { e.target.style.borderColor="#3f3f46"; };
  const fields = [
    { key:"name",         label:t.itemName,  type:"text"   },
    { key:"modelNumber",  label:t.model,     type:"text"   },
    { key:"unitsPerPack", label:t.perPack,   type:"number" },
    { key:"orderQty",     label:t.orderQty,  type:"number" },
    { key:"costPerUnit",  label:t.costPer,   type:"number" },
    { key:"link",         label:t.linkLabel, type:"text"   },
    { key:"notes",        label:t.notesLabel,type:"text"   },
  ];
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.78)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#18181b", border:"1px solid #3f3f46", borderRadius:14, padding:28, width:420, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.6)", direction:t.dir }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:20, color:"#fafafa" }}>{item ? t.editTitle : t.addTitle}</div>
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:11, color:"#71717a", marginBottom:5 }}>{t.catLabel}</div>
          {customCat ? (
            <input value={form.category} autoFocus style={{ ...S.input, direction:t.dir }} onChange={e => set("category", e.target.value)} onFocus={ff} onBlur={e => { fb(e); if (!form.category) setCustomCat(false); }} />
          ) : (
            <select value={form.category} style={{ ...S.input, direction:t.dir, cursor:"pointer" }} onChange={e => { if (e.target.value==="__new__") { set("category",""); setCustomCat(true); } else set("category", e.target.value); }} onFocus={ff} onBlur={fb}>
              {cats.map(c => <option key={c} value={c}>{t.catNames[c] || c}</option>)}
              <option value="__new__">{t.newCat}</option>
            </select>
          )}
        </div>
        {fields.map(f => (
          <div key={f.key} style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, color:"#71717a", marginBottom:5 }}>{f.label}</div>
            <input type={f.type} value={form[f.key]} onChange={e => set(f.key, f.type==="number" ? (parseFloat(e.target.value)||0) : e.target.value)}
              style={{ ...S.input, direction:(f.key==="link"||f.key==="modelNumber") ? "ltr" : t.dir }} onFocus={ff} onBlur={fb} />
          </div>
        ))}
        <div style={{ display:"flex", gap:8, marginTop:20 }}>
          <button style={S.cancel} onClick={onClose}>{t.cancelBtn}</button>
          <button style={S.primary} onClick={() => { onSave({ ...form }); onClose(); }}>{item ? t.saveBtn : t.addItemBtn}</button>
        </div>
      </div>
    </div>
  );
}

// ── TEMPLATE EDITOR ───────────────────────────────────────────────────────────
function TemplateEditor({ t, template, onSave, onClose }) {
  const [val, setVal] = useState(template);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.8)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"#18181b", border:"1px solid #3f3f46", borderRadius:14, padding:28, width:520, boxShadow:"0 24px 64px rgba(0,0,0,0.6)", direction:t.dir }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize:15, fontWeight:700, marginBottom:8 }}>{t.tplTitle}</div>
        <div style={{ fontSize:12, color:"#71717a", marginBottom:16, lineHeight:1.8 }}>
          {t.tplVars}&nbsp;
          {["{{date}}", "{{items}}", "{{totalCost}}"].map(v => (
            <code key={v} style={{ background:"#27272a", padding:"1px 6px", borderRadius:3, color:"#f59e0b", margin:"0 3px" }}>{v}</code>
          ))}
        </div>
        <textarea value={val} rows={12} onChange={e => setVal(e.target.value)}
          onFocus={e => { e.target.style.borderColor="#f59e0b"; }} onBlur={e => { e.target.style.borderColor="#3f3f46"; }}
          style={{ width:"100%", background:"#0d0d0f", border:"1px solid #3f3f46", color:"#e4e4e7", borderRadius:8, padding:14, fontSize:13, outline:"none", resize:"vertical", lineHeight:1.8, boxSizing:"border-box", direction:t.dir, fontFamily:"inherit" }}
        />
        <div style={{ display:"flex", gap:8, marginTop:16 }}>
          <button style={S.cancel} onClick={onClose}>{t.cancelBtn}</button>
          <button style={S.primary} onClick={() => { onSave(val); onClose(); }}>{t.saveTpl}</button>
        </div>
      </div>
    </div>
  );
}

// ── SEND EMAIL FLOW ───────────────────────────────────────────────────────────
function SendFlow({ t, orderItems, template, onClose }) {
  const [step, setStep] = useState("input");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(t.defaultSubject + new Date().toLocaleDateString());
  const [preview, setPreview] = useState(null);
  const orderTotal = orderItems.reduce((s, i) => s + i.orderQty * i.costPerUnit, 0).toFixed(2);

  const buildBody = () => {
    const date = new Date().toLocaleDateString(t.dir==="rtl" ? "he-IL" : "en-US", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
    const itemLines = orderItems.map(i => {
      const cost = (i.orderQty * i.costPerUnit).toFixed(2);
      let line = "• " + i.name;
      if (i.modelNumber) line += " [" + i.modelNumber + "]";
      line += "\n  Qty: " + i.orderQty + " | Cost: $" + cost;
      if (i.link) line += "\n  Link: " + i.link;
      return line;
    }).join("\n\n");
    return template.replace("{{date}}", date).replace("{{items}}", itemLines).replace("{{totalCost}}", orderTotal);
  };

  const doSend = async () => {
    setStep("sending");
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 500,
          system: "You are a Gmail assistant. Send the exact email using the Gmail MCP send tool. Reply only with JSON: {\"sent\":true}",
          messages: [{ role:"user", content: "Send this email:\nTo: " + preview.to + "\nSubject: " + preview.subject + "\nBody:\n" + preview.body }],
          mcp_servers: [{ type:"url", url:"https://gmailmcp.googleapis.com/mcp/v1", name:"gmail-mcp" }],
        }),
      });
      await res.json();
      setStep("sent");
    } catch { setStep("error"); }
  };

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.82)", zIndex:50, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={step==="sending" ? undefined : onClose}>
      <div style={{ background:"#18181b", border:"1px solid #3f3f46", borderRadius:14, padding:28, width:480, maxHeight:"85vh", overflowY:"auto", boxShadow:"0 24px 64px rgba(0,0,0,0.6)", direction:t.dir }} onClick={e => e.stopPropagation()}>

        {step === "input" && <>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>{t.sendTitle}</div>
          <div style={{ fontSize:12, color:"#71717a", marginBottom:16 }}>{orderItems.length} items · ${orderTotal}</div>
          <div style={{ background:"#0d0d0f", borderRadius:8, padding:"10px 14px", marginBottom:18, maxHeight:140, overflowY:"auto" }}>
            {orderItems.map(i => (
              <div key={i.id} style={{ display:"flex", justifyContent:"space-between", fontSize:12, color:"#a1a1aa", padding:"4px 0", borderBottom:"1px solid #1a1a1d" }}>
                <span>{i.name}</span>
                <span style={{ color:"#fbbf24", fontFamily:"monospace" }}>{"x"+i.orderQty+" = $"+(i.orderQty*i.costPerUnit).toFixed(2)}</span>
              </div>
            ))}
          </div>
          {[{ l:t.recipientLabel, v:to, s:setTo, d:"ltr" }, { l:t.subjectLabel, v:subject, s:setSubject, d:t.dir }].map(f => (
            <div key={f.l} style={{ marginBottom:14 }}>
              <div style={{ fontSize:11, color:"#71717a", marginBottom:5 }}>{f.l}</div>
              <input value={f.v} onChange={e => f.s(e.target.value)} style={{ ...S.input, direction:f.d }}
                onFocus={e => { e.target.style.borderColor="#f59e0b"; }} onBlur={e => { e.target.style.borderColor="#3f3f46"; }} />
            </div>
          ))}
          <div style={{ display:"flex", gap:8, marginTop:20 }}>
            <button style={S.cancel} onClick={onClose}>{t.cancelBtn}</button>
            <button disabled={!to.trim()} onClick={() => { setPreview({ to, subject, body:buildBody() }); setStep("preview"); }}
              style={{ ...S.primary, background:to.trim()?"#f59e0b":"#3f3f46", color:to.trim()?"#000":"#71717a", cursor:to.trim()?"pointer":"not-allowed" }}>
              {t.previewBtn}
            </button>
          </div>
        </>}

        {step === "preview" && preview && <>
          <div style={{ fontSize:15, fontWeight:700, marginBottom:20 }}>{t.previewTitle}</div>
          {[{ l:t.toLabel, v:preview.to, d:"ltr" }, { l:t.subLabel, v:preview.subject, d:t.dir }].map(f => (
            <div key={f.l} style={{ marginBottom:12 }}>
              <div style={{ fontSize:10, color:"#52525b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>{f.l}</div>
              <div style={{ background:"#0d0d0f", borderRadius:6, padding:"8px 12px", fontSize:13, color:"#e4e4e7", direction:f.d }}>{f.v}</div>
            </div>
          ))}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:10, color:"#52525b", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:4 }}>{t.bodyLabel}</div>
            <div style={{ background:"#0d0d0f", borderRadius:6, padding:"12px 14px", fontSize:12, color:"#a1a1aa", whiteSpace:"pre-wrap", lineHeight:1.8, maxHeight:200, overflowY:"auto", direction:t.dir }}>{preview.body}</div>
          </div>
          <div style={{ display:"flex", gap:8 }}>
            <button style={S.cancel} onClick={() => setStep("input")}>{t.backBtn}</button>
            <button style={S.primary} onClick={doSend}>{t.sendNow}</button>
          </div>
        </>}

        {step === "sending" && (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:16, padding:"28px 0" }}>
            <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
            <div style={{ width:32, height:32, border:"3px solid #3f3f46", borderTop:"3px solid #f59e0b", borderRadius:"50%", animation:"spin .8s linear infinite" }} />
            <div style={{ color:"#a1a1aa", fontSize:13 }}>{t.sending}</div>
          </div>
        )}

        {step === "sent" && (
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:6 }}>{t.sentTitle}</div>
            <div style={{ fontSize:12, color:"#71717a", marginBottom:24 }}>{t.sentTo} {preview && preview.to}</div>
            <button style={{ ...S.primary, flex:"none", padding:"9px 32px" }} onClick={onClose}>{t.closeBtn}</button>
          </div>
        )}

        {step === "error" && (
          <div style={{ textAlign:"center", padding:"16px 0" }}>
            <div style={{ fontSize:40, marginBottom:12 }}>❌</div>
            <div style={{ fontSize:15, fontWeight:700, marginBottom:24 }}>{t.errTitle}</div>
            <div style={{ display:"flex", gap:8, justifyContent:"center" }}>
              <button style={{ ...S.cancel, flex:"none", padding:"9px 20px" }} onClick={() => setStep("preview")}>{t.backBtn}</button>
              <button style={{ ...S.primary, flex:"none", padding:"9px 20px" }} onClick={doSend}>{t.retryBtn}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [unlocked, setUnlocked]   = useState(false);
  const [lang, setLang]           = useState("en");
  const [items, setItems]         = useState(null);
  const [template, setTemplate]   = useState(null);
  const [activeCat, setActiveCat] = useState("__all__");
  const [search, setSearch]       = useState("");
  const [showAdd, setShowAdd]     = useState(false);
  const [editItem, setEditItem]   = useState(null);
  const [showTpl, setShowTpl]     = useState(false);
  const [showEmail, setShowEmail] = useState(false);
  const [syncStatus, setSyncStatus] = useState("ok"); // ok | syncing
  const fileRef = useRef();
  const saveTimer = useRef(null);

  const t = T[lang];

  // ── PIN session ──────────────────────────────────────────────────────────
  useEffect(() => {
    try { if (sessionStorage.getItem("cargo-unlocked")==="1") setUnlocked(true); } catch {}
  }, []);

  const handleUnlock = () => {
    try { sessionStorage.setItem("cargo-unlocked","1"); } catch {}
    setUnlocked(true);
  };

  // ── Load from Firebase (real-time listener) ──────────────────────────────
  useEffect(() => {
    if (!unlocked) return;

    // Listen to items in real-time — updates instantly on all devices
    const unsubItems = onSnapshot(ITEMS_DOC, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setItems(data.list || DEFAULT_ITEMS);
      } else {
        // First time — write defaults
        setDoc(ITEMS_DOC, { list: DEFAULT_ITEMS });
        setItems(DEFAULT_ITEMS);
      }
    });

    // Load settings once
    getDoc(SETTINGS_DOC).then((snap) => {
      if (snap.exists()) {
        const data = snap.data();
        const savedLang = data.lang || "en";
        setLang(savedLang);
        setTemplate(data.template || T[savedLang].defaultTemplate);
      } else {
        setTemplate(T["en"].defaultTemplate);
      }
    });

    return () => unsubItems();
  }, [unlocked]);

  // ── Save items to Firebase (debounced 800ms) ─────────────────────────────
  const saveItems = (newItems) => {
    setSyncStatus("syncing");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      await setDoc(ITEMS_DOC, { list: newItems });
      setSyncStatus("ok");
    }, 800);
  };

  const saveSettings = async (newLang, newTemplate) => {
    await setDoc(SETTINGS_DOC, { lang: newLang, template: newTemplate });
  };

  const setAndSave = (newItems) => { setItems(newItems); saveItems(newItems); };
  const upsertItem = (item) => {
    const next = items.find(i => i.id===item.id) ? items.map(i => i.id===item.id ? item : i) : [...items, item];
    setAndSave(next);
  };
  const removeItem = (id) => setAndSave(items.filter(i => i.id !== id));
  const patchItem  = (id, patch) => setAndSave(items.map(i => i.id===id ? { ...i, ...patch } : i));

  const switchLang = (l) => {
    setLang(l);
    const tpl = (template===T["en"].defaultTemplate || template===T["he"].defaultTemplate) ? T[l].defaultTemplate : template;
    setTemplate(tpl);
    saveSettings(l, tpl);
  };

  // ── Excel import ─────────────────────────────────────────────────────────
  const handleExcel = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type:"binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval:"" });
        const parsed = parseExcelRows(rows);
        if (parsed.length > 0) { setAndSave(parsed); alert("Imported " + parsed.length + " items!"); }
        else alert("No items found. Make sure the Excel has a column named 'מוצר' or 'Item Name'.");
      } catch (err) { alert("Error: " + err.message); }
      e.target.value = "";
    };
    reader.readAsBinaryString(file);
  };

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!unlocked) return <PinScreen t={t} onUnlock={handleUnlock} />;
  if (!items || !template) return <Spinner />;

  // ── Derived ───────────────────────────────────────────────────────────────
  const existingCats = [...new Set(items.map(i => i.category))];
  const allCats = [...new Set([...ALL_CATS, ...existingCats])];
  const filtered = items.filter(i => {
    const matchCat = activeCat==="__all__" || i.category===activeCat;
    const matchSearch = !search || i.name.toLowerCase().includes(search.toLowerCase()) || (i.modelNumber||"").toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });
  const orderItems = items.filter(i => i.orderQty > 0 && !i.received);
  const orderTotal = orderItems.reduce((s, i) => s + i.orderQty * i.costPerUnit, 0).toFixed(2);
  const COLS = "2.4fr 0.65fr 1fr 0.7fr 0.75fr 0.85fr 0.65fr 0.5fr 52px";

  return (
    <div style={{ minHeight:"100vh", background:"#09090b", color:"#e4e4e7", fontFamily:"'Heebo','Segoe UI',sans-serif", direction:t.dir }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=Heebo:wght@400;500;600;700&display=swap');::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#18181b}::-webkit-scrollbar-thumb{background:#3f3f46;border-radius:3px}"}</style>

      {/* HEADER */}
      <div style={{ borderBottom:"1px solid #1c1c1f", padding:"16px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
        <div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <span style={{ fontSize:20 }}>✈</span>
            <span style={{ fontSize:15, fontWeight:700, color:"#fafafa" }}>{t.title}</span>
            <span style={{ fontSize:11, color: syncStatus==="syncing" ? "#f59e0b" : "#10b981" }}>
              {syncStatus==="syncing" ? t.syncing : t.syncOk}
            </span>
          </div>
          <div style={{ fontSize:11, color:"#52525b", marginTop:3 }}>
            {t.subtitle(items.length, orderItems.length, orderTotal)}
          </div>
        </div>

        <div style={{ display:"flex", gap:7, flexWrap:"wrap", alignItems:"center" }}>
          {/* Language toggle */}
          <div style={{ display:"flex", background:"#18181b", border:"1px solid #27272a", borderRadius:7, overflow:"hidden" }}>
            {["en","he"].map(l => (
              <button key={l} onClick={() => switchLang(l)}
                style={{ padding:"6px 12px", border:"none", background:lang===l?"#f59e0b":"transparent", color:lang===l?"#000":"#71717a", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"inherit", transition:"all .15s" }}>
                {l==="en" ? "EN" : "עב"}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder={"🔍 "+t.search}
            style={{ background:"#18181b", border:"1px solid #27272a", color:"#e4e4e7", borderRadius:7, padding:"7px 12px", fontSize:13, outline:"none", width:140, direction:t.dir }}
            onFocus={e => { e.target.style.borderColor="#f59e0b"; }} onBlur={e => { e.target.style.borderColor="#27272a"; }}
          />
          <input type="file" accept=".xlsx,.xls,.csv" ref={fileRef} onChange={handleExcel} style={{ display:"none" }} />
          <button style={S.ghost} onClick={() => fileRef.current.click()}>{t.importBtn}</button>
          <button style={S.ghost} onClick={() => setShowTpl(true)}>{t.tplBtn}</button>
          <button style={{ ...S.ghost, borderColor:"#f59e0b55", color:"#f59e0b" }} onClick={() => setShowAdd(true)}>{t.addBtn}</button>
          <button disabled={orderItems.length===0} onClick={() => setShowEmail(true)}
            style={{ background:orderItems.length?"#f59e0b":"#27272a", color:orderItems.length?"#000":"#52525b", border:"none", borderRadius:7, padding:"8px 16px", fontSize:13, fontWeight:700, cursor:orderItems.length?"pointer":"not-allowed", fontFamily:"inherit" }}>
            {t.sendBtn}{orderItems.length > 0 ? " ("+orderItems.length+")" : ""}
          </button>
        </div>
      </div>

      {/* CATEGORY TABS */}
      <div style={{ display:"flex", gap:4, padding:"10px 24px", borderBottom:"1px solid #1c1c1f", overflowX:"auto" }}>
        {[{ id:"__all__", label:t.catAll, count:items.length }, ...allCats.map(c => ({ id:c, label:t.catNames[c]||c, count:items.filter(i=>i.category===c).length }))].map(cat => (
          <button key={cat.id} onClick={() => setActiveCat(cat.id)}
            style={{ padding:"5px 14px", borderRadius:99, border:"1px solid", fontSize:12, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap", fontFamily:"inherit", transition:"all .15s", background:activeCat===cat.id?"#f59e0b":"transparent", color:activeCat===cat.id?"#000":"#71717a", borderColor:activeCat===cat.id?"#f59e0b":"#3f3f46" }}>
            {cat.label} <span style={{ opacity:0.6, fontSize:10 }}>({cat.count})</span>
          </button>
        ))}
      </div>

      {/* TABLE HEADER */}
      <div style={{ display:"grid", gridTemplateColumns:COLS, gap:8, padding:"7px 20px", borderBottom:"1px solid #1c1c1f" }}>
        {t.cols.map((h, i) => (
          <span key={i} style={{ fontSize:10, color:"#52525b", letterSpacing:"0.06em", textTransform:"uppercase", fontWeight:600, textAlign:i===0?(t.dir==="rtl"?"right":"left"):"center" }}>{h}</span>
        ))}
      </div>

      {/* ROWS */}
      <div>
        {filtered.length===0 && <div style={{ textAlign:"center", padding:48, color:"#3f3f46", fontSize:13 }}>{t.noItems}</div>}
        {filtered.map(item => (
          <div key={item.id}
            style={{ display:"grid", gridTemplateColumns:COLS, gap:8, padding:"8px 20px", borderBottom:"1px solid #111113", alignItems:"center" }}
            onMouseEnter={e => { e.currentTarget.style.background="#0e0e10"; }}
            onMouseLeave={e => { e.currentTarget.style.background="transparent"; }}>

            <div style={{ display:"flex", alignItems:"center", gap:7, overflow:"hidden" }}>
              {item.orderQty>0 && !item.received && <span style={{ width:5, height:5, borderRadius:"50%", background:"#f59e0b", flexShrink:0, boxShadow:"0 0 5px #f59e0b88" }} />}
              <span title={item.name} onDoubleClick={() => setEditItem(item)}
                style={{ fontSize:13, color:item.received?"#52525b":"#e4e4e7", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", textDecoration:item.received?"line-through":"none" }}>
                {item.name}
              </span>
            </div>

            <InlineEdit value={item.unitsPerPack} type="number" onCommit={v => patchItem(item.id, { unitsPerPack:v })} />
            <QtyStep value={item.orderQty} onChange={v => patchItem(item.id, { orderQty:v })} />
            <InlineEdit value={item.costPerUnit>0 ? item.costPerUnit.toFixed(2) : ""} type="number" placeholder="0.00" onCommit={v => patchItem(item.id, { costPerUnit:v })} />

            <div style={{ textAlign:"center", fontFamily:"monospace", fontSize:12, color:item.orderQty>0&&!item.received?"#fbbf24":"#3f3f46" }}>
              {item.orderQty>0 ? "$"+(item.orderQty*item.costPerUnit).toFixed(2) : "—"}
            </div>

            <InlineEdit value={item.modelNumber} placeholder="—" onCommit={v => patchItem(item.id, { modelNumber:v })} />

            <div style={{ textAlign:"center" }}>
              {item.link
                ? <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ color:"#6366f1", fontSize:12, textDecoration:"none" }}>{t.openLink}</a>
                : <InlineEdit value="" placeholder={t.addLink} onCommit={v => patchItem(item.id, { link:v })} />}
            </div>

            <div style={{ display:"flex", justifyContent:"center" }}>
              <button onClick={() => patchItem(item.id, { received:!item.received })}
                style={{ width:20, height:20, borderRadius:4, border:"2px solid "+(item.received?"#10b981":"#3f3f46"), background:item.received?"#10b98122":"transparent", cursor:"pointer", fontSize:11, display:"flex", alignItems:"center", justifyContent:"center", color:"#10b981" }}>
                {item.received ? "✓" : ""}
              </button>
            </div>

            <div style={{ display:"flex", gap:3, justifyContent:"center" }}>
              <button style={{ ...S.icon, color:"#52525b" }} onClick={() => setEditItem(item)}
                onMouseEnter={e => { e.currentTarget.style.color="#e4e4e7"; }} onMouseLeave={e => { e.currentTarget.style.color="#52525b"; }}>✎</button>
              <button style={{ ...S.icon, color:"#3f3f46" }} onClick={() => removeItem(item.id)}
                onMouseEnter={e => { e.currentTarget.style.color="#ef4444"; }} onMouseLeave={e => { e.currentTarget.style.color="#3f3f46"; }}>×</button>
            </div>
          </div>
        ))}
      </div>

      {/* FOOTER */}
      {orderItems.length > 0 && (
        <div style={{ padding:"12px 24px", borderTop:"1px solid #1c1c1f", display:"flex", justifyContent:"flex-end", gap:20, fontSize:13 }}>
          <span style={{ color:"#71717a" }}>{orderItems.length} {t.footerItems}</span>
          <span style={{ color:"#fbbf24", fontWeight:700, fontFamily:"monospace" }}>{t.footerTotal}: ${orderTotal}</span>
        </div>
      )}

      {showAdd   && <ItemModal t={t} existingCats={existingCats} onSave={upsertItem} onClose={() => setShowAdd(false)} />}
      {editItem  && <ItemModal t={t} item={editItem} existingCats={existingCats} onSave={upsertItem} onClose={() => setEditItem(null)} />}
      {showTpl   && <TemplateEditor t={t} template={template} onSave={tpl => { setTemplate(tpl); saveSettings(lang, tpl); }} onClose={() => setShowTpl(false)} />}
      {showEmail && <SendFlow t={t} orderItems={orderItems} template={template} onClose={() => setShowEmail(false)} />}
    </div>
  );
}