import React, { useMemo, useState, useEffect } from "react";
import * as XLSX from "xlsx";
import { motion } from "framer-motion";
import Tesseract from "tesseract.js";
import {
  LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
  BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer,
} from "recharts";
import {
  Upload, Download, FileSpreadsheet, Filter,
  Image as ImageIcon, CheckCircle2, XCircle, Loader2,
} from "lucide-react";

/* ================= Helpers ================= */

const guessHeaders = (headers) => {
  const h = headers.map((x) => (x || "").toString());
  const lower = h.map((x) => x.toLowerCase().trim());
  const find = (keys) => {
    const i = lower.findIndex((c) => keys.some((k) => c.includes(k)));
    return i !== -1 ? h[i] : "";
  };
  return {
    date: find(["date", "التاريخ", "tarikh", "created", "order date", "invoice date"]),
    product: find(["product", "item", "sku", "اسم المنتج", "المنتج", "prod"]),
    qty: find(["qty", "quantity", "الكمية", "count", "units", "qnt"]),
    price: find(["price", "unit price", "السعر", "cost", "unit_cost", "unitprice"]),
    revenue: find(["revenue", "amount", "total", "sales", "المبلغ", "الإيراد", "القيمة"]),
    region: find(["region", "market", "area", "المنطقة", "country"]),
  };
};

const excelDateToJS = (value) => {
  if (value instanceof Date) return value;
  if (typeof value === "number" && value > 25569) {
    const utc_days = Math.floor(value - 25569);
    const utc_value = utc_days * 86400; // seconds
    return new Date(utc_value * 1000);
  }
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const toNum = (v) => {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^\d.-]/g, "");
    const n = parseFloat(cleaned);
    return isNaN(n) ? 0 : n;
  }
  return 0;
};

const fmtCurr = (num) => {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency", currency: "SAR", maximumFractionDigits: 2,
    }).format(num || 0);
  } catch { return (num || 0).toFixed(2); }
};
const fmtInt = (num) => new Intl.NumberFormat().format(Math.round(num || 0));
const yyyymmdd = (d) => d ? `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}` : "";

// تحويل الأرقام العربية إلى إنجليزية
const normalizeDigits = (s) =>
  (s || "").replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[٬،]/g, ",");

// استخراج تاريخ من نص OCR
const parseDateFromText = (text) => {
  const t = normalizeDigits(text);
  const p1 = /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/;    // yyyy-mm-dd
  const p2 = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/; // dd-mm-yyyy
  const m1 = t.match(p1);
  if (m1) {
    const y = +m1[1], mo = +m1[2], da = +m1[3];
    const dt = new Date(y, mo-1, da);
    if (!isNaN(dt.getTime())) return dt;
  }
  const m2 = t.match(p2);
  if (m2) {
    let da = +m2[1], mo = +m2[2], y = +m2[3];
    if (y < 100) y += 2000;
    const dt = new Date(y, mo-1, da);
    if (!isNaN(dt.getTime())) return dt;
  }
  return null;
};

const numbersInText = (text) => {
  const t = normalizeDigits(text).replace(/[^0-9.,\n\r ]/g, "");
  return (t.match(/\d+(?:[.,]\d+)?/g) || []).map((s) => parseFloat(s.replace(/,/g,"")));
};

const pickLikelyAmount = (text) => {
  const t = normalizeDigits(text).toLowerCase();
  const kw = /(total|amount|الإجمالي|الإجمالى|المجموع|المبلغ)\D{0,10}(\d+[.,]?\d*)/;
  const m = t.match(kw);
  if (m) return parseFloat(m[2].replace(/,/g,""));
  const nums = numbersInText(text);
  return nums.length ? Math.max(...nums) : 0;
};

const pickLikelyPrice = (text) => {
  const t = normalizeDigits(text).toLowerCase();
  const kw = /(unit\s*price|price|السعر|سعر الوحدة)\D{0,10}(\d+[.,]?\d*)/;
  const m = t.match(kw);
  if (m) return parseFloat(m[2].replace(/,/g,""));
  const nums = numbersInText(text).sort((a,b)=>a-b);
  return nums.length ? nums[0] : 0; // أصغر رقم غالبًا سعر الوحدة
};

