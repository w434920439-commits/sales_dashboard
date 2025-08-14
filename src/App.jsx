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
    if (y < 100)