const pickLikelyProduct = (text) => {
  const lines = text.split(/\r?\n/).map((l)=>l.trim()).filter(Boolean);
  for (let i=0;i<lines.length;i++){
    const l = lines[i].toLowerCase();
    if (/(المنتج|product|item|اسم المنتج)/.test(l) && lines[i+1]) {
      const next = lines[i+1].replace(/[:：]/,"").trim();
      if (next && !/^[0-9.,]+$/.test(next)) return next.slice(0,60);
    }
  }
  const nonNum = lines.filter((l)=> !/^[0-9.,-]+$/.test(l));
  nonNum.sort((a,b)=> b.length - a.length);
  return (nonNum[0] || "").slice(0,60);
};

const similarText = (a,b) => {
  if (!a || !b) return false;
  a=a.toLowerCase(); b=b.toLowerCase();
  return a.includes(b) || b.includes(a);
};
const closeNum = (a,b,tol=0.05)=> {
  if (!a || !b) return false;
  const diff = Math.abs(a-b);
  return diff <= Math.max(1, tol*Math.max(a,b));
};

/* ================= Main ================= */

export default function SalesDashboard() {
  const [workbook, setWorkbook] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [rows, setRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapCols, setMapCols] = useState({
    date: "", product: "", qty: "", price: "", revenue: "", region: "",
  });
  const [filters, setFilters] = useState({ start: "", end: "", products: [] });

  // OCR state
  const [ocrItems, setOcrItems] = useState([]); // {id,name,status,progress,text,parsed,match,matchedRow}

  /* ---------- قراءة ملف الإكسل ---------- */
  const handleFile = async (file) => {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    setWorkbook(wb);
    setSheetName(wb.SheetNames?.[0] || "");
  };

  useEffect(() => {
    if (!workbook || !sheetName) return;
    const ws = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
    setRows(json);
    const hdrs = XLSX.utils.sheet_to_json(ws, { header: 1 })?.[0] || [];
    const headersClean = hdrs.map((h) => (h || "").toString());
    setHeaders(headersClean);
    setMapCols(guessHeaders(headersClean));
  }, [workbook, sheetName]);

  /* ---------- تحويل الصفوف ---------- */
  const normalized = useMemo(() => {
    if (!rows.length) return [];
    const m = mapCols;
    return rows.map((r) => {
      const d = excelDateToJS(r[m.date]);
      const product = (r[m.product] ?? "").toString();
      const qty = toNum(r[m.qty]);
      const price = toNum(r[m.price]);
      const revRaw = toNum(r[m.revenue]);
      const revenue = revRaw || qty * price;
      const region = (r[m.region] ?? "").toString();
      if (!product) return null;
      return { date: d, product, qty, price, revenue, region, _raw: r };
    }).filter(Boolean);
  }, [rows, mapCols]);

  /* ---------- حدود التواريخ ---------- */
  const bounds = useMemo(() => {
    if (!normalized.length) return { min:"", max:"" };
    const dates = normalized.map(x=>x.date).filter(Boolean);
    if (!dates.length) return { min:"", max:"" };
    const min = new Date(Math.min(...dates.map(d=>d.getTime())));
    const max = new Date(Math.max(...dates.map(d=>d.getTime())));
    return { min: yyyymmdd(min), max: yyyymmdd(max) };
  }, [normalized]);

  /* ---------- الفلاتر ---------- */
  const filtered = useMemo(() => {
    let out = normalized;
    if (filters.start) {
      const s = new Date(filters.start);
      out = out.filter(x => !x.date || x.date >= s);
    }
    if (filters.end) {
      const e = new Date(filters.end);
      out = out.filter(x => !x.date || x.date <= e);
    }
    if (filters.products?.length) {
      const set = new Set(filters.products);
      out = out.filter(x => set.has(x.product));
    }
    return out;
  }, [normalized, filters]);

  /* ---------- ملخصات ---------- */
  const summary = useMemo(() => {
    const totalRevenue = filtered.reduce((a,b)=>a+(b.revenue||0),0);
    const totalQty = filtered.reduce((a,b)=>a+(b.qty||0),0);
    const avgPrice = totalQty ? totalRevenue/totalQty : 0;
    const orders = filtered.length;
    const uniqueProducts = new Set(filtered.map(x=>x.product)).size;
    return { totalRevenue, totalQty, avgPrice, orders, uniqueProducts };
  }, [filtered]);

  const byDate = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const key = r.date ? yyyymmdd(r.date) : "بدون تاريخ";
      const acc = map.get(key) || { date: key, revenue: 0, qty: 0 };
      acc.revenue += r.revenue || 0;
      acc.qty += r.qty || 0;
      map.set(key, acc);
    });
    return Array.from(map.values()).sort((a,b)=>a.date.localeCompare(b.date));
  }, [filtered]);

  const topProducts = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const acc = map.get(r.product) || { product: r.product, revenue: 0, qty: 0 };
      acc.revenue += r.revenue || 0;
      acc.qty += r.qty || 0;
      map.set(r.product, acc);
    });
    return Array.from(map.values()).sort((a,b)=>b.revenue-a.revenue).slice(0,15);
  }, [filtered]);

  const pieData = useMemo(() => {
    const tp = topProducts.slice(0,5);
    const other = filtered
      .filter(r=>!tp.some(p=>p.product===r.product))
      .reduce((a,b)=>a+(b.revenue||0),0);
    const arr = tp.map(p=>({name:p.product, value:p.revenue}));
    if (other>0) arr.push({name:"أخرى", value:other});
    return arr;
  }, [filtered, topProducts]);

  const productOptions = useMemo(() => {
    const arr = Array.from(new Set(normalized.map(x=>x.product))).sort();
    return arr.slice(0,2000);
  }, [normalized]);

  const selectableHeaders = headers.filter(Boolean);
  const updateMap = (key,val)=> setMapCols(m=>({...m, [key]:val}));

  /* ---------- تنزيل CSV بعد المعالجة ---------- */
  const downloadProcessedCSV = () => {
    const data = filtered.map(r => ({
      date: r.date ? yyyymmdd(r.date) : "",
      product: r.product, qty: r.qty, price: r.price,
      revenue: r.revenue, region: r.region,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales");
    const out = XLSX.write(wb, { type: "array", bookType: "csv" });
    const blob = new Blob([out], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "processed_sales.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  /* ================= OCR ================= */

  const parseInvoiceText = (text) => {
    const date = parseDateFromText(text);
    const amount = pickLikelyAmount(text);
    const price  = pickLikelyPrice(text);
    const product = pickLikelyProduct(text);
    return { date, amount, price, product };
  };

  const compareWithData = (inv) => {
    if (!normalized.length) return { match:false, row:null };
    for (const r of normalized) {
      const okProduct = similarText(r.product, inv.product);
      const okPrice   = inv.price  ? closeNum(r.price,   inv.price)   : true;
      const okAmount  = inv.amount ? closeNum(r.revenue, inv.amount)  : true;
      const okDate    = inv.date && r.date ? yyyymmdd(r.date) === yyyymmdd(inv.date) : true;
      if (okProduct && okPrice && okAmount && okDate) return { match:true, row:r };
    }
    return { match:false, row:null };
  };

  const handleOCRFiles = async (fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const base = files.map((f,i)=>({ id: Date.now()+i, name: f.name, status:"processing", progress:0, text:"", parsed:null, match:null }));
    setOcrItems(prev=>[...prev, ...base]);

    for (let i=0;i<files.length;i++){
      const file = files[i]; const id = base[i].id;
      try{
        const { data } = await Tesseract.recognize(file, "ara+eng", {
          logger: (m)=>{
            if (m.status==="recognizing text" || m.progress){
              setOcrItems(prev=>prev.map(it=> it.id===id ? { ...it, progress: Math.round((m.progress||0)*100) } : it));
            }
          }
        });
        const text = data.text || "";
        const parsed = parseInvoiceText(text);
        const cmp = compareWithData(parsed);
        setOcrItems(prev=>prev.map(it=> it.id===id ? { ...it, status:"done", text, parsed, match: cmp.match, matchedRow: cmp.row } : it));
      }catch(e){
        setOcrItems(prev=>prev.map(it=> it.id===id ? { ...it, status:"error", progress:0 } : it));
      }
    }
  };

  const correctCount     = ocrItems.filter(x=>x.status==="done" && x.match===true ).length;
  const wrongCount       = ocrItems.filter(x=>x.status==="done" && x.match===false).length;
  const processingCount  = ocrItems.filter(x=>x.status==="processing").length;

  const downloadOCRCSV = () => {
    const data = ocrItems.map(it => ({
      file: it.name,
      status: it.status,
      match: it.match===true ? "صحيحة" : it.match===false ? "خاطئة" : "—",
      product_ocr: it.parsed?.product || "",
      price_ocr:   it.parsed?.price   || "",
      amount_ocr:  it.parsed?.amount  || "",
      date_ocr:    it.parsed?.date ? yyyymmdd(it.parsed.date) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "OCR");
    const out = XLSX.write(wb, { type: "array", bookType: "csv" });
    const blob = new Blob([out], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ocr_results.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  /* ================= UI ================= */

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <FileSpreadsheet className="w-6 h-6" />
          <h1 className="text-xl md:text-2xl font-semibold">
            لوحة مبيعات تفاعلية – استورد ملف Excel
          </h1>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Upload + map */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6">
          <div className="flex flex-col md:flex-row items-start md:items-center gap-4 justify-between">
            <div>
              <h2 className="text-lg font-semibold mb-1">1) ارفع ملف البيانات</h2>
              <p className="text-sm text-gray-600">
                يدعم: .xlsx, .xls, .csv — يُفضّل أن يحتوي الملف على أعمدة مثل:
                <span className="font-medium"> التاريخ، المنتج، الكمية، السعر، المبلغ/الإيراد</span>.
              </p>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl border hover:shadow">
              <Upload className="w-4 h-4" />
              <span>اختيار ملف</span>
              <input
                type="file" className="hidden" accept=".xlsx,.xls,.csv"
                onChange={(e)=>{ const f=e.target.files?.[0]; if(f) handleFile(f); }}
              />
            </label>
          </div>

          {workbook && (
            <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <label className="block text-sm font-medium">ورقة العمل</label>
                <select className="w-full border rounded-xl p-2" value={sheetName} onChange={(e)=>setSheetName(e.target.value)}>
                  {workbook.SheetNames.map(n=> <option key={n} value={n}>{n}</option>)}
                </select>
              </div>

              <div className="space-y-3">
                <label className="block text-sm font-medium flex items-center gap-2">
                  <Filter className="w-4 h-4" /> تعيين الأعمدة (يمكن التعديل)
                </label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {[
                    ["date","التاريخ"],
                    ["product","المنتج"],
                    ["qty","الكمية"],
                    ["price","السعر للوحدة"],
                    ["revenue","الإيراد/المبلغ"],
                    ["region","المنطقة (اختياري)"],
                  ].map(([k,label])=>(
                    <div key={k} className="space-y-1">
                      <span className="text-xs text-gray-600">{label}</span>
                      <select
                        className="w-full border rounded-xl p-2 text-sm"
                        value={mapCols[k] || ""}
                        onChange={(e) => updateMap(k, e.target.value)}
                      >
                        <option value="">— لا شيء —</option>
                        {selectableHeaders.map((h) => (
                          <option key={h} value={h}>{h}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </section>

        {/* Filters */}
        {normalized.length>0 && (
          <section className="bg-white rounded-2xl shadow p-4 md:p-6">
            <h2 className="text-lg font-semibold mb-4">2) الفلاتر</h2>
            <div className="grid gap-4 md:grid-cols-3 items-end">
              <div>
                <label className="block text-sm text-gray-600 mb-1">من تاريخ</label>
                <input type="date" className="w-full border rounded-xl p-2"
                  min={bounds.min||undefined} max={bounds.max||undefined}
                  value={filters.start || bounds.min}
                  onChange={(e)=>setFilters(f=>({...f,start:e.target.value}))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">إلى تاريخ</label>
                <input type="date" className="w-full border rounded-xl p-2"
                  min={bounds.min||undefined} max={bounds.max||undefined}
                  value={filters.end || bounds.max}
                  onChange={(e)=>setFilters(f=>({...f,end:e.target.value}))}
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">اختيار منتجات</label>
                <select className="w-full border rounded-xl p-2" multiple size={6}
                  value={filters.products}
                  onChange={(e)=>setFilters(f=>({...f,products:Array.from(e.target.selectedOptions).map(o=>o.value)}))}
                >
                  {productOptions.map(p=> <option key={p} value={p}>{p}</option>)}
                </select>
                <div className="flex gap-2 mt-2">
                  <button className="text-xs underline" onClick={()=>setFilters(f=>({...f,products:[]}))}>إلغاء تحديد الكل</button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* KPIs */}
        {normalized.length>0 && (
          <section className="grid md:grid-cols-5 gap-4">
            {[
              {title:"إجمالي الإيرادات", value:fmtCurr(summary.totalRevenue)},
              {title:"إجمالي الوحدات المباعة", value:fmtInt(summary.totalQty)},
              {title:"متوسط سعر البيع", value:fmtCurr(summary.avgPrice)},
              {title:"عدد السجلات", value:fmtInt(summary.orders)},
              {title:"عدد المنتجات", value:fmtInt(summary.uniqueProducts)},
            ].map((kpi,i)=>(
              <motion.div key={i} initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{delay:i*0.05}} className="bg-white rounded-2xl shadow p-4">
                <div className="text-sm text-gray-600">{kpi.title}</div>
                <div className="text-2xl font-semibold mt-1">{kpi.value}</div>
              </motion.div>
            ))}
          </section>
        )}

        {/* Charts */}
        {normalized.length>0 && (
          <section className="grid lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl shadow p-4 md:p-6 h-[380px]">
              <h3 className="font-semibold mb-3">الإيرادات بمرور الوقت</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={byDate}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{fontSize:12}} />
                  <YAxis tick={{fontSize:12}} />
                  <Tooltip formatter={(v,n)=> (n==="revenue"? fmtCurr(v): v)} />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" name="الإيراد" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl shadow p-4 md:p-6 h-[380px]">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">أعلى المنتجات حسب الإيراد</h3>
                <button className="inline-flex items-center gap-2 text-sm px-3 py-1.5 border rounded-xl hover:shadow" onClick={downloadProcessedCSV}>
                  <Download className="w-4 h-4" /> تنزيل CSV المعالج
                </button>
              </div>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={topProducts}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="product" tick={{fontSize:10}} interval={0} angle={-20} height={70} />
                  <YAxis tick={{fontSize:12}} />
                  <Tooltip formatter={(v,n)=> (n==="revenue"? fmtCurr(v): v)} />
                  <Legend />
                  <Bar dataKey="revenue" name="الإيراد" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-2xl shadow p-4 md:p-6 h-[380px] lg:col-span-2">
              <h3 className="font-semibold mb-3">الحصة السوقية لأفضل المنتجات</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                    {pieData.map((_,i)=> <Cell key={i} />)}
                  </Pie>
                  <Tooltip formatter={(v)=> fmtCurr(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        {/* AI OCR Validation */}
        {normalized.length>0 && (
          <section className="bg-white rounded-2xl shadow p-4 md:p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <ImageIcon className="w-5 h-5" /> 3) التحقق بالذكاء الاصطناعي من صور الفواتير
              </h2>
              {ocrItems.length>0 && (
                <div className="flex items-center gap-3 text-sm">
                  <span className="inline-flex items-center gap-1"><CheckCircle2 className="w-4 h-4 text-green-600" /> صحيحة: {correctCount}</span>
                  <span className="inline-flex items-center gap-1"><XCircle className="w-4 h-4 text-red-600" /> خاطئة: {wrongCount}</span>
                  {processingCount>0 && (
                    <span className="inline-flex items-center gap-1"><Loader2 className="w-4 h-4 animate-spin" /> قيد المعالجة: {processingCount}</span>
                  )}
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col sm:flex-row items-start gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-xl border hover:shadow">
                <Upload className="w-4 h-4" />
                <span>رفع صور فواتير</span>
                <input type="file" className="hidden" accept="image/*" multiple onChange={(e)=>handleOCRFiles(e.target.files)} />
              </label>
              {ocrItems.length>0 && (
                <button className="inline-flex items-center gap-2 text-sm px-3 py-1.5 border rounded-xl hover:shadow" onClick={downloadOCRCSV}>
                  <Download className="w-4 h-4" /> تنزيل نتائج OCR
                </button>
              )}
            </div>

            {ocrItems.length>0 && (
              <div className="mt-6 overflow-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="p-2 text-right">الملف</th>
                      <th className="p-2 text-right">المنتج (OCR)</th>
                      <th className="p-2 text-right">السعر</th>
                      <th className="p-2 text-right">المبلغ</th>
                      <th className="p-2 text-right">التاريخ</th>
                      <th className="p-2 text-right">النتيجة</th>
                      <th className="p-2 text-right">التقدم</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ocrItems.map(it=>(
                      <tr key={it.id} className="border-t">
                        <td className="p-2 whitespace-nowrap">{it.name}</td>
                        <td className="p-2">{it.parsed?.product || "—"}</td>
                        <td className="p-2 text-right">{it.parsed?.price ? fmtCurr(it.parsed.price) : "—"}</td>
                        <td className="p-2 text-right">{it.parsed?.amount ? fmtCurr(it.parsed.amount) : "—"}</td>
                        <td className="p-2 whitespace-nowrap">{it.parsed?.date ? yyyymmdd(it.parsed.date) : "—"}</td>
                        <td className="p-2">
                          {it.status==="done" && it.match===true  && (<span className="inline-flex items-center gap-1 text-green-700"><CheckCircle2 className="w-4 h-4" /> مطابقة</span>)}
                          {it.status==="done" && it.match===false && (<span className="inline-flex items-center gap-1 text-red-700"><XCircle className="w-4 h-4" /> غير مطابقة</span>)}
                          {it.status==="processing" && (<span className="inline-flex items-center gap-1 text-gray-600"><Loader2 className="w-4 h-4 animate-spin" /> جارٍ القراءة…</span>)}
                          {it.status==="error" && <span className="text-red-600">خطأ في التعرف</span>}
                        </td>
                        <td className="p-2 w-40">
                          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div className="h-full bg-gray-700" style={{ width: `${it.progress || (it.status==="done" ? 100 : 0)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* Data preview */}
        {filtered.length>0 && (
          <section className="bg-white rounded-2xl shadow p-4 md:p-6">
            <h3 className="font-semibold mb-3">معاينة البيانات (أول 50 صف)</h3>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="text-right p-2">التاريخ</th>
                    <th className="text-right p-2">المنتج</th>
                    <th className="text-right p-2">الكمية</th>
                    <th className="text-right p-2">السعر</th>
                    <th className="text-right p-2">الإيراد</th>
                    <th className="text-right p-2">المنطقة</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0,50).map((r,i)=>(
                    <tr key={i} className="border-t">
                      <td className="p-2 whitespace-nowrap">{r.date ? yyyymmdd(r.date) : ""}</td>
                      <td className="p-2 whitespace-nowrap">{r.product}</td>
                      <td className="p-2 whitespace-nowrap text-right">{fmtInt(r.qty)}</td>
                      <td className="p-2 whitespace-nowrap text-right">{fmtCurr(r.price)}</td>
                      <td className="p-2 whitespace-nowrap text-right">{fmtCurr(r.revenue)}</td>
                      <td className="p-2 whitespace-nowrap">{r.region}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Help */}
        <section className="bg-white rounded-2xl shadow p-4 md:p-6">
          <h2 className="text-lg font-semibold mb-2">ملاحظات مهمة</h2>
          <ul className="list-disc pr-6 space-y-1 text-sm text-gray-700">
            <li>تأكدي من تعيين الأعمدة بشكل صحيح (التاريخ/المنتج/السعر/المبلغ) في “تعيين الأعمدة”.</li>
            <li>التطابق للأرقام بهامش سماح ‎≈‎5%، والتاريخ يطابق اليوم نفسه، والمنتج بالمطابقة النصية.</li>
            <li>دقّة الـOCR تعتمد على جودة الصورة (إضاءة جيّدة، بدون ميل أو تشويش، دقة عالية).</li>
          </ul>
        </section>
      </main>

      <footer className="py-8 text-center text-xs text-gray-500">
        صُمّم بواسطة React + Recharts + XLSX + Tesseract.js. ✨
      </footer>
    </div>
  );
}
