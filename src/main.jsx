import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

async function readJson(response) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    await response.text();
    throw new Error(`Server সঠিক data ফেরত দেয়নি (HTTP ${response.status})। Server restart করে আবার চেষ্টা করুন।`);
  }
  return response.json();
}
import {
  Camera,
  Check,
  ChevronLeft,
  Database,
  Download,
  Eye,
  FilePlus2,
  IdCard,
  ImagePlus,
  LogOut,
  Plus,
  Printer,
  Pencil,
  RotateCcw,
  ScanLine,
  Search,
  Settings,
  Trash2,
  UserRound,
  UsersRound,
  Wallet,
  ShieldCheck,
  Clock3,
  Home,
  ListChecks,
  RefreshCw,
  Target,
  LockKeyhole,
  Bell,
  MessageCircle,
  Menu,
  PanelLeftClose,
  X,
} from "lucide-react";
import { jsPDF } from "jspdf";
import PhotoPrintEditor from "./PhotoPrintEditor.jsx";
import { exportName, photoPrintPdf } from "./export-model.js";
import { buildCustomerZip } from "./customer-zip.js";
import "./styles.css";
const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `ds-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const person = (role = "Applicant") => ({
  id: uid(),
  role,
  name: "",
  nameBn: "",
  fatherNameBn: "",
  motherNameBn: "",
  fatherNameEn: "",
  motherNameEn: "",
  nid: "",
  dob: "",
  addressBn: "",
  addressEn: "",
  ocrText: "",
  ocrStatus: "",
  idFront: null,
  idBack: null,
  identityType: "nid",
  birthCertificate: null,
  photo: null,
  profession: "",
});
const kinds = [
  {
    id: "signature",
    label: "Signature Card",
    sides: 1,
    hint: "Background ছাড়া Signature_Card.png",
  },
  {
    id: "signature_card",
    label: "Signed A4 Signature Card",
    sides: 1,
    hint: "গ্রাহকের স্বাক্ষর করা A4 card-এর একটি JPG",
  },
  {
    id: "job",
    label: "Job ID",
    sides: 2,
    hint: "Front ও Back মিলিয়ে একটি PDF",
  },
  {
    id: "trade",
    label: "Trade Licence",
    sides: 1,
    hint: "ছবিটি A4 পৃষ্ঠার মাঝখানে",
  },
  {
    id: "other",
    label: "Other Document",
    sides: 1,
    hint: "প্রয়োজনীয় পৃষ্ঠা নিয়ে একটি PDF",
  },
];
const safe = (v) =>
  (v || "Untitled")
    .trim()
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 70);
const asDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
const personBase = (p) =>
  safe(`${p.nid ? p.nid + "_" : ""}${p.name || p.nameBn || p.role}`);
const dataSizeKb = (value) => {
  const encoded = String(value || "").split(",")[1] || "";
  return Math.max(0, Math.round((encoded.length * 3) / 4 / 1024));
};
async function jpegInTargetRange(source, minKb = 100, maxKb = 150) {
  let canvas = source;
  for (let resize = 0; resize < 4; resize++) {
    let low = 0.32,
      high = 0.95,
      best = canvas.toDataURL("image/jpeg", low);
    for (let attempt = 0; attempt < 5; attempt++) {
      const quality = (low + high) / 2,
        candidate = canvas.toDataURL("image/jpeg", quality),
        kb = dataSizeKb(candidate);
      if (kb <= maxKb) {
        best = candidate;
        low = quality;
      } else high = quality;
    }
    const bestKb = dataSizeKb(best);
    if ((bestKb >= minKb && bestKb <= maxKb) || resize === 3) return best;
    const candidate = canvas.toDataURL("image/jpeg", 0.95);
    if (dataSizeKb(candidate) <= maxKb) return candidate;
    const smaller = document.createElement("canvas");
    smaller.width = Math.round(canvas.width * 0.82);
    smaller.height = Math.round(canvas.height * 0.82);
    smaller
      .getContext("2d")
      .drawImage(canvas, 0, 0, smaller.width, smaller.height);
    canvas = smaller;
  }
  return canvas.toDataURL("image/jpeg", 0.72);
}
function parseIdText(text) {
  const lines = text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    after = (tests, script) => {
      for (let i = 0; i < lines.length; i++) {
        if (tests.some((t) => t.test(lines[i]))) {
          const own = lines[i].split(/[:ঃ]/).slice(1).join(":").trim();
          if (own && (!script || script.test(own))) return own;
          for (let j = i + 1; j < Math.min(i + 3, lines.length); j++)
            if (!script || script.test(lines[j])) return lines[j];
        }
      }
      return "";
    };
  const nid =
    (text.match(
      /(?:NID|ID\s*NO|জাতীয়\s*পরিচয়\s*পত্র)[^\d০-৯]{0,20}([\d০-৯][\d০-৯\s-]{8,22})/i,
    ) ||
      text.match(/\b(\d{10}|\d{13}|\d{17})\b/) ||
      [])[1] || "";
  const dob =
    (text.match(
      /(?:Date\s*of\s*Birth|DOB|জন্ম\s*তারিখ)[^\d০-৯]{0,15}([\d০-৯]{1,4}[\s./-][\d০-৯]{1,2}[\s./-][\d০-৯]{2,4})/i,
    ) || [])[1] || "";
  return {
    name: after([/\bName\b/i], /[A-Za-z]/),
    nameBn: after([/নাম/], /[\u0980-\u09FF]/),
    nid: nid.replace(/[\s-]/g, ""),
    dob,
    addressBn: after([/ঠিকানা/], /[\u0980-\u09FF]/),
    addressEn: after([/\bAddress\b/i], /[A-Za-z]/),
  };
}
async function scanId(images, onProgress) {
  const sources = Array.isArray(images) ? images.filter(Boolean) : [images];
  if (!sources.length) throw new Error("ID_IMAGE_MISSING");
  onProgress?.(20);
  const response = await fetch("/api/gemini-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images: sources }),
  });
  onProgress?.(85);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Gemini scan failed");
  onProgress?.(100);
  return result;
}
async function cardScan(imageData, action, points, mode, fixedRatio = false) {
  const response = await fetch("/api/card-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: imageData,
      action,
      points,
      mode,
      fixedRatio,
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "ID card scan হয়নি");
  return result;
}
async function signatureScan(imageData, action = "process") {
  const response = await fetch("/api/signature-scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageData, action }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Signature scan হয়নি");
  return result;
}
async function makePassportPhoto(imageData) {
  const response = await fetch("/api/passport-photo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image: imageData }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Passport photo তৈরি হয়নি");
  return result;
}
async function polishDescription(text, context = {}) {
  const response = await fetch("/api/gemini-description", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...context }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Description তৈরি হয়নি");
  return result.text;
}
const image = (src) =>
  new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = no;
    i.src = src;
  });
function documentBounds(source) {
  const scale = Math.min(1, 500 / source.width),
    c = document.createElement("canvas");
  c.width = Math.round(source.width * scale);
  c.height = Math.round(source.height * scale);
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height).data,
    corners = [
      [3, 3],
      [c.width - 4, 3],
      [3, c.height - 4],
      [c.width - 4, c.height - 4],
    ],
    bg = corners
      .reduce(
        (a, [x, y]) => {
          const n = (y * c.width + x) * 4;
          return [a[0] + data[n], a[1] + data[n + 1], a[2] + data[n + 2]];
        },
        [0, 0, 0],
      )
      .map((v) => v / 4);
  let left = c.width,
    top = c.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < c.height; y += 2)
    for (let x = 0; x < c.width; x += 2) {
      const n = (y * c.width + x) * 4,
        distance =
          Math.abs(data[n] - bg[0]) +
          Math.abs(data[n + 1] - bg[1]) +
          Math.abs(data[n + 2] - bg[2]);
      if (distance > 105) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (
    right <= left ||
    (right - left) * (bottom - top) < c.width * c.height * 0.18
  )
    return { x: 0, y: 0, w: source.width, h: source.height };
  const pad = Math.max(c.width, c.height) * 0.025;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  right = Math.min(c.width, right + pad);
  bottom = Math.min(c.height, bottom + pad);
  return {
    x: left / scale,
    y: top / scale,
    w: (right - left) / scale,
    h: (bottom - top) / scale,
  };
}
async function openCv() {
  if (
    !globalThis.cv &&
    !document.querySelector("script[data-document-scanner]")
  ) {
    const script = document.createElement("script");
    script.src = "/opencv.js";
    script.async = true;
    script.dataset.documentScanner = "true";
    document.head.appendChild(script);
  }
  for (let attempt = 0; attempt < 45; attempt++) {
    let library = globalThis.cv;
    if (library?.then) library = await library;
    if (library?.Mat && library?.findContours) return library;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}
function orderQuad(points, width, height) {
  const p = points.map((point) => ({
    x: point.x / width,
    y: point.y / height,
  }));
  return [
    p.reduce((a, v) => (v.x + v.y < a.x + a.y ? v : a)),
    p.reduce((a, v) => (v.x - v.y > a.x - a.y ? v : a)),
    p.reduce((a, v) => (v.x + v.y > a.x + a.y ? v : a)),
    p.reduce((a, v) => (v.x - v.y < a.x - a.y ? v : a)),
  ];
}
async function documentQuad(source) {
  const cv = await openCv();
  if (cv) {
    const holder = document.createElement("canvas"),
      scale = Math.min(1, 700 / Math.max(source.width, source.height));
    holder.width = Math.round(source.width * scale);
    holder.height = Math.round(source.height * scale);
    holder
      .getContext("2d")
      .drawImage(source, 0, 0, holder.width, holder.height);
    const src = cv.imread(holder),
      gray = new cv.Mat(),
      blur = new cv.Mat(),
      edges = new cv.Mat(),
      closed = new cv.Mat(),
      contours = new cv.MatVector(),
      hierarchy = new cv.Mat();
    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      cv.Canny(blur, edges, 40, 135);
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7));
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
      cv.findContours(
        closed,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE,
      );
      kernel.delete();
      let best,
        bestArea = 0;
      for (let index = 0; index < contours.size(); index++) {
        const contour = contours.get(index),
          area = cv.contourArea(contour),
          approx = new cv.Mat();
        cv.approxPolyDP(
          contour,
          approx,
          cv.arcLength(contour, true) * 0.025,
          true,
        );
        if (
          approx.rows === 4 &&
          area > bestArea &&
          area > holder.width * holder.height * 0.1
        ) {
          best?.delete();
          best = approx.clone();
          bestArea = area;
        }
        approx.delete();
        contour.delete();
      }
      if (best) {
        const points = [];
        for (let index = 0; index < 4; index++)
          points.push({
            x: best.data32S[index * 2],
            y: best.data32S[index * 2 + 1],
          });
        best.delete();
        return orderQuad(points, holder.width, holder.height);
      }
    } finally {
      src.delete();
      gray.delete();
      blur.delete();
      edges.delete();
      closed.delete();
      contours.delete();
      hierarchy.delete();
    }
  }
  const scale = Math.min(1, 700 / Math.max(source.width, source.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(source.width * scale));
  c.height = Math.max(1, Math.round(source.height * scale));
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0, c.width, c.height);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  const samples = [];
  for (let y = 2; y < c.height - 2; y += 3)
    for (let x = 2; x < c.width - 2; x += 3) {
      const n = (y * c.width + x) * 4;
      const left = (y * c.width + x - 2) * 4;
      const up = ((y - 2) * c.width + x) * 4;
      const edge =
        Math.abs(data[n] - data[left]) +
        Math.abs(data[n + 1] - data[left + 1]) +
        Math.abs(data[n + 2] - data[left + 2]) +
        Math.abs(data[n] - data[up]) +
        Math.abs(data[n + 1] - data[up + 1]) +
        Math.abs(data[n + 2] - data[up + 2]);
      if (edge > 115) samples.push({ x, y });
    }
  if (samples.length < 40) {
    const b = documentBounds(source);
    return [
      { x: b.x / source.width, y: b.y / source.height },
      { x: (b.x + b.w) / source.width, y: b.y / source.height },
      {
        x: (b.x + b.w) / source.width,
        y: (b.y + b.h) / source.height,
      },
      { x: b.x / source.width, y: (b.y + b.h) / source.height },
    ];
  }
  const center = { x: c.width / 2, y: c.height / 2 };
  const outer = samples.filter(
    (p) =>
      Math.abs(p.x - center.x) > c.width * 0.18 ||
      Math.abs(p.y - center.y) > c.height * 0.18,
  );
  const pick = (score, lowest = true) =>
    outer.reduce((best, p) =>
      (lowest ? score(p) < score(best) : score(p) > score(best)) ? p : best,
    );
  const points = [
    pick((p) => p.x + p.y),
    pick((p) => p.x - p.y, false),
    pick((p) => p.x + p.y, false),
    pick((p) => p.x - p.y),
  ];
  return points.map((p) => ({
    x: Math.max(0.02, Math.min(0.98, p.x / c.width)),
    y: Math.max(0.02, Math.min(0.98, p.y / c.height)),
  }));
}
function fallbackPerspectiveCard(source, quad) {
  const width = 1200,
    height = Math.round(width / 1.586),
    input = document.createElement("canvas");
  input.width = source.width;
  input.height = source.height;
  const ig = input.getContext("2d", { willReadFrequently: true });
  ig.drawImage(source, 0, 0);
  const src = ig.getImageData(0, 0, input.width, input.height),
    output = document.createElement("canvas");
  output.width = width;
  output.height = height;
  const og = output.getContext("2d"),
    out = og.createImageData(width, height),
    p = quad.map((q) => ({ x: q.x * source.width, y: q.y * source.height }));
  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1),
        sx =
          (1 - u) * (1 - v) * p[0].x +
          u * (1 - v) * p[1].x +
          u * v * p[2].x +
          (1 - u) * v * p[3].x,
        sy =
          (1 - u) * (1 - v) * p[0].y +
          u * (1 - v) * p[1].y +
          u * v * p[2].y +
          (1 - u) * v * p[3].y,
        si = (Math.round(sy) * source.width + Math.round(sx)) * 4,
        di = (y * width + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = 255;
    }
  }
  og.putImageData(out, 0, 0);
  const clean = document.createElement("canvas");
  clean.width = width;
  clean.height = height;
  const cg = clean.getContext("2d");
  cg.filter = "contrast(1.16) saturate(1.04) brightness(1.05)";
  cg.drawImage(output, 0, 0);
  return clean;
}
function applyScanMode(source, mode, cv) {
  if (mode === "original") return source;
  const result = document.createElement("canvas");
  result.width = source.width;
  result.height = source.height;
  if (mode === "bw" && cv) {
    const src = cv.imread(source),
      gray = new cv.Mat(),
      out = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(
      gray,
      out,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      31,
      12,
    );
    cv.imshow(result, out);
    src.delete();
    gray.delete();
    out.delete();
    return result;
  }
  const filters = {
    auto: "contrast(1.22) saturate(1.08) brightness(1.07)",
    lighten: "contrast(1.08) saturate(.96) brightness(1.2)",
    magic: "contrast(1.28) saturate(1.42) brightness(1.06)",
    gray: "grayscale(1) contrast(1.2) brightness(1.08)",
    bw: "grayscale(1) contrast(2.2) brightness(1.12)",
  };
  const g = result.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, result.width, result.height);
  g.filter = filters[mode] || filters.auto;
  g.drawImage(source, 0, 0);
  return result;
}
async function perspectiveCard(source, quad, mode = "auto") {
  const width = 1400,
    height = Math.round(width / 1.586),
    cv = await openCv();
  let output;
  if (!cv) output = fallbackPerspectiveCard(source, quad);
  else {
    const holder = document.createElement("canvas");
    holder.width = source.width;
    holder.height = source.height;
    holder.getContext("2d").drawImage(source, 0, 0);
    const src = cv.imread(holder),
      dst = new cv.Mat(),
      from = cv.matFromArray(
        4,
        1,
        cv.CV_32FC2,
        quad.flatMap((q) => [q.x * source.width, q.y * source.height]),
      ),
      to = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        width,
        0,
        width,
        height,
        0,
        height,
      ]),
      matrix = cv.getPerspectiveTransform(from, to);
    cv.warpPerspective(
      src,
      dst,
      matrix,
      new cv.Size(width, height),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE,
    );
    output = document.createElement("canvas");
    output.width = width;
    output.height = height;
    cv.imshow(output, dst);
    src.delete();
    dst.delete();
    from.delete();
    to.delete();
    matrix.delete();
  }
  return applyScanMode(output, mode, cv);
}
async function processImage(
  src,
  passport,
  signature,
  idDocument,
  faceBox,
  cropQuad,
) {
  const i = await image(src),
    ratio = passport ? 35 / 45 : signature ? 3 : idDocument ? 1.586 : null;
  let x = 0,
    y = 0,
    w = i.width,
    h = i.height;
  if (idDocument && cropQuad)
    return jpegInTargetRange(
      await perspectiveCard(i, cropQuad.points || cropQuad, cropQuad.mode),
    );
  if (idDocument) ({ x, y, w, h } = documentBounds(i));
  if (passport && faceBox?.w) {
    const fx = (faceBox.x / 1000) * i.width,
      fy = (faceBox.y / 1000) * i.height,
      fw = (faceBox.w / 1000) * i.width,
      fh = (faceBox.h / 1000) * i.height;
    w = Math.min(i.width, fw * 2.45);
    h = Math.min(i.height, w / ratio);
    x = Math.max(0, Math.min(i.width - w, fx + fw / 2 - w / 2));
    y = Math.max(0, Math.min(i.height - h, fy - fh * 0.65));
  }
  if (ratio) {
    const centerX = x + w / 2,
      centerY = y + h / 2;
    w / h > ratio
      ? ((w = h * ratio), (x = centerX - w / 2))
      : ((h = w / ratio), (y = centerY - h / 2));
    x = Math.max(0, Math.min(i.width - w, x));
    y = Math.max(0, Math.min(i.height - h, y));
  }
  const c = document.createElement("canvas");
  c.width = passport
    ? 700
    : signature
      ? 1200
      : idDocument
        ? 1600
        : Math.min(1800, w);
  c.height = passport ? 900 : signature ? 400 : Math.round((c.width * h) / w);
  const g = c.getContext("2d");
  if (passport) {
    g.fillStyle = "#2876cf";
    g.fillRect(0, 0, c.width, c.height);
  } else if (signature) {
    g.fillStyle = "#fff";
    g.fillRect(0, 0, c.width, c.height);
  }
  if (idDocument) g.filter = "contrast(1.12) saturate(1.06) brightness(1.03)";
  g.drawImage(i, x, y, w, h, 0, 0, c.width, c.height);
  g.filter = "none";
  if (passport) {
    const subject = transparentEdgeBackground(c);
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = "#2876cf";
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(subject, 0, 0);
  }
  if (signature)
    return cropTransparentInk(transparentInk(c)).toDataURL("image/png");
  return jpegInTargetRange(c);
}
function transparentEdgeBackground(source) {
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0);
  const pixels = g.getImageData(0, 0, c.width, c.height),
    d = pixels.data,
    points = [
      [4, 4],
      [c.width - 5, 4],
      [4, c.height - 5],
      [c.width - 5, c.height - 5],
    ],
    bg = points
      .reduce(
        (a, [x, y]) => {
          const n = (y * c.width + x) * 4;
          return [a[0] + d[n], a[1] + d[n + 1], a[2] + d[n + 2]];
        },
        [0, 0, 0],
      )
      .map((v) => v / 4);
  for (let n = 0; n < d.length; n += 4) {
    const dist = Math.sqrt(
      (d[n] - bg[0]) ** 2 + (d[n + 1] - bg[1]) ** 2 + (d[n + 2] - bg[2]) ** 2,
    );
    if (dist < 72)
      d[n + 3] = Math.round(
        d[n + 3] * Math.max(0, Math.min(1, (dist - 20) / 52)),
      );
  }
  g.putImageData(pixels, 0, 0);
  return c;
}
function transparentInk(source) {
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0);
  const pixels = g.getImageData(0, 0, c.width, c.height),
    d = pixels.data,
    cornerSamples = [],
    margin = Math.max(3, Math.round(Math.min(c.width, c.height) * 0.025));
  for (const [startX, startY] of [
    [0, 0],
    [c.width - margin, 0],
    [0, c.height - margin],
    [c.width - margin, c.height - margin],
  ])
    for (let y = startY; y < startY + margin; y += 2)
      for (let x = startX; x < startX + margin; x += 2) {
        const n = (y * c.width + x) * 4;
        cornerSamples.push([d[n], d[n + 1], d[n + 2]]);
      }
  const background = [0, 1, 2].map(
      (channel) =>
        cornerSamples.reduce((sum, pixel) => sum + pixel[channel], 0) /
        Math.max(1, cornerSamples.length),
    ),
    backgroundLight =
      background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114;
  for (let i = 0; i < pixels.data.length; i += 4) {
    const r = pixels.data[i],
      green = pixels.data[i + 1],
      b = pixels.data[i + 2],
      light = r * 0.299 + green * 0.587 + b * 0.114,
      colorDistance = Math.sqrt(
        (r - background[0]) ** 2 +
          (green - background[1]) ** 2 +
          (b - background[2]) ** 2,
      ),
      ink = Math.max(
        (colorDistance - 16) / 72,
        (backgroundLight - light - 7) / 72,
      ),
      opacity = ink < 0.1 ? 0 : Math.max(0, Math.min(1, (ink - 0.08) * 1.35));
    pixels.data[i + 3] = Math.round(255 * opacity);
  }
  g.putImageData(pixels, 0, 0);
  return c;
}
function cropTransparentInk(source) {
  const g = source.getContext("2d", { willReadFrequently: true }),
    data = g.getImageData(0, 0, source.width, source.height).data;
  let left = source.width,
    top = source.height,
    right = 0,
    bottom = 0;
  for (let y = 0; y < source.height; y += 2)
    for (let x = 0; x < source.width; x += 2)
      if (data[(y * source.width + x) * 4 + 3] > 28) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right <= left || bottom <= top) return source;
  const pad = 18,
    width = right - left + 1,
    height = bottom - top + 1,
    output = document.createElement("canvas");
  output.width = 1200;
  output.height = 400;
  const scale = Math.min(
      (output.width - pad * 2) / width,
      (output.height - pad * 2) / height,
    ),
    drawWidth = width * scale,
    drawHeight = height * scale;
  output
    .getContext("2d")
    .drawImage(
      source,
      left,
      top,
      width,
      height,
      (output.width - drawWidth) / 2,
      (output.height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  return output;
}
const blob = async (u) => await (await fetch(u)).blob();
function fit(d, data, y, maxW = 118, maxH = 76) {
  const p = d.getImageProperties(data),
    r = Math.min(maxW / p.width, maxH / p.height),
    w = p.width * r,
    h = p.height * r;
  d.addImage(data, "JPEG", (210 - w) / 2, y + (maxH - h) / 2, w, h);
}
function idPdf(p) {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  d.setFontSize(12);
  d.text(`${p.name || p.role} - ID Card`, 105, 16, { align: "center" });
  fit(d, p.idFront, 28);
  fit(d, p.idBack, 126);
  return d.output("blob");
}
function identityPdf(p) {
  if (p.identityType === "birth" && p.birthCertificate)
    return docPdf({
      name: `${p.name || p.nameBn || p.role} - Birth Certificate`,
      pages: [p.birthCertificate],
      kind: "birth",
    });
  return p.idFront && p.idBack ? idPdf(p) : null;
}
function docPdf(o) {
  const d = new jsPDF({ unit: "mm", format: "a4" });
  d.setFontSize(12);
  d.text(o.name, 105, 16, { align: "center" });
  o.pages.forEach((p, i) => {
    if (i) d.addPage();
    fit(d, p, 55, 165, 175);
  });
  if (o.pages.length === 2 && o.kind === "job") {
    const j = new jsPDF({ unit: "mm", format: "a4" });
    j.text(o.name, 105, 16, { align: "center" });
    fit(j, o.pages[0], 28);
    fit(j, o.pages[1], 126);
    return j.output("blob");
  }
  return d.output("blob");
}
async function declarationCanvas(applicant, declaration, signature) {
  const template = await image("/income-declaration-page1.png");
  const canvas = document.createElement("canvas");
  canvas.width = 1190;
  canvas.height = 1684;
  const g = canvas.getContext("2d");
  g.drawImage(template, 0, 0, canvas.width, canvas.height);
  g.fillStyle = "#111";
  g.textBaseline = "middle";
  const write = (value, x, y, maxWidth, size = 24) => {
    if (!value) return;
    g.font = `${size}px "Noto Sans Bengali", "Nirmala UI", sans-serif`;
    g.fillText(value, x, y, maxWidth);
  };
  const addressLines = String(applicant.addressBn || "").split(/\n+/);
  const first = (addressLines[0] || "").split(",").map((v) => v.trim());
  const second = (addressLines[1] || "").split(",").map((v) => v.trim());
  write(
    declaration.customerName || applicant.nameBn || applicant.name,
    210,
    250,
    820,
  );
  write(declaration.fatherName || applicant.fatherNameBn, 210, 305, 820);
  write(declaration.motherName || applicant.motherNameBn, 210, 360, 820);
  write(declaration.address || first[0] || applicant.addressBn, 225, 415, 800);
  write(declaration.postOffice || first.slice(1).join(", "), 255, 470, 255, 20);
  write(declaration.thana || second[0], 760, 470, 275, 20);
  write(declaration.district || second[1] || second[0], 225, 524, 500, 21);
  const description =
    declaration.polishedDescription || declaration.rawDescription;
  g.font = '23px "Noto Sans Bengali", "Nirmala UI", sans-serif';
  const words = String(description || "").split(/\s+/);
  let line = "",
    y = 735;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (g.measureText(test).width > 900 && line) {
      g.fillText(line, 145, y);
      line = word;
      y += 38;
      if (y > 970) break;
    } else line = test;
  }
  if (line && y <= 970) g.fillText(line, 145, y);
  write(declaration.monthlyIncome, 430, 1051, 160, 23);
  write(declaration.accountNumber, 785, 1267, 260, 21);
  if (signature) {
    const sign = await image(signature);
    g.drawImage(sign, 145, 1145, 330, 100);
  }
  return canvas;
}
async function declarationPdf(applicant, declaration, signature) {
  const canvas = await declarationCanvas(applicant, declaration, signature);
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  pdf.addImage(canvas.toDataURL("image/jpeg", 0.94), "JPEG", 0, 0, 210, 297);
  return pdf.output("blob");
}
async function customerZip(caseData) {
  async function jpeg(source) {
    const img = await image(source), canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width; canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0);
    return await blob(await jpegInTargetRange(canvas));
  }
  return buildCustomerZip(caseData,{jpeg,identityPdf,docPdf,declarationPdf,signatureScan,blob,kinds});
}
function pdfPage(title = "") {
  const canvas = document.createElement("canvas");
  canvas.width = 1240;
  canvas.height = 1754;
  const g = canvas.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = "#0e4336";
  g.fillRect(0, 0, canvas.width, 105);
  g.fillStyle = "#fff";
  g.font = '700 31px "Noto Sans Bengali", "Nirmala UI", sans-serif';
  g.fillText(title, 70, 65, 1100);
  return canvas;
}
function wrappedText(g, text, x, y, maxWidth, lineHeight = 34, font = '24px "Noto Sans Bengali", "Nirmala UI", sans-serif') {
  g.font = font;
  for (const paragraph of String(text || "—").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxWidth && line) {
        g.fillText(line, x, y);
        y += lineHeight;
        line = word;
      } else line = test;
    }
    if (line) g.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}
async function combinedCasePdf(caseName, details, people, docs, declaration) {
  const pdf = new jsPDF({ unit: "px", format: [1240, 1754], compress: true }),
    applicant = people[0],
    signature = docs.find((d) => d.kind === "signature")?.pages?.[0];
  let firstPage = true;
  const addCanvas = (canvas, quality = 0.86) => {
    if (!firstPage) pdf.addPage([1240, 1754], "portrait");
    firstPage = false;
    pdf.addImage(canvas.toDataURL("image/jpeg", quality), "JPEG", 0, 0, 1240, 1754, undefined, "FAST");
  };
  const addImagePage = async (title, source, transparent = false) => {
    if (!source) return;
    const canvas = pdfPage(title), g = canvas.getContext("2d"), img = await image(source),
      maxW = 1080, maxH = 1480, ratio = Math.min(maxW / img.width, maxH / img.height),
      width = img.width * ratio, height = img.height * ratio;
    if (transparent) {
      g.fillStyle = "#f4f7f5";
      g.fillRect(70, 145, 1100, 1510);
    }
    g.drawImage(img, (1240 - width) / 2, 155 + (1480 - height) / 2, width, height);
    addCanvas(canvas, 0.88);
  };
  const summary = pdfPage(`${caseName || "CUSTOMER"} — COMPLETE DOCUMENT`),
    sg = summary.getContext("2d");
  sg.fillStyle = "#173b32";
  sg.font = '700 28px "Noto Sans Bengali", "Nirmala UI", sans-serif';
  sg.fillText("Customer / Case Details", 70, 165);
  sg.fillStyle = "#16231f";
  let y = 225;
  for (const [label, value] of [
    ["Name", caseName], ["নাম", details.nameBn], ["Mobile", details.phone],
    ["Email", details.email], ["Customer/NID", details.customerId],
    ["Address (English)", details.addressEn], ["ঠিকানা (বাংলা)", details.addressBn],
  ]) {
    sg.font = '700 22px "Noto Sans Bengali", "Nirmala UI", sans-serif';
    sg.fillStyle = "#4e665f"; sg.fillText(`${label}:`, 70, y);
    sg.fillStyle = "#111";
    y = wrappedText(sg, value || "—", 330, y, 820, 31);
    y += 12;
  }
  addCanvas(summary);
  for (const person of people) {
    if (!person.name && !person.nameBn) continue;
    const page = pdfPage(`${person.role}: ${person.name || person.nameBn}`), g = page.getContext("2d");
    g.fillStyle = "#111";
    let py = 175;
    for (const [label, value] of [
      ["Name (English)", person.name], ["নাম (বাংলা)", person.nameBn], ["NID / ID", person.nid],
      ["Date of Birth", person.dob], ["Father's Name", person.fatherNameEn], ["পিতার নাম", person.fatherNameBn],
      ["Mother's Name", person.motherNameEn], ["মাতার নাম", person.motherNameBn],
      ["Address (English)", person.addressEn], ["ঠিকানা (বাংলা)", person.addressBn],
    ]) {
      g.fillStyle = "#52655f"; g.font = '700 20px "Noto Sans Bengali", "Nirmala UI", sans-serif'; g.fillText(`${label}:`, 70, py);
      g.fillStyle = "#111"; py = wrappedText(g, value || "—", 330, py, 820, 29, '21px "Noto Sans Bengali", "Nirmala UI", sans-serif'); py += 7;
    }
    if (person.photo) {
      const photo = await image(person.photo);
      g.drawImage(photo, 920, 130, 245, 315);
    }
    addCanvas(page);
    await addImagePage(`${person.role} — ID Front`, person.idFront);
    await addImagePage(`${person.role} — ID Back`, person.idBack);
    await addImagePage(`${person.role} — Birth Certificate`, person.birthCertificate);
    await addImagePage(`${person.role} — Passport Photo`, person.photo);
  }
  for (const doc of docs) {
    const label = doc.name || kinds.find((kind) => kind.id === doc.kind)?.label || "Additional Document";
    for (let index = 0; index < doc.pages.filter(Boolean).length; index++)
      await addImagePage(`${label}${doc.pages.length > 1 ? ` — Page ${index + 1}` : ""}`, doc.pages.filter(Boolean)[index], doc.kind === "signature");
  }
  if (declaration.customerName || declaration.rawDescription || declaration.polishedDescription) {
    addCanvas(await declarationCanvas(applicant, declaration, signature), 0.92);
  }
  return pdf.output("blob");
}
const isAndroidApp = () => /DocumentStudioAndroid\/1/.test(navigator.userAgent);
function nativeDocumentScan() {
  return new Promise((resolve, reject) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("documentstudio-scan-result", receive); };
    const receive = (event) => {
      if (event.detail?.id !== id) return;
      cleanup();
      if (event.detail.error === "cancelled") resolve(null);
      else if (event.detail.error) reject(new Error(event.detail.error));
      else resolve(event.detail.image);
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("Scanner বন্ধ করে আবার চেষ্টা করুন")); }, 600000);
    window.addEventListener("documentstudio-scan-result", receive);
    window.location.href = `documentstudio://scan?id=${encodeURIComponent(id)}`;
  });
}
function Capture({
  title,
  value,
  onChange,
  passport,
  signature,
  idDocument,
  onProcessed,
}) {
  const ref = useRef(),
    galleryRef = useRef(),
    liveVideoRef = useRef(),
    liveStreamRef = useRef(),
    liveDetectBusyRef = useRef(false),
    [busy, setBusy] = useState(false),
    [crop, setCrop] = useState(null),
    [passportReview, setPassportReview] = useState(null),
    [signatureReview, setSignatureReview] = useState(null),
    [cameraOpen, setCameraOpen] = useState(false),
    [cameraStatus, setCameraStatus] = useState("Camera চালু হচ্ছে…"),
    [livePoints, setLivePoints] = useState(null),
    [liveConfidence, setLiveConfidence] = useState(0);
  const autoDocument = idDocument || (!passport && !signature);
  async function openCapture() {
    if (passport) { ref.current?.click(); return; }
    setBusy(true);
    try {
      const scanned = await nativeDocumentScan();
      if (!scanned) return;
      if (signature) setSignatureReview(await signatureScan(scanned, "process"));
      else {
        // ML Kit has already cropped, enhanced and shown its confirmation screen.
        onChange(scanned);
        await onProcessed?.(scanned);
      }
    } catch (error) { alert(error.message || "Scan হয়নি"); }
    finally { setBusy(false); }
  }
  function frameFromVideo(maxWidth = 2200, quality = 0.92) {
    const video = liveVideoRef.current;
    if (!video?.videoWidth) return "";
    const scale = Math.min(1, maxWidth / video.videoWidth),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
  }
  function closeCamera() {
    liveStreamRef.current?.getTracks().forEach((track) => track.stop());
    liveStreamRef.current = null;
    setCameraOpen(false);
    setLivePoints(null);
    setLiveConfidence(0);
  }
  useEffect(() => {
    if (!cameraOpen) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraOpen(false);
      setTimeout(() => ref.current?.click(), 0);
      return;
    }
    let cancelled = false,
      timer;
    setCameraStatus("Camera চালু হচ্ছে…");
    navigator.mediaDevices
      ?.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      })
      .then(async (stream) => {
        if (cancelled) return stream.getTracks().forEach((track) => track.stop());
        liveStreamRef.current = stream;
        const video = liveVideoRef.current;
        video.srcObject = stream;
        await video.play();
        setCameraStatus(passport ? "মুখটি frame-এর মাঝে রাখুন" : "Document স্থির রাখুন");
        if (passport) return;
        const detect = async () => {
          if (cancelled || liveDetectBusyRef.current) return;
          const frame = frameFromVideo(720, 0.62);
          if (!frame) return;
          liveDetectBusyRef.current = true;
          try {
            const result = signature
              ? await signatureScan(frame, "detect")
              : await cardScan(frame, "detect", null, null, Boolean(idDocument));
            if (!cancelled) {
              setLivePoints(result.points);
              setLiveConfidence(result.confidence || 0);
              setCameraStatus(
                (signature ? "Signature" : idDocument ? "ID card" : "Document") +
                  " ready—Capture করুন",
              );
            }
          } catch {
            if (!cancelled) {
              setLivePoints(null);
              setLiveConfidence(0);
              setCameraStatus(signature ? "সাদা কাগজের স্বাক্ষরটি দেখান" : "চারটি corner frame-এর ভিতরে রাখুন");
            }
          } finally {
            liveDetectBusyRef.current = false;
          }
        };
        await detect();
        timer = setInterval(detect, 850);
      })
      .catch(() => {
        setCameraStatus("Camera permission পাওয়া যায়নি—Gallery ব্যবহার করুন");
      });
    return () => {
      cancelled = true;
      clearInterval(timer);
      liveStreamRef.current?.getTracks().forEach((track) => track.stop());
      liveStreamRef.current = null;
    };
  }, [cameraOpen, idDocument, passport, signature]);

  async function captureLive() {
    const fileData = frameFromVideo();
    if (!fileData) return alert("Camera প্রস্তুত হয়নি");
    const detectedPoints = livePoints;
    closeCamera();
    setBusy(true);
    try {
      if (passport) {
        setPassportReview(await makePassportPhoto(fileData));
        return;
      }
      if (signature) {
        setSignatureReview(await signatureScan(fileData, "process"));
        return;
      }
      let points = detectedPoints,
        confidence = liveConfidence;
      if (!points) {
        const detected = await cardScan(fileData, "detect", null, null, Boolean(idDocument));
        points = detected.points;
        confidence = detected.confidence;
      }
      setCrop({
        src: fileData,
        fileData,
        points,
        confidence,
        mode: "auto",
        fixedRatio: Boolean(idDocument),
        detecting: false,
      });
    } catch (error) {
      alert(error.message || "ছবি process করা যায়নি");
    } finally {
      setBusy(false);
    }
  }
  async function choose(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    const u = URL.createObjectURL(f);
    try {
      if (passport) {
        const result = await makePassportPhoto(await asDataUrl(f));
        setPassportReview(result);
        URL.revokeObjectURL(u);
        return;
      }
      if (signature) {
        setSignatureReview(await signatureScan(await asDataUrl(f), "process"));
        URL.revokeObjectURL(u);
        return;
      }
      if (autoDocument) {
        const immediatePoints = [
          { x: 0.04, y: 0.04 },
          { x: 0.96, y: 0.04 },
          { x: 0.96, y: 0.96 },
          { x: 0.04, y: 0.96 },
        ];
        setCrop({
          src: u,
          points: immediatePoints,
          mode: "auto",
          fixedRatio: Boolean(idDocument),
          detecting: true,
        });
        setBusy(false);
        e.target.value = "";
        asDataUrl(f)
          .then(async (fileData) => {
            setCrop((current) =>
              current?.src === u ? { ...current, fileData } : current,
            );
            return await cardScan(
              fileData,
              "detect",
              null,
              null,
              Boolean(idDocument),
            );
          })
          .then(({ points, confidence }) =>
            setCrop((current) =>
              current?.src === u && current.detecting
                ? { ...current, points, confidence, detecting: false }
                : current,
            ),
          )
          .catch(() =>
            setCrop((current) =>
              current?.src === u ? { ...current, detecting: false } : current,
            ),
          );
        return;
      }
      const result = await processImage(u, passport, signature, idDocument, null);
      onChange(result);
      await onProcessed?.(result);
      URL.revokeObjectURL(u);
    } catch (error) {
      URL.revokeObjectURL(u);
      alert(error.message || "ছবি process করা যায়নি");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }
  async function acceptCrop() {
    setBusy(true);
    try {
      if (!crop.fileData)
        throw new Error("Corner detection শেষ হওয়া পর্যন্ত অপেক্ষা করুন");
      const result = (
        await cardScan(
          crop.fileData,
          "process",
          crop.points,
          crop.mode,
          crop.fixedRatio,
        )
      ).image;
      onChange(result);
      await onProcessed?.(result);
      URL.revokeObjectURL(crop.src);
      setCrop(null);
    } catch (error) {
      alert(error.message || "ID card process করা যায়নি");
    } finally {
      setBusy(false);
    }
  }
  function moveCorner(index, event) {
    const rect = event.currentTarget.parentElement.getBoundingClientRect();
    const point = {
      x: Math.max(
        0.01,
        Math.min(0.99, (event.clientX - rect.left) / rect.width),
      ),
      y: Math.max(
        0.01,
        Math.min(0.99, (event.clientY - rect.top) / rect.height),
      ),
    };
    setCrop((current) => ({
      ...current,
      detecting: false,
      points: current.points.map((p, i) => (i === index ? point : p)),
    }));
  }
  return (
    <>
      {cameraOpen && (
        <div className="liveCameraModal" role="dialog" aria-modal="true">
          <div className="liveCameraStage">
            <video ref={liveVideoRef} playsInline muted />
            {!passport && livePoints && (
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon points={livePoints.map((p) => `${p.x * 100},${p.y * 100}`).join(" ")} />
              </svg>
            )}
            {passport && <span className="faceGuide" aria-hidden="true" />}
            <div className={`liveReady ${livePoints || passport ? "ready" : ""}`}>
              {livePoints || passport ? <Check size={16} /> : <ScanLine size={16} />}
              {cameraStatus}{liveConfidence ? ` • ${liveConfidence}%` : ""}
            </div>
            <button type="button" className="liveClose" onClick={closeCamera} aria-label="Camera বন্ধ করুন"><X /></button>
            <div className="liveCameraActions">
              <button type="button" className="liveGallery" onClick={() => { closeCamera(); galleryRef.current.click(); }}>
                <ImagePlus size={20} /> Gallery
              </button>
              <button type="button" className="shutter" onClick={captureLive} aria-label="ছবি তুলুন"><span /></button>
              <span className="liveHint">{livePoints || passport ? "Ready" : "Detecting…"}</span>
            </div>
          </div>
        </div>
      )}
      {signatureReview && (
        <div className="cropModal" role="dialog" aria-modal="true">
          <div className="cropSheet signatureReviewSheet">
            <div className="cropHeading">
              <div><h3>Signature PNG Preview</h3><p>Background সম্পূর্ণ transparent হয়েছে কি না দেখুন।</p></div>
              <span className="detectedBadge"><Check size={15} /> Ink detected</span>
            </div>
            <div className="signatureTransparentPreview"><img src={signatureReview.image} alt="Transparent signature preview" /></div>
            <div className="cropActions">
              <button type="button" className="ghost" onClick={() => setSignatureReview(null)}>আবার নিন</button>
              <button type="button" className="primary" onClick={async () => {
                onChange(signatureReview.image);
                await onProcessed?.(signatureReview.image);
                setSignatureReview(null);
              }}><Check size={17} /> Confirm ও Signature Add করুন</button>
            </div>
          </div>
        </div>
      )}
      {passportReview && (
        <div className="cropModal" role="dialog" aria-modal="true">
          <div className="cropSheet passportSheet">
            <div className="cropHeading">
              <div>
                <h3>Passport Photo Preview</h3>
                <p>Full AI remake • Natural smart look • Blue background • 35×45 ratio</p>
              </div>
              <span className="detectedBadge">
                <Check size={15} /> Full portrait remade
              </span>
            </div>
            <div className="passportResult">
              <img
                src={passportReview.image}
                alt="Processed passport preview"
              />
            </div>
            {passportReview.warning && (
              <p className="passportWarning">{passportReview.warning}</p>
            )}
            <div className="passportFacts">
              <span>✓ Background removed</span>
              <span>✓ Blue background</span>
              <span>✓ Face পরিষ্কার ও centered</span>
              <span>✓ Face, body ও framing AI remake</span>
            </div>
            <div className="cropActions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setPassportReview(null);
                  openCapture();
                }}
              >
                <RotateCcw size={16} /> আবার তুলুন
              </button>
              <button
                type="button"
                className="primary"
                onClick={async () => {
                  onChange(passportReview.image);
                  await onProcessed?.(passportReview.image);
                  setPassportReview(null);
                }}
              >
                <Check size={17} /> Confirm ও Photo Add করুন
              </button>
            </div>
          </div>
        </div>
      )}
      {crop && (
        <div className="cropModal" role="dialog" aria-modal="true">
          <div className="cropSheet">
            <div className="cropHeading">
              <div>
                <h3>{idDocument ? "ID card" : "Document"} review করুন</h3>
                <p>Corner ও mode ঠিক করে Confirm করুন।</p>
              </div>
              <span
                className={`detectedBadge ${crop.detecting ? "detecting" : ""}`}
              >
                {crop.detecting ? <ScanLine size={15} /> : <Check size={15} />}
                {crop.detecting
                  ? "Corner detecting…"
                  : `Auto detected${crop.confidence ? ` • ${crop.confidence}%` : ""}`}
              </span>
            </div>
            <div className="cropStage">
              <img
                className={`scanMode-${crop.mode}`}
                src={crop.src}
                alt="ID card crop review"
              />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                <polygon
                  points={crop.points
                    .map((p) => `${p.x * 100},${p.y * 100}`)
                    .join(" ")}
                />
              </svg>
              {crop.points.map((point, index) => (
                <button
                  key={index}
                  className="cropHandle"
                  style={{
                    left: `${point.x * 100}%`,
                    top: `${point.y * 100}%`,
                  }}
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId);
                    moveCorner(index, event);
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      moveCorner(index, event);
                  }}
                />
              ))}
            </div>
            <div className="scanModes" aria-label="Scan পরিষ্কার করার mode">
              {[
                ["original", "Original"],
                ["auto", "Auto"],
                ["lighten", "Lighten"],
                ["magic", "Magic Color"],
                ["gray", "Gray"],
                ["bw", "B&W"],
              ].map(([key, label]) => (
                <button
                  type="button"
                  key={key}
                  className={crop.mode === key ? "active" : ""}
                  onClick={() =>
                    setCrop((current) => ({ ...current, mode: key }))
                  }
                >
                  <span className={`modeThumb scanMode-${key}`} />
                  {label}
                </button>
              ))}
            </div>
            <div className="selectedMode">
              Selected mode:{" "}
              <b>
                {crop.mode === "bw"
                  ? "B&W"
                  : crop.mode === "magic"
                    ? "Magic Color"
                    : crop.mode[0].toUpperCase() + crop.mode.slice(1)}
              </b>
            </div>
            <div className="cropActions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  URL.revokeObjectURL(crop.src);
                  setCrop(null);
                }}
              >
                বাতিল
              </button>
              <button
                type="button"
                className="primary"
                onClick={acceptCrop}
                disabled={busy || crop.detecting}
              >
                <Check size={17} />{" "}
                {busy ? "Processing…" : "Confirm ও ID Add করুন"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div
        className={
          "capture " + (value ? "has " : "") + (signature ? "signature" : "")
        }
      >
        <input
          hidden
          ref={ref}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={choose}
        />
        <input
          hidden
          ref={galleryRef}
          type="file"
          accept="image/*"
          onChange={choose}
        />
        {value ? (
          <>
            <img src={value} />
            <button className="x" onClick={() => onChange(null)}>
              <X size={15} />
            </button>
            <div className="replaceActions">
              <button className="retake" onClick={openCapture}>
                <RotateCcw size={14} /> আবার তুলুন
              </button>
              <button
                className="galleryReplace"
                onClick={() => galleryRef.current.click()}
              >
                <ImagePlus size={14} /> Gallery
              </button>
            </div>
          </>
        ) : (
          <div className="captureChoices">
            <button
              className="captureButton"
              onClick={openCapture}
            >
              {idDocument && (
                <span className="idFrameGuide" aria-hidden="true" />
              )}
              {passport ? <UserRound /> : signature ? <ScanLine /> : <Camera />}
              <b>{busy ? "তৈরি হচ্ছে…" : title}</b>
              <small>
                {passport
                  ? "Passport crop • Blue background"
                  : signature
                    ? "শুধু স্বাক্ষরটি ফ্রেমের মাঝে রাখুন"
                    : autoDocument
                      ? "Auto-detect • crop • enhance"
                      : "Camera"}
              </small>
            </button>
            <button
              className="galleryButton"
              onClick={() => galleryRef.current.click()}
            >
              <ImagePlus size={18} /> Gallery থেকে নিন
            </button>
          </div>
        )}
      </div>
    </>
  );
}
function Person({
  p,
  change,
  remove,
  index,
  onApplicantOcr,
  showDetails = false,
}) {
  const identityDone =
      p.identityType === "birth" ? p.birthCertificate : p.idFront && p.idBack,
    done = p.name && identityDone && p.photo;
  async function readCard(img, key) {
    if (!img) return;
    if (key === "idFront") {
      change({
        ...p,
        idFront: img,
        ocrStatus: "Front প্রস্তুত—Back upload করলে একবারে Scan হবে",
      });
      return;
    }
    change({ ...p, [key]: img, ocrStatus: "OCR শুরু হচ্ছে…" });
    try {
      const result = await scanId([p.idFront, img], (n) =>
          change({ ...p, [key]: img, ocrStatus: `ID পড়া হচ্ছে ${n}%` }),
        ),
        next = {
          ...p,
          [key]: img,
          name: result.name || p.name,
          nameBn: result.nameBn || p.nameBn,
          fatherNameBn: result.fatherNameBn || p.fatherNameBn,
          motherNameBn: result.motherNameBn || p.motherNameBn,
          fatherNameEn: result.fatherNameEn || p.fatherNameEn,
          motherNameEn: result.motherNameEn || p.motherNameEn,
          nid: result.nid || p.nid,
          dob: result.dob || p.dob,
          addressBn: result.addressBn || p.addressBn,
          addressEn: result.addressEn || p.addressEn,
          ocrText: [p.ocrText, result.text].filter(Boolean).join("\n"),
          ocrStatus: "ID details পাওয়া গেছে",
        };
      change(next);
      if (index === 0) onApplicantOcr?.(next);
    } catch (e) {
      console.error(e);
      change({
        ...p,
        [key]: img,
        ocrStatus:
          e.message === "GOOGLE_KEY_MISSING"
            ? "Settings থেকে Gemini API key সেট করুন"
            : `AI scan হয়নি—${e.message || "আবার চেষ্টা করুন"}`,
      });
    }
  }
  return (
    <section className="card">
      <div className="title">
        <i>
          <UserRound />
        </i>
        <div>
          <small>{index ? "নমিনি" : "মূল ব্যক্তি"}</small>
          <h3>{p.name || p.nameBn || p.role}</h3>
        </div>
        {done && (
          <span className="done">
            <Check />
            সম্পূর্ণ
          </span>
        )}
        {index > 0 && (
          <button className="icon" onClick={remove}>
            <Trash2 />
          </button>
        )}
      </div>
      {index > 0 && (
        <>
          <h4>
            <ImagePlus /> Nominee Photo
          </h4>
          <Capture
            passport
            title="Nominee photo তুলুন"
            value={p.photo}
            onChange={(v) => change({ ...p, photo: v })}
          />
          <div className="identityChoice">
            <button
              type="button"
              className={p.identityType !== "birth" ? "active" : ""}
              onClick={() => change({ ...p, identityType: "nid" })}
            >
              NID / ID Card
            </button>
            <button
              type="button"
              className={p.identityType === "birth" ? "active" : ""}
              onClick={() => change({ ...p, identityType: "birth" })}
            >
              Birth Certificate
            </button>
          </div>
        </>
      )}
      {p.identityType === "birth" && index > 0 ? (
        <>
          <h4>
            <FilePlus2 /> Birth Certificate
          </h4>
          <Capture
            title="Birth Certificate-এর ছবি তুলুন"
            value={p.birthCertificate}
            onChange={(v) => change({ ...p, birthCertificate: v })}
          />
        </>
      ) : (
        <>
          <h4>
            <IdCard /> ID Card{" "}
            <small className="ocrBadge">
              Upload করলে details auto-scan হবে
            </small>
          </h4>
          <div className="grid">
            <Capture
              idDocument
              title="Front তুলুন"
              value={p.idFront}
              onChange={(v) => change({ ...p, idFront: v })}
              onProcessed={(v) => readCard(v, "idFront")}
            />
            <Capture
              idDocument
              title="Back তুলুন"
              value={p.idBack}
              onChange={(v) => change({ ...p, idBack: v })}
              onProcessed={(v) => readCard(v, "idBack")}
            />
          </div>
        </>
      )}
      {p.ocrStatus && (
        <p className="ocrStatus">
          <ScanLine />
          {p.ocrStatus}
        </p>
      )}
      {showDetails && (
        <>
          <div className="grid fields idFields">
            <label>
              <span>Name (English)</span>
              <input
                value={p.name}
                onChange={(e) =>
                  change({ ...p, name: e.target.value.toUpperCase() })
                }
                placeholder="Auto-filled English name"
              />
            </label>
            <label>
              <span>নাম (বাংলা)</span>
              <input
                value={p.nameBn}
                onChange={(e) => change({ ...p, nameBn: e.target.value })}
                placeholder="Auto-filled বাংলা নাম"
              />
            </label>
            <label>
              <span>NID / ID Number</span>
              <input
                value={p.nid}
                onChange={(e) => change({ ...p, nid: e.target.value })}
                placeholder="Auto-filled ID number"
              />
            </label>
            <label>
              <span>পিতার নাম</span>
              <input
                value={p.fatherNameBn}
                onChange={(e) => change({ ...p, fatherNameBn: e.target.value })}
                placeholder="ID থেকে auto-filled"
              />
            </label>
            <label>
              <span>মাতার নাম</span>
              <input
                value={p.motherNameBn}
                onChange={(e) => change({ ...p, motherNameBn: e.target.value })}
                placeholder="ID থেকে auto-filled"
              />
            </label>
            <label>
              <span>Father's Name (English)</span>
              <input
                value={p.fatherNameEn}
                onChange={(e) =>
                  change({ ...p, fatherNameEn: e.target.value.toUpperCase() })
                }
                placeholder="Auto-filled English father's name"
              />
            </label>
            <label>
              <span>Mother's Name (English)</span>
              <input
                value={p.motherNameEn}
                onChange={(e) =>
                  change({ ...p, motherNameEn: e.target.value.toUpperCase() })
                }
                placeholder="Auto-filled English mother's name"
              />
            </label>
            <label>
              <span>Date of Birth</span>
              <input
                value={p.dob}
                onChange={(e) => change({ ...p, dob: e.target.value })}
                placeholder="DD/MM/YYYY"
              />
            </label>
            <label>
              <span>ঠিকানা (বাংলা)</span>
              <textarea
                value={p.addressBn}
                onChange={(e) => change({ ...p, addressBn: e.target.value })}
              />
            </label>
            <label>
              <span>Address (English)</span>
              <textarea
                value={p.addressEn}
                onChange={(e) =>
                  change({ ...p, addressEn: e.target.value.toUpperCase() })
                }
              />
            </label>
          </div>
          <small className="autoFile">
            Auto file name: {personBase(p)}_
            {p.identityType === "birth"
              ? "Birth_Certificate.pdf"
              : "ID_Card.pdf"}
          </small>
        </>
      )}
      {index === 0 && (
        <>
          <h4>
            <ImagePlus /> Applicant Photo
          </h4>
          <Capture
            passport
            title="Applicant photo তুলুন"
            value={p.photo}
            onChange={(v) => change({ ...p, photo: v })}
          />
        </>
      )}
    </section>
  );
}
function PersonDetails({ p, change, index }) {
  const field = (key, value) =>
    change({
      ...p,
      [key]: ["name", "fatherNameEn", "motherNameEn", "addressEn"].includes(key)
        ? value.toUpperCase()
        : value,
    });
  return (
    <section className="card scannedDetailsCard">
      <div className="title">
        <i>
          <Pencil />
        </i>
        <div>
          <small>{index ? `NOMINEE ${index}` : "APPLICANT"}</small>
          <h3>{p.name || p.nameBn || "Scanned Details"}</h3>
        </div>
        <span className="editReady">
          <Check size={15} /> দেখা ও Edit করা যাবে
        </span>
      </div>
      <div className="grid fields idFields">
        {[
          ["name", "Name (English)", "input"],
          ["nameBn", "নাম (বাংলা)", "input"],
          [
            "nid",
            p.identityType === "birth"
              ? "Birth Registration Number"
              : "NID / ID Number",
            "input",
          ],
          ["dob", "Date of Birth", "input"],
          ["fatherNameEn", "Father's Name (English)", "input"],
          ["motherNameEn", "Mother's Name (English)", "input"],
          ["fatherNameBn", "পিতার নাম", "input"],
          ["motherNameBn", "মাতার নাম", "input"],
          ["profession", "পেশা / Profession (optional)", "input"],
          ["addressEn", "Address (English)", "textarea"],
          ["addressBn", "ঠিকানা (বাংলা)", "textarea"],
        ].map(([key, label, type]) => (
          <label key={key}>
            <span>{label}</span>
            {type === "textarea" ? (
              <textarea
                value={p[key] || ""}
                onChange={(e) => field(key, e.target.value)}
              />
            ) : (
              <input
                value={p[key] || ""}
                onChange={(e) => field(key, e.target.value)}
              />
            )}
          </label>
        ))}
      </div>
      <small className="autoFile">
        OCR scan-এর লেখা—প্রয়োজনে এখানে সংশোধন করুন • Submit-এর আগে Preview দেখুন
      </small>
    </section>
  );
}
function Extra({ d, change, remove }) {
  const k = kinds.find((x) => x.id === d.kind);
  const isSignature = d.kind === "signature",
    isSignedCard = d.kind === "signature_card";
  return (
    <section className="card">
      <div className="title">
        <i className="gold">
          <FilePlus2 />
        </i>
        <div>
          <small>
            {isSignature
              ? "স্বাক্ষর স্ক্যান"
              : isSignedCard
                ? "A4 SIGNATURE CARD"
                : "অতিরিক্ত ডকুমেন্ট"}
          </small>
          <h3>
            {isSignature
              ? "Signature Scanner"
              : isSignedCard
                ? "Signed Signature Card"
                : d.name || k.label}
          </h3>
        </div>
        <button className="icon" onClick={remove}>
          <Trash2 />
        </button>
      </div>
      {!isSignature && !isSignedCard && (
        <div className="grid fields">
          <label>
            <span>Document type</span>
            <select
              value={d.kind}
              onChange={(e) =>
                change({ ...d, kind: e.target.value, pages: [] })
              }
            >
              {kinds.map((x) => (
                <option value={x.id}>{x.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>File name</span>
            <input
              value={d.name}
              onChange={(e) => change({ ...d, name: e.target.value })}
              placeholder={k.label}
            />
          </label>
        </div>
      )}
      <p className="hint">
        {isSignature
          ? "স্বাক্ষরটি মাঝখানে রেখে ছবি তুলুন—background ছাড়া PNG save হবে"
          : isSignedCard
            ? "গ্রাহকের স্বাক্ষর করা সম্পূর্ণ A4 card scan/upload করুন—Preview-এ পুরো card দেখা যাবে"
            : `${k.hint} • শুধু PDF save হবে`}
      </p>
      <div className="grid">
        {Array.from({ length: k.sides }).map((_, i) => (
          <Capture
            key={i}
            title={
              k.sides === 2 ? (i ? "Back তুলুন" : "Front তুলুন") : "ছবি তুলুন"
            }
            value={d.pages[i]}
            signature={isSignature}
            onChange={(v) => {
              const pages = [...d.pages];
              pages[i] = v;
              change({ ...d, pages });
            }}
          />
        ))}
      </div>
    </section>
  );
}
function DeclarationForm({ value, change, applicant, signature }) {
  const [pdfPreview, setPdfPreview] = useState("");
  function detailsFromId() {
    const lines = String(applicant?.addressBn || "").split(/\n+/);
    const first = (lines[0] || "").split(",").map((v) => v.trim());
    const second = (lines[1] || "").split(",").map((v) => v.trim());
    change({
      ...value,
      customerName: applicant?.nameBn || applicant?.name || "",
      fatherName: applicant?.fatherNameBn || "",
      motherName: applicant?.motherNameBn || "",
      address: first[0] || "",
      postOffice: first.slice(1).join(", "),
      thana: second[0] || "",
      district: second[1] || second[0] || "",
      autofilled: true,
    });
  }
  useEffect(() => {
    if (applicant?.name && !value.autofilled) detailsFromId();
  }, [applicant?.name, applicant?.addressBn]);
  async function improve() {
    if (!value.rawDescription.trim()) return alert("Description লিখুন");
    change({ ...value, busy: true });
    try {
      const text = await polishDescription(value.rawDescription, {name: applicant?.nameBn||applicant?.name||value.customerName, profession: applicant?.profession||"", monthlyIncome:value.monthlyIncome||""});
      change({ ...value, polishedDescription: text, busy: false });
    } catch (error) {
      change({ ...value, busy: false });
      alert(error.message);
    }
  }
  useEffect(() => {
    if (!value.customerName) return setPdfPreview("");
    const timer = setTimeout(() => {
      declarationPdf(applicant, value, signature)
        .then(asDataUrl)
        .then(setPdfPreview)
        .catch(() => setPdfPreview(""));
    }, 650);
    return () => clearTimeout(timer);
  }, [applicant, value, signature]);
  return (
    <section className="card declarationCard">
      <div className="title">
        <i className="gold">
          <FilePlus2 />
        </i>
        <div>
          <small>প্রথম পৃষ্ঠা মাত্র</small>
          <h3>Income & Correction Declaration</h3>
        </div>
      </div>
      <p className="hint">
        মূল PDF-এর কোনো লেখা বা dot মুছবে না। নিচের প্রতিটি তথ্য review/edit করে
        তারপর Preview দেখুন।
      </p>
      <label>
        <span>Description</span>
        <textarea
          className="descriptionInput"
          value={value.rawDescription}
          onChange={(e) =>
            change({
              ...value,
              rawDescription: e.target.value,
              polishedDescription: "",
            })
          }
          placeholder="যেমন: আমি বিপুল মিয়া, সিটি ব্যাংকে চাকরি করি..."
        />
      </label>
      <button
        className="secondary aiPolish"
        onClick={improve}
        disabled={value.busy}
      >
        <ScanLine /> {value.busy ? "AI লিখছে…" : "AI দিয়ে সুন্দর বাংলায় সাজান"}
      </button>
      {value.polishedDescription && (
        <div className="polishedText">
          <small>PDF-এ এই লেখা বসবে</small>
          <textarea
            value={value.polishedDescription}
            onChange={(e) =>
              change({ ...value, polishedDescription: e.target.value })
            }
          />
        </div>
      )}
      <section className="liveDeclarationPdf">
        <div className="pdfPreviewHead">
          <h4>
            <Eye /> Income Declaration PDF Preview
          </h4>
          <small>{pdfPreview ? "Auto-updated" : "Details-এর অপেক্ষায়"}</small>
        </div>
        {pdfPreview ? (
          <>
            <PdfEmbed data={pdfPreview}>
              <a href={pdfPreview} target="_blank" rel="noreferrer">
                PDF খুলুন
              </a>
            </PdfEmbed>
            <PdfActions
              data={pdfPreview}
              filename="Income_Correction_Declaration.pdf"
            />
          </>
        ) : (
          <p className="empty">Applicant ID scan হলে PDF এখানে দেখা যাবে</p>
        )}
      </section>
      <div className="reviewHead declarationDetailsHead">
        <div>
          <small>PDF-এর নিচের Edit section</small>
          <h4>
            <Pencil /> Income Declaration Details
          </h4>
        </div>
        <button className="secondary" onClick={detailsFromId}>
          ID details আবার নিন
        </button>
      </div>
      <div className="grid fields">
        {[
          ["customerName", "গ্রাহকের নাম"],
          ["fatherName", "পিতার নাম"],
          ["motherName", "মাতার নাম"],
          ["address", "ঠিকানা / গ্রাম"],
          ["postOffice", "ডাকঘর ও পোস্টকোড"],
          ["thana", "উপজেলা / থানা"],
          ["district", "জেলা"],
        ].map(([key, label]) => (
          <label key={key}>
            <span>{label}</span>
            <input
              value={value[key] || ""}
              onChange={(e) => change({ ...value, [key]: e.target.value })}
              placeholder={`${label} review করুন`}
            />
          </label>
        ))}
        <label>
          <span>সম্ভাব্য মাসিক আয়</span>
          <input
            value={value.monthlyIncome}
            onChange={(e) =>
              change({ ...value, monthlyIncome: e.target.value })
            }
            placeholder="যেমন: ১৫,০০০"
          />
        </label>
        <label>
          <span>একাউন্ট নম্বর</span>
          <input
            value={value.accountNumber}
            onChange={(e) =>
              change({ ...value, accountNumber: e.target.value })
            }
            placeholder="Account number"
          />
        </label>
      </div>
      <div className="assetReview">
        <article>
          <span>গ্রাহকের Signature</span>
          {signature ? (
            <img src={signature} />
          ) : (
            <small className="warningText">Signature যোগ করুন</small>
          )}
        </article>
      </div>
    </section>
  );
}
function ApiSettings({ open, onClose }) {
  const [googleKey, setGoogleKey] = useState("");
  if (!open) return null;
  async function saveKey() {
    if (!googleKey.trim()) return alert("Gemini API key লিখুন");
    const response = await fetch("/api/settings/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: googleKey.trim() }),
    });
    if (!response.ok) return alert("API key server-এ save হয়নি");
    localStorage.removeItem("documentStudioGeminiKey");
    localStorage.removeItem("documentStudioGoogleVisionKey");
    localStorage.removeItem("documentStudioDeepSeekKey");
    localStorage.removeItem("documentStudioGroqKey");
    onClose();
  }
  async function removeKey() {
    await fetch("/api/settings/gemini", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: "" }),
    });
    localStorage.removeItem("documentStudioGroqKey");
    localStorage.removeItem("documentStudioDeepSeekKey");
    localStorage.removeItem("documentStudioGoogleVisionKey");
    localStorage.removeItem("documentStudioGeminiKey");
    setGoogleKey("");
  }
  return (
    <div className="modalBackdrop" onMouseDown={onClose}>
      <section
        className="settingsModal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modalClose" onClick={onClose} aria-label="Close">
          <X />
        </button>
        <span className="settingsIcon">
          <Settings />
        </span>
        <small>AI API SETTINGS</small>
        <h2>Google Gemini AI Scan</h2>
        <p>
          Front ও Back ছবি একসঙ্গে Gemini free API-তে scan হবে। Name, NID, DOB
          এবং বাংলা/English address auto-fill হবে।
        </p>
        <label>
          <span>Gemini API Key</span>
          <input
            type="password"
            value={googleKey}
            onChange={(e) => setGoogleKey(e.target.value)}
            placeholder="AIza••••••••••••••••"
          />
        </label>
        <div className="settingsActions">
          <button className="secondary" onClick={removeKey}>
            Key মুছুন
          </button>
          <button className="primary" onClick={saveKey}>
            Save Settings
          </button>
        </div>
        <small className="settingsNote">
          একবার Save করলে key এই server-এ থাকবে এবং ID scan, description ও
          passport remake—সব জায়গায় ব্যবহার হবে।
        </small>
      </section>
    </div>
  );
}
function RegistrationImage({ label, value, onChange }) {
  const ref = useRef(null);
  return <label className="registrationImage"><span>{label}</span><input ref={ref} hidden type="file" accept="image/*" capture="environment" onChange={async e=>{const file=e.target.files?.[0]; if(file) onChange(await asDataUrl(file)); e.target.value="";}} />
    <button type="button" className={value ? "hasImage" : ""} onClick={()=>ref.current?.click()}>{value ? <><img src={value} alt=""/><Check/> পরিবর্তন</> : <><Camera/> Camera / Gallery</>}</button></label>;
}
function Access({ setupRequired, onAccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("login");
  const [registration, setRegistration] = useState(()=>({fullName:"",nidNumber:"",phone:"",email:"",address:"",referralCode:new URLSearchParams(location.search).get("ref")?.toUpperCase()||"",nidFront:"",nidBack:"",selfie:""}));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const registering = !setupRequired && mode === "register";
      const response = await fetch(
        setupRequired ? "/api/auth/setup" : registering ? "/api/worker/register" : "/api/auth/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(registering ? {...registration,username,password} : { username, password }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      if (registering) { setMode("login"); setError(result.message); setPassword(""); }
      else onAccess(result);
    } catch (e) {
      setError(e.message || "Login হয়নি");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="accessPage">
      <form className="accessCard" onSubmit={submit}>
        <img className="cityLogo accessLogo" src="/city-bank-logo.png" alt="City Bank" />
        <small>CITY AGENT BANKING • SECURE ACCESS</small>
        <h1>{setupRequired ? "Admin Login তৈরি করুন" : mode === "register" ? "Worker Registration" : "স্বাগতম"}</h1>
        <p>
          {setupRequired
            ? "প্রথমবার ব্যবহারের জন্য নিজের username ও password দিন।"
            : mode === "register" ? "তথ্য ও পরিচয়পত্র জমা দিন। Admin approve করলে login করতে পারবেন।" : "নিজের username ও password দিয়ে Login করুন।"}
        </p>
        {!setupRequired && <div className="accessTabs"><button type="button" className={mode==="login"?"active":""} onClick={()=>{setMode("login");setError("")}}>Login</button><button type="button" className={mode==="register"?"active":""} onClick={()=>{setMode("register");setError("")}}>Worker Registration</button></div>}
        {mode === "register" && !setupRequired && <div className="registrationFields">
          {[["fullName","পূর্ণ নাম"],["nidNumber","NID number"],["phone","Mobile number"],["email","Email (optional)"],["address","বর্তমান ঠিকানা"],["referralCode","Referral code (required)"]].map(([key,label])=><label key={key}><span>{label}</span><input value={registration[key]} onChange={e=>setRegistration({...registration,[key]:key==="referralCode"?e.target.value.toUpperCase():e.target.value})} required={!["email","address"].includes(key)}/></label>)}
          <div className="registrationUploads"><RegistrationImage label="NID Front" value={registration.nidFront} onChange={v=>setRegistration({...registration,nidFront:v})}/><RegistrationImage label="NID Back" value={registration.nidBack} onChange={v=>setRegistration({...registration,nidBack:v})}/><RegistrationImage label="নিজের Selfie" value={registration.selfie} onChange={v=>setRegistration({...registration,selfie:v})}/></div>
        </div>}
        <label>
          <span>Username</span>
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength="3"
          />
        </label>
        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === "register" ? "8" : "6"}
          />
        </label>
        {error && <div className="formError">{error}</div>}
        <button className="primary full" disabled={busy}>
          {busy
            ? "অপেক্ষা করুন…"
            : setupRequired
              ? "Admin Account তৈরি করুন"
              : mode === "register" ? "Approval-এর জন্য Submit করুন" : "Login করুন"}
        </button>
        <a className="androidDownloadLink" href="/Document-Studio.apk" download>
          <Download size={17} /> Android App Download
        </a>
        <small className="accessNote">
          Registration ও customer document নিরাপদ server storage-এ থাকবে।
        </small>
      </form>
    </div>
  );
}

function Records({ onBack, onEditCase }) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  async function load(value = query) {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/customers?q=${encodeURIComponent(value)}`,
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setRows(result.customers);
    } catch (e) {
      alert(e.message || "Customer list পাওয়া যায়নি");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load("");
  }, []);
  async function saveEdit() {
    const response = await fetch(`/api/customers/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editing.name,
        nameBn: editing.name_bn,
        customerNumber: editing.customer_number,
        phone: editing.phone,
        email: editing.email,
      }),
    });
    const result = await response.json();
    if (!response.ok) return alert(result.error || "Edit save হয়নি");
    setEditing(null);
    load();
  }
  async function deleteRow(row) {
    if (
      !confirm(
        `${row.serial} — ${row.name}\n\nএই customer file স্থায়ীভাবে delete করবেন?`,
      )
    )
      return;
    const response = await fetch(`/api/customers/${row.id}`, {
      method: "DELETE",
    });
    const result = await response.json();
    if (!response.ok) return alert(result.error || "Delete হয়নি");
    load();
  }
  async function openCase(row) {
    const response = await fetch(`/api/customers/${row.id}/edit`);
    const result = await response.json();
    if (!response.ok)
      return alert(result.error || "File edit-এর জন্য খোলা যায়নি");
    onEditCase(result.case, row.id);
  }
  return (
    <div className="records">
      <div className="recordsHead">
        <button className="secondary" onClick={onBack}>
          <ChevronLeft /> ফিরে যান
        </button>
        <div>
          <small>SAVED CUSTOMER FILES</small>
          <h1>Customer Records</h1>
        </div>
      </div>
      <form
        className="searchBox"
        onSubmit={(e) => {
          e.preventDefault();
          load();
        }}
      >
        <Search />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="নাম, NID, phone, email বা serial দিয়ে খুঁজুন"
        />
        <button className="primary">Search</button>
      </form>
      <section className="recordsPanel">
        {loading ? (
          <p className="empty">তালিকা আসছে…</p>
        ) : rows.length ? (
          rows.map((row) => (
            <article className="recordRow" key={row.id}>
              <div className="serial">
                <Database />
                <b>{row.serial}</b>
              </div>
              <div className="recordName">
                <b>{row.name}</b>
                <small>{row.name_bn || "—"}</small>
              </div>
              <div>
                <small>NID / NUMBER</small>
                <b>{row.customer_number || "—"}</b>
              </div>
              <div>
                <small>PHONE</small>
                <b>{row.phone || "—"}</b>
              </div>
              <div>
                <small>SAVED</small>
                <b>{new Date(row.created_at).toLocaleDateString("en-GB")}</b>
              </div>
              <a
                className="recordDownload"
                href={`/api/customers/${row.id}/download`}
              >
                <Download /> Download
              </a>
              <button
                className="recordEdit"
                onClick={() => setEditing({ ...row })}
              >
                <Pencil /> Details Edit
              </button>
              <button className="recordEdit" onClick={() => openCase(row)}>
                <FilePlus2 /> File Edit
              </button>
              <button className="recordDelete" onClick={() => deleteRow(row)}>
                <Trash2 /> Delete
              </button>
            </article>
          ))
        ) : (
          <p className="empty">কোনো customer পাওয়া যায়নি</p>
        )}
      </section>
      {editing && (
        <div className="modalBackdrop" onMouseDown={() => setEditing(null)}>
          <section
            className="settingsModal recordEditor"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button className="modalClose" onClick={() => setEditing(null)}>
              <X />
            </button>
            <small>EDIT SAVED CUSTOMER</small>
            <h2>{editing.serial}</h2>
            {[
              ["name", "Name (English)"],
              ["name_bn", "নাম (বাংলা)"],
              ["customer_number", "NID / Customer number"],
              ["phone", "Phone"],
              ["email", "Email"],
            ].map(([key, label]) => (
              <label key={key}>
                <span>{label}</span>
                <input
                  value={editing[key] || ""}
                  onChange={(e) =>
                    setEditing({ ...editing, [key]: e.target.value })
                  }
                />
              </label>
            ))}
            <button className="primary full" onClick={saveEdit}>
              <Check /> পরিবর্তন Save করুন
            </button>
          </section>
        </div>
      )}
    </div>
  );
}

function PreviewImage({ src, label, portrait = false }) {
  const [expanded, setExpanded] = useState(false);
  if (!src) return null;
  return (
    <figure className={`fullImagePreview ${portrait ? "portraitPreview" : ""}`}>
      <figcaption>
        <span>{label}</span>
        <b>{dataSizeKb(src)} KB</b>
      </figcaption>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        title="Original size খুলুন"
        onClick={(event) => { if (isAndroidApp()) { event.preventDefault(); setExpanded(true); } }}
      >
        <img src={src} alt={label} />
      </a>
      <small>ছবিতে click করলে original size খুলবে</small>
      {expanded && <div className="cropModal" role="dialog" aria-modal="true" aria-label={label}>
        <div className="cropSheet">
          <button type="button" className="secondary" onClick={() => setExpanded(false)}>বন্ধ করুন</button>
          <div style={{ overflow: "auto", maxHeight: "75vh" }}><img src={src} alt={label} style={{ maxWidth: "none", width: "auto", height: "auto" }} /></div>
        </div>
      </div>}
    </figure>
  );
}
function PdfActions({ data, filename }) {
  if (!data) return null;
  const print = () => {
    if (isAndroidApp()) {
      alert("PDF Save করে ফোনের PDF viewer থেকে Print করুন।");
      window.location.href = `documentstudio://download?name=${encodeURIComponent(filename)}&data=${encodeURIComponent(data)}`;
      return;
    }
    const frame = document.createElement("iframe");
    frame.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0";
    frame.src = data;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1500);
    };
    document.body.appendChild(frame);
  };
  return (
    <div className="pdfActions">
      <a href={data} download={filename} className="secondary" onClick={(event) => {
        if (!isAndroidApp()) return;
        event.preventDefault();
        window.location.href = `documentstudio://download?name=${encodeURIComponent(filename)}&data=${encodeURIComponent(data)}`;
      }}>
        <Download size={17} /> PDF Download
      </a>
      <button type="button" className="secondary" onClick={print}>
        <Printer size={17} /> Print
      </button>
    </div>
  );
}

function PdfEmbed({ data, children }) {
  if (!isAndroidApp()) return <object data={data} type="application/pdf">{children}</object>;
  return <button type="button" className="secondary full" onClick={() => {
    window.location.href = `documentstudio://preview?data=${encodeURIComponent(data)}`;
  }}><Eye size={18} /> PDF Preview দেখুন</button>;
}

const money = paisa => `৳${((Number(paisa)||0)/100).toLocaleString("en-BD", {minimumFractionDigits:0,maximumFractionDigits:2})}`;
const statusLabel = {submitted:"জমা হয়েছে",resubmitted:"আবার জমা হয়েছে",correction_required:"সংশোধন প্রয়োজন",data_approved:"Data approved",bank_processing:"Bank processing",completed:"Account completed",rejected:"বাতিল",pending:"Approval অপেক্ষায়",approved:"Approved",suspended:"Locked"};
const isAdminRole = role => ["master_admin", "admin", "subadmin"].includes(role);

function AdminUserControl({ users, reload, master }) {
  const [form, setForm] = useState({ fullName: "", username: "", password: "", role: "worker" });
  const [tree, setTree] = useState([]);
  const [profile, setProfile] = useState(null);
  async function loadTree() { const response = await fetch("/api/admin/referrals"); const result = await readJson(response); if (response.ok) setTree(result.users || []); }
  useEffect(() => { loadTree().catch(() => {}); }, [users]);
  async function createUser(event) {
    event.preventDefault();
    const response = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await readJson(response);
    if (!response.ok) return alert(result.error);
    setForm({ fullName: "", username: "", password: "", role: "worker" }); reload(); alert("Account তৈরি হয়েছে");
  }
  async function openProfile(id) { const response = await fetch(`/api/admin/users/${id}/profile`); const result = await readJson(response); if (!response.ok) return alert(result.error); setProfile(result.profile); }
  async function adjustBalance() {
    const amount = prompt("Balance amount দিন; কমাতে negative amount দিন");
    if (amount === null || !amount) return;
    const reason = prompt("কারণ লিখুন");
    if (!reason) return;
    const response = await fetch(`/api/admin/users/${profile.id}/balance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ amount, reason }) });
    const result = await readJson(response);
    if (!response.ok) return alert(result.error);
    await openProfile(profile.id); alert("Balance update হয়েছে");
  }
  const byParent = parent => tree.filter(item => (item.referred_by || null) === parent);
  function Tree({ parent = null, level = 0 }) { return <div className="referralTreeLevel">{byParent(parent).map(item => <article key={item.id} style={{ marginLeft: level * 16 }}><div><b>{item.full_name}</b><small>@{item.username} • {item.role} • {item.referral_code}</small></div><button className="recordEdit" onClick={() => openProfile(item.id)}><UserRound size={14} /> Profile</button><Tree parent={item.id} level={level + 1} /></article>)}</div>; }
  return <>
    <div className="adminUserGrid">
      <form className="portalPanel adminCreateUser" onSubmit={createUser}><div className="panelTitle"><div><small>ACCOUNT CONTROL</small><h2>নতুন account তৈরি করুন</h2></div><ShieldCheck /></div><label><span>পূর্ণ নাম</span><input required value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} /></label><label><span>Username</span><input required value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label><label><span>Password</span><input required minLength="8" type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label><label><span>Account type</span><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}><option value="worker">Worker</option>{master && <option value="subadmin">Subadmin</option>}</select></label><button className="primary full"><Plus /> Account Save করুন</button></form>
      <section className="portalPanel adminReferralPanel"><div className="panelTitle"><div><small>REFERRAL NETWORK</small><h2>Referral Tree</h2></div><span className="codeBadge">MASTER: {"MASTER-BIPUL"}</span></div><p className="secureNotice">Master referral code: <b>MASTER-BIPUL</b></p><Tree /></section>
    </div>
    <section className="portalPanel"><div className="panelTitle"><div><small>ALL ACCOUNTS</small><h2>Worker ও Subadmin</h2></div></div><div className="portalTable">{users.map(item => <article key={item.id}><div><b>{item.full_name}</b><small>@{item.username} • {item.role}</small></div><div><b>{item.referral_code}</b><small>{item.phone || "Phone নেই"}</small></div><span className={`statusTag ${item.status}`}>{statusLabel[item.status] || item.status}</span><div className="rowActions"><button onClick={() => openProfile(item.id)}><UserRound /> Profile দেখুন</button></div></article>)}</div></section>
    {profile && <div className="modalBackdrop" onMouseDown={() => setProfile(null)}><section className="settingsModal adminProfileModal" onMouseDown={e => e.stopPropagation()}><button className="modalClose" onClick={() => setProfile(null)}><X /></button><small>USER PROFILE</small><h2>{profile.full_name}</h2><p>@{profile.username} • {profile.role} • {statusLabel[profile.status] || profile.status}</p><div className="profileFacts"><article><span>Referral code</span><b>{profile.referral_code || "—"}</b></article><article><span>Available balance</span><b>{money(profile.available)}</b></article><article><span>Total earned</span><b>{money(profile.earned)}</b></article><article><span>Reserved/withdraw</span><b>{money(profile.reserved)}</b></article></div><p><b>Phone:</b> {profile.phone || "—"}<br /><b>Email:</b> {profile.email || "—"}<br /><b>Address:</b> {profile.address || "—"}</p><h3>কাজের হিসাব</h3>{profile.customers.map(item => <p className="ledgerRow" key={item.id}><span>{item.serial} — {item.name}<small>{statusLabel[item.workflow_status] || item.workflow_status}</small></span></p>)}<button className="primary full" onClick={adjustBalance}><Wallet /> Balance Add / Minus</button></section></div>}
  </>;
}

function WorkerDetailsModal({ data, close, refresh }) {
  const [patch, setPatch] = useState({});
  const [busy, setBusy] = useState(false);
  const customer = data?.customer;
  if (!customer) return null;
  const request = customer.recollection;
  const labels = { idFront: "NID Front", idBack: "NID Back", photo: "Passport Photo", birthCertificate: "Birth Certificate", nid: "NID Number", name: "Name", nameBn: "নাম", dob: "Date of Birth", addressBn: "ঠিকানা", addressEn: "Address", rawDescription: "Income details", monthlyIncome: "Monthly income" };
  async function resubmit() {
    setBusy(true);
    try {
      const response = await fetch(`/api/worker/customers/${customer.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ patch }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      alert("Recollection আবার জমা হয়েছে"); close(); refresh();
    } catch (error) { alert(error.message); } finally { setBusy(false); }
  }
  return <div className="modalBackdrop" onMouseDown={close}><section className="settingsModal customerTextPreview" onMouseDown={(event) => event.stopPropagation()}><button className="modalClose" onClick={close}><X /></button><small>SECURE DETAILS PREVIEW</small><h2>{customer.serial} — {customer.name}</h2>{customer.people.map((personData, index) => <div className="textPerson" key={index}><h3>{index ? "Nominee" : "Applicant"}</h3>{Object.entries(personData).filter(([, value]) => value).map(([key, value]) => <p key={key}><span>{key}</span><b>{value}</b></p>)}</div>)}<div className="textPerson"><h3>Income Declaration</h3><p>{customer.declaration.polishedDescription || customer.declaration.rawDescription || "—"}</p><b>Monthly income: {customer.declaration.monthlyIncome || "—"}</b></div><p className="secureNotice"><LockKeyhole /> NID image, Passport photo এবং PDF নিরাপত্তার জন্য দেখানো হচ্ছে না।</p>{request && <section className="recollectionBox"><h3><RefreshCw /> Recollection প্রয়োজন</h3><p>{request.note}</p>{request.fields.map((field) => {
    const key = field.split(".").at(-1);
    const imageField = ["idFront", "idBack", "photo", "birthCertificate"].includes(key);
    if (imageField) return <RegistrationImage key={field} label={labels[key] || field} value={patch[field]} onChange={(value) => setPatch({ ...patch, [field]: value })} />;
    return <label key={field}><span>{labels[key] || field}</span><textarea value={patch[field] || ""} onChange={(event) => setPatch({ ...patch, [field]: event.target.value })} /></label>;
  })}<button className="primary full" disabled={busy || request.fields.some((field) => !patch[field])} onClick={resubmit}>{busy ? "জমা হচ্ছে…" : "চাওয়া তথ্য Resubmit করুন"}</button></section>}</section></div>;
}

function WorkerDashboard({ startNew }) {
  const [page,setPage]=useState("dashboard"),[sidebarCollapsed,setSidebarCollapsed]=useState(()=>window.innerWidth<=700),[data,setData]=useState(null),[rows,setRows]=useState([]),[ledger,setLedger]=useState({transactions:[],withdrawals:[]}),[withdrawForm,setWithdrawForm]=useState({amount:""}),[bankForm,setBankForm]=useState({accountName:"",accountNumber:"",branch:""}),[selected,setSelected]=useState(null),[profile,setProfile]=useState(null),[announcements,setAnnouncements]=useState([]),[showAnnouncement,setShowAnnouncement]=useState(true);
  const load=async()=>{const [a,b,c,d]=await Promise.all([fetch("/api/worker/dashboard"),fetch("/api/worker/customers"),fetch("/api/worker/transactions"),fetch("/api/worker/announcements")]);const [da,dbb,dc,dd]=await Promise.all([readJson(a),readJson(b),readJson(c),readJson(d)]);if(!a.ok)throw new Error(da.error);if(!b.ok)throw new Error(dbb.error);if(!c.ok)throw new Error(dc.error);setData(da);setRows(dbb.customers||[]);setLedger(dc);setAnnouncements(dd.announcements||[]);};
  const loadProfile=async()=>{const response=await fetch("/api/worker/profile"),result=await readJson(response);if(!response.ok)throw new Error(result.error);setProfile(result.profile);};
  useEffect(()=>{load().catch(e=>alert(e.message));},[]);
  useEffect(()=>{if(["profile","referrals","support","transactions"].includes(page)&&!profile)loadProfile().catch(e=>alert(e.message));},[page]);
  async function withdraw(){const response=await fetch("/api/worker/withdrawals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(withdrawForm)});const result=await readJson(response);if(!response.ok)return alert(result.error);setWithdrawForm({...withdrawForm,amount:""});await load();alert("Withdrawal request জমা হয়েছে");}
  async function saveBank(){if(!confirm("একবার Save করলে আপনি নিজে Bank account পরিবর্তন করতে পারবেন না। নিশ্চিত?"))return;const response=await fetch("/api/worker/bank-account",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(bankForm)}),result=await readJson(response);if(!response.ok)return alert(result.error);await loadProfile();alert("Bank account নিরাপদভাবে Save হয়েছে");}
  async function openCustomer(id){const response=await fetch("/api/worker/customers/"+id),result=await readJson(response);if(!response.ok)return alert(result.error);setSelected(result);}
  async function changePassword(){const oldPassword=prompt("বর্তমান password লিখুন");if(!oldPassword)return;const newPassword=prompt("নতুন password দিন—কমপক্ষে ৮ অক্ষর");if(!newPassword)return;const response=await fetch("/api/worker/password",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({oldPassword,newPassword})}),result=await readJson(response);alert(response.ok?"Password পরিবর্তন হয়েছে":result.error);}
  const referralLink=profile?`${location.origin}${location.pathname}?ref=${encodeURIComponent(profile.referralCode)}`:"";
  const copyReferral=async()=>{await navigator.clipboard.writeText(referralLink);alert("Referral link copy হয়েছে");};
  if(!data)return <div className="loadingPage">Dashboard আসছে…</div>;
  const workerMenu=[["dashboard",Home,"Dashboard",true],["customers",ListChecks,"Customers",true],["transactions",Wallet,"Transactions",true],["targets",Target,"Targets",false],["referrals",UsersRound,"Referrals",false],["profile",UserRound,"Profile",true]];
  return <div className={`portal workerPortal portalWithSidebar ${sidebarCollapsed?"sidebarCollapsed":""}`}><aside className="portalSidebar"><div className="sideBrand"><button aria-label="Sidebar hide or show" onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}>{sidebarCollapsed?<Menu/>:<PanelLeftClose/>}</button><div><b>Worker Portal</b><small>Amjhupi Agent Banking</small></div></div><nav>{workerMenu.map(([id,Icon,label,mobile])=><button key={id} className={`${page===id?"active":""} ${mobile?"mobilePrimary":"desktopOnlyNav"}`} onClick={()=>setPage(id)}><Icon/><span>{label}</span></button>)}</nav></aside><main className="portalContent"><header className="portalTopbar"><button className="mobileMenuButton" onClick={()=>setSidebarCollapsed(!sidebarCollapsed)}><Menu/></button><div><b>{workerMenu.find(item=>item[0]===page)?.[2]||"Worker Portal"}</b><small>Amjhupi Agent Banking</small></div><button className="noticeButton" onClick={()=>setPage("notifications")}><Bell/>{announcements.length>0&&<span>{announcements.length}</span>}</button></header>
    {page==="dashboard"&&<><div className="portalHero workerHero"><div><small>TEMPORARY WORKER</small><h1>আজকের কাজ এক নজরে</h1><p>Customer collection, correction এবং আপনার আয় সহজে দেখুন।</p></div><button className="primary" onClick={startNew}><Plus/> নতুন Customer</button></div><div className="metricGrid"><article><Database/><span>মোট জমা</span><b>{Object.values(data.counts||{}).reduce((a,b)=>a+b,0)}</b></article><article><RefreshCw/><span>Recollection</span><b>{data.counts.correction_required||0}</b></article><article><Wallet/><span>মোট আয়</span><b>{money(data.earned)}</b></article><article><ShieldCheck/><span>Available balance</span><b>{money(data.available)}</b></article></div>{data.notifications?.map(n=><div className="notification" key={n.id}><b>{n.title}</b><span>{n.message}</span></div>)}{data.targets?.length>0&&<section className="targetStrip"><Target/>{data.targets.map(t=><div key={t.id}><b>{t.name}</b><span>{Math.min(t.progress,t.required_count)}/{t.required_count} • Bonus {money(t.bonus_paisa)}</span><progress value={Math.min(t.progress,t.required_count)} max={t.required_count}/></div>)}</section>}<section className="quickActions"><button onClick={startNew}><Plus/><b>নতুন Customer</b><span>তথ্য সংগ্রহ শুরু করুন</span></button><button onClick={()=>setPage("customers")}><ListChecks/><b>Customer List</b><span>জমা ও correction দেখুন</span></button><button onClick={()=>setPage("transactions")}><Wallet/><b>Transactions</b><span>আয় ও withdrawal দেখুন</span></button></section></>}
    {page==="customers"&&<><div className="pageHeading"><div><small>MY COLLECTIONS</small><h1>Customer List</h1><p>আপনার জমা দেওয়া customer এবং বর্তমান status।</p></div><button className="primary" onClick={startNew}><Plus/> নতুন Customer</button></div><section className="portalPanel">{rows.length?<div className="portalTable">{rows.map(r=><article className="clickableRow" key={r.id} onClick={()=>openCustomer(r.id)}><div><b>{r.serial}</b><small>{new Date(r.createdAt).toLocaleDateString("en-GB")}</small></div><div><b>{r.name}</b><small>Nominee: {r.nominee||"—"}</small></div><div><b>{r.phone||"—"}</b><small>নিরাপত্তার জন্য masked</small></div><span className={`statusTag ${r.status}`}>{statusLabel[r.status]||r.status}</span>{r.correctionNote&&<p className="correctionNote">Admin note: {r.correctionNote}</p>}</article>)}</div>:<p className="empty">এখনো কোনো Customer জমা দেওয়া হয়নি</p>}</section></>}
    {page==="transactions"&&<><div className="pageHeading"><div><small>MONEY & REWARDS</small><h1>Transactions</h1><p>আপনার সব আয়, bonus ও withdrawal-এর হিসাব।</p></div></div><div className="metricGrid transactionMetrics"><article><Wallet/><span>Total Income</span><b>{money(data.earned)}</b></article><article><Download/><span>Total Withdraw</span><b>{money(data.withdrawn)}</b></article><article><ShieldCheck/><span>Balance</span><b>{money(data.available)}</b></article><article><Target/><span>Total Bonus</span><b>{money(data.bonus)}</b></article></div>{profile&&!profile.bankAccount.configured&&<section className="portalPanel bankSetup"><div className="panelTitle"><div><small>ONE-TIME SETUP</small><h2>City Bank Account যোগ করুন</h2></div><LockKeyhole/></div>{[["accountName","Account holder name"],["accountNumber","Account number"],["branch","Branch"]].map(([key,label])=><label key={key}><span>{label}</span><input value={bankForm[key]} onChange={e=>setBankForm({...bankForm,[key]:e.target.value})}/></label>)}<p className="secureNotice">Save করার পরে শুধু Admin account details পরিবর্তন করতে পারবেন।</p><button className="primary full" onClick={saveBank}>Confirm & Save Account</button></section>}{profile?.bankAccount.configured&&<section className="savedBank"><ShieldCheck/><div><small>SAVED CITY BANK ACCOUNT</small><h3>{profile.bankAccount.accountName}</h3><p>{profile.bankAccount.accountNumberMasked} • {profile.bankAccount.branch}</p></div><span>Locked</span></section>}<div className="portalColumns"><section className="portalPanel"><div className="panelTitle"><div><small>FULL LEDGER</small><h2>Transaction history</h2></div></div>{ledger.transactions.length?ledger.transactions.map(t=><p className="ledgerRow" key={t.id}><span>{t.reason}<small>{t.serial?`${t.serial} • ${t.customer_name} • `:""}{new Date(t.created_at).toLocaleDateString("en-GB")}</small></span><b>{t.amount_paisa>=0?"+":""}{money(t.amount_paisa)}</b></p>):<p className="empty">এখনো reward নেই</p>}{ledger.withdrawals.map(w=><p className="ledgerRow withdrawal" key={w.id}><span>Withdrawal #{w.id}<small>{w.status}</small></span><b>-{money(w.amount_paisa)}</b></p>)}</section><section className="portalPanel"><div className="panelTitle"><div><small>WITHDRAW</small><h2>টাকা তুলুন</h2></div></div><label><span>Amount (৳)</span><input inputMode="decimal" value={withdrawForm.amount} onChange={e=>setWithdrawForm({amount:e.target.value})}/></label><button className="primary full" disabled={!profile?.bankAccount.configured} onClick={withdraw}>Withdrawal Submit</button></section></div></>}
    {page==="profile"&&<><div className="pageHeading"><div><small>MY ACCOUNT</small><h1>Profile & Referral</h1><p>আপনার পরিচয়, unique code এবং referral income।</p></div></div><section className="profileOverview">{profile?<><div className="profileIdentity"><div className="profileAvatar">{profile.fullName?.[0]||"W"}</div><div><h2>{profile.fullName}</h2><p>@{profile.username}</p></div></div><div className="profileFacts"><article><span>NID Number</span><b>{profile.nidNumber||"যোগ করা হয়নি"}</b></article><article><span>Email ID</span><b>{profile.email||"যোগ করা হয়নি"}</b></article><article><span>Mobile</span><b>{profile.phone}</b></article><article><span>Unique Referral Code</span><b className="codeBadge">{profile.referralCode}</b></article></div><div className="referralLinkCard"><div><span>আপনার Referral Link</span><b>{referralLink}</b></div><button className="primary" onClick={copyReferral}>Link Copy</button></div><div className="referralSummary"><UsersRound/><div><span>Referral Worker</span><b>{profile.referrals.length}</b></div><div><span>Referral Income</span><b>{money(profile.referralIncome)}</b></div></div><section className="portalPanel referralList"><div className="panelTitle"><div><small>MY NETWORK</small><h2>আপনার Referral List</h2></div></div>{profile.referrals.length?profile.referrals.map(r=><article key={r.id}><div className="miniAvatar">{r.full_name?.[0]||"W"}</div><b>{r.full_name}</b><span>Income: <strong>{money(r.income_paisa)}</strong></span></article>):<p className="empty">এখনো আপনার referral-এ কেউ যোগ হয়নি</p>}</section><button className="secondary" onClick={changePassword}><LockKeyhole/> Password পরিবর্তন</button></>:<div className="loadingPage">Profile আসছে…</div>}</section></>}
    {page==="targets"&&<><div className="pageHeading"><div><small>PERFORMANCE</small><h1>My Targets</h1><p>Target পূরণ এবং bonus progress দেখুন।</p></div></div><section className="targetPage">{data.targets?.length?data.targets.map(t=><article key={t.id}><div><Target/><span>{t.metric==="completed"?"Account completion":"Data approval"}</span></div><h2>{t.name}</h2><p><b>{Math.min(t.progress,t.required_count)}</b> / {t.required_count} complete</p><progress value={Math.min(t.progress,t.required_count)} max={t.required_count}/><footer><span>{Math.max(0,t.required_count-t.progress)}টি বাকি</span><b>Bonus {money(t.bonus_paisa)}</b></footer></article>):<p className="empty portalPanel">বর্তমানে কোনো active target নেই</p>}</section></>}
    {page==="referrals"&&<><div className="pageHeading"><div><small>MY NETWORK</small><h1>Referrals</h1><p>আপনার referral link, Worker এবং commission।</p></div></div>{profile&&<><div className="referralLinkCard"><div><span>Referral link</span><b>{referralLink}</b></div><button className="primary" onClick={copyReferral}>Copy Link</button></div><div className="referralSummary"><UsersRound/><div><span>Total referrals</span><b>{profile.referrals.length}</b></div><div><span>Total commission</span><b>{money(profile.referralIncome)}</b></div></div><section className="portalPanel referralList">{profile.referrals.length?profile.referrals.map(r=><article key={r.id}><div className="miniAvatar">{r.full_name?.[0]||"W"}</div><b>{r.full_name}</b><span>{money(r.income_paisa)}</span></article>):<p className="empty">এখনো referral নেই</p>}</section></>}</>}
    {page==="notifications"&&<><div className="pageHeading"><div><small>UPDATES</small><h1>Notifications</h1><p>Admin-এর গুরুত্বপূর্ণ announcement ও update।</p></div></div><section className="announcementGrid">{announcements.length?announcements.map(a=><article key={a.id}>{a.image_data&&<img src={a.image_data} alt=""/>}<div><small>{new Date(a.created_at).toLocaleDateString("en-GB")}</small><h2>{a.title}</h2><p>{a.description}</p></div></article>):<p className="empty portalPanel">কোনো announcement নেই</p>}</section></>}
    {page==="support"&&<><div className="pageHeading"><div><small>HELP CENTER</small><h1>Customer Service</h1><p>কাজের প্রয়োজনে Admin support-এর সাথে যোগাযোগ করুন।</p></div></div><section className="supportCard"><MessageCircle/><h2>WhatsApp Support</h2><p>Application, payment বা account সংক্রান্ত সাহায্যের জন্য WhatsApp-এ যোগাযোগ করুন।</p>{profile?.supportWhatsApp?<a className="primary" href={`https://wa.me/${profile.supportWhatsApp}`} target="_blank" rel="noreferrer">WhatsApp Chat খুলুন</a>:<span>Admin এখনো WhatsApp number সেট করেননি</span>}</section></>}
    {page==="profile"&&profile&&<div className="profileSupport"><MessageCircle/><div><b>Customer Service</b><small>{profile.supportWhatsApp?"WhatsApp support available":"Admin এখনো number সেট করেননি"}</small></div>{profile.supportWhatsApp&&<a href={`https://wa.me/${profile.supportWhatsApp}`} target="_blank" rel="noreferrer">WhatsApp</a>}</div>}</main>{selected&&<WorkerDetailsModal data={selected} close={()=>setSelected(null)} refresh={load}/>} {showAnnouncement&&announcements[0]&&<div className="modalBackdrop"><section className="announcementModal">{announcements[0].image_data&&<img src={announcements[0].image_data} alt=""/>}<button className="modalClose" onClick={()=>setShowAnnouncement(false)}><X/></button><div><small>NEW ANNOUNCEMENT</small><h2>{announcements[0].title}</h2><p>{announcements[0].description}</p><button className="primary full" onClick={()=>{setShowAnnouncement(false);setPage("notifications")}}>বিস্তারিত দেখুন</button></div></section></div>}</div>;
}

function AdminCaseModal({ data, close, reload }) {
  const [caseData,setCaseData]=useState(data.customer.case),[fields,setFields]=useState([]),[saving,setSaving]=useState(false), c=data.customer;
  const options=[["people.0.idFront","Applicant NID Front"],["people.0.idBack","Applicant NID Back"],["people.0.photo","Applicant Photo"],["people.0.nid","Applicant NID Number"],["people.0.addressBn","Applicant Address"],["people.1.idFront","Nominee NID Front"],["people.1.idBack","Nominee NID Back"],["people.1.photo","Nominee Photo"],["people.1.birthCertificate","Nominee Birth Certificate"],["people.1.nid","Nominee ID Number"],["declaration.rawDescription","Income details"],["declaration.monthlyIncome","Monthly income"]];
  const updatePerson=(i,key,value)=>setCaseData({...caseData,people:caseData.people.map((p,n)=>n===i?{...p,[key]:value}:p)});
  async function saveEdit(){setSaving(true);try{const r=await fetch('/api/admin/customers/'+c.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({case:caseData})}),x=await r.json();if(!r.ok)throw new Error(x.error);alert('Details save হয়েছে');reload();}catch(e){alert(e.message)}finally{setSaving(false)}}
  async function recollect(){const note=prompt('Worker-কে কী আবার সংগ্রহ করতে হবে লিখুন');if(!note||!fields.length)return alert('Field নির্বাচন ও নির্দেশনা দিন');const r=await fetch('/api/admin/customers/'+c.id+'/review',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'correction',note,fields})}),x=await r.json();if(!r.ok)return alert(x.error);alert('Worker-এর কাছে Recollection পাঠানো হয়েছে');close();reload();}
  return <div className="modalBackdrop adminPreviewBackdrop" onMouseDown={close}><section className="adminCaseModal" onMouseDown={e=>e.stopPropagation()}><button className="modalClose" onClick={close}><X/></button><div className="adminCaseHead"><div><small>FULL APPLICATION REVIEW</small><h1>{c.serial} — {caseData.name}</h1><p><b>TW:</b> {c.worker_name||c.created_by} • {c.worker_phone||'—'} • {c.created_by}</p></div><span className={'statusTag '+c.workflow_status}>{statusLabel[c.workflow_status]||c.workflow_status}</span></div><div className="adminReviewGrid"><div>{(caseData.people||[]).map((p,i)=><section className="reviewPerson" key={p.id||i}><h2>{i?'Nominee':'Applicant'}</h2><div className="reviewFields">{[["name","Name"],["nameBn","নাম"],["nid","NID / ID"],["dob","DOB"],["fatherNameEn","Father"],["motherNameEn","Mother"],["addressEn","Address English"],["addressBn","ঠিকানা"],["profession","Profession"]].map(([key,label])=><label key={key}><span>{label}</span><input value={p[key]||''} onChange={e=>updatePerson(i,key,e.target.value)}/></label>)}</div><div className="adminImageGrid">{[[p.idFront,'NID Front'],[p.idBack,'NID Back'],[p.birthCertificate,'Birth Certificate'],[p.photo,'Passport Photo']].filter(([src])=>src).map(([src,label])=><PreviewImage key={label} src={src} label={label} portrait={label==='Passport Photo'}/>)}</div></section>)}<section className="reviewPerson"><h2>Income Declaration</h2><label><span>Worker description</span><textarea value={caseData.declaration?.rawDescription||''} onChange={e=>setCaseData({...caseData,declaration:{...caseData.declaration,rawDescription:e.target.value}})}/></label><label><span>সাজানো Description</span><textarea value={caseData.declaration?.polishedDescription||''} onChange={e=>setCaseData({...caseData,declaration:{...caseData.declaration,polishedDescription:e.target.value}})}/></label><label><span>Monthly income</span><input value={caseData.declaration?.monthlyIncome||''} onChange={e=>setCaseData({...caseData,declaration:{...caseData.declaration,monthlyIncome:e.target.value}})}/></label></section><section className="reviewPerson"><h2>Signature ও Additional Documents</h2><div className="adminImageGrid">{(caseData.docs||[]).flatMap(d=>(d.pages||[]).map((src,i)=><PreviewImage key={(d.id||d.name)+i} src={src} label={(d.name||d.kind)+' '+(i+1)}/>))}</div></section></div><aside className="recollectionSelector"><h3>Recollection নির্বাচন</h3><p>শুধু নির্বাচিত item Worker আবার খুলতে পারবে।</p>{options.map(([value,label])=><label key={value}><input type="checkbox" checked={fields.includes(value)} onChange={e=>setFields(e.target.checked?[...fields,value]:fields.filter(v=>v!==value))}/><span>{label}</span></label>)}<button className="secondary full" onClick={recollect}><RefreshCw/> Recollection পাঠান</button><button className="primary full" disabled={saving} onClick={saveEdit}><Check/> Admin Edit Save</button><a className="recordDownload" href={'/api/customers/'+c.id+'/download'}><Download/> Full ZIP Download</a></aside></div></section></div>;
}

function AdminPortal({ openRecords }) {
  const [tab,setTab]=useState('overview'),[adminCollapsed,setAdminCollapsed]=useState(()=>window.innerWidth<=700),[dashboard,setDashboard]=useState(null),[users,setUsers]=useState([]),[cases,setCases]=useState([]),[withdrawals,setWithdrawals]=useState([]),[targets,setTargets]=useState([]),[finance,setFinance]=useState({workers:[],transactions:[],settings:{}}),[announcements,setAnnouncements]=useState([]),[adminSettings,setAdminSettings]=useState({support_whatsapp:""}),[announcementForm,setAnnouncementForm]=useState({title:"",description:"",image:"",targetUserId:""}),[selectedCase,setSelectedCase]=useState(null),[selectedWorker,setSelectedWorker]=useState(null),[targetForm,setTargetForm]=useState({name:'',metric:'approved',requiredCount:'',bonus:'',startsAt:'',endsAt:'',userId:''});
  const load=async()=>{const responses=await Promise.all([fetch('/api/admin/dashboard'),fetch('/api/admin/users'),fetch('/api/customers'),fetch('/api/admin/withdrawals'),fetch('/api/admin/targets'),fetch('/api/admin/finance'),fetch('/api/admin/announcements'),fetch('/api/admin/settings')]);const values=await Promise.all(responses.map(readJson));const failed=responses.findIndex((response)=>!response.ok);if(failed>=0)throw new Error(values[failed].error||`HTTP ${responses[failed].status}`);const [da,dbb,dc,dd,de,df,dg,dh]=values;setDashboard(da);setUsers(dbb.users||[]);setCases(dc.customers||[]);setWithdrawals(dd.withdrawals||[]);setTargets(de.targets||[]);setFinance(df);setAnnouncements(dg.announcements||[]);setAdminSettings(dh.settings||{})};
  useEffect(()=>{load().catch(e=>alert(e.message));},[]);
  async function userStatus(id,status){const reason=status==='rejected'?prompt('বাতিলের কারণ লিখুন')||'':'';const r=await fetch(`/api/admin/users/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,reason})});const x=await r.json();if(!r.ok)return alert(x.error);load();}
  async function review(id,action){let accountNumber='',note='';if(action==='complete')accountNumber=prompt('City Bank account number লিখুন')||'';if(action==='correction'||action==='reject')note=prompt('Worker-এর জন্য কারণ/নির্দেশনা লিখুন')||'';const r=await fetch(`/api/admin/customers/${id}/review`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,accountNumber,note})});const x=await r.json();if(!r.ok)return alert(x.error);load();}
  async function bonus(id){const amount=prompt('Extra bonus amount (৳)');if(!amount)return;const reason=prompt('Bonus দেওয়ার কারণ');if(!reason)return;const r=await fetch(`/api/admin/customers/${id}/bonus`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,reason})});const x=await r.json();if(!r.ok)return alert(x.error);load();}
  async function withdrawal(id,status){const reference=status==='paid'?prompt('Payment reference / transaction ID')||'':'';const r=await fetch(`/api/admin/withdrawals/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status,reference})});const x=await r.json();if(!r.ok)return alert(x.error);load();}
  async function openCase(id){const r=await fetch('/api/admin/customers/'+id),x=await r.json();if(!r.ok)return alert(x.error);setSelectedCase(x);}
  async function openWorker(id){const r=await fetch('/api/admin/users/'+id+'/detail'),x=await r.json();if(!r.ok)return alert(x.error);setSelectedWorker(x.worker);}
  async function createTarget(){const r=await fetch('/api/admin/targets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(targetForm)}),x=await r.json();if(!r.ok)return alert(x.error);setTargetForm({name:'',metric:'approved',requiredCount:'',bonus:'',startsAt:'',endsAt:'',userId:''});load();}
  async function toggleTarget(id){await fetch('/api/admin/targets/'+id,{method:'PUT'});load();}
  async function adjust(worker){const amount=prompt(`${worker.full_name}-এর balance adjustment দিন। কমাতে negative amount দিন।`);if(!amount)return;const reason=prompt('Adjustment-এর কারণ লিখুন');if(!reason)return;const r=await fetch('/api/admin/finance/adjust',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId:worker.id,amount,reason})}),x=await r.json();if(!r.ok)return alert(x.error);load();}
  async function rewardSettings(){const collection=prompt('Data approve reward (৳)',Number(finance.settings.collection_reward_paisa||5000)/100);if(collection===null)return;const completion=prompt('Account complete reward (৳)',Number(finance.settings.completion_reward_paisa||5000)/100);if(completion===null)return;const referral=prompt('Referral commission (%)',finance.settings.referral_percent||10);if(referral===null)return;const r=await fetch('/api/admin/reward-settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({collectionReward:collection,completionReward:completion,referralPercent:referral})}),x=await r.json();if(!r.ok)return alert(x.error);load();}
  async function saveWorker(){const payload={fullName:selectedWorker.full_name,phone:selectedWorker.phone,email:selectedWorker.email,address:selectedWorker.address,nidNumber:selectedWorker.nid_number,accountName:selectedWorker.payout_account_name,accountNumber:selectedWorker.payout_account_number,branch:selectedWorker.payout_branch};const r=await fetch('/api/admin/users/'+selectedWorker.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),x=await readJson(r);if(!r.ok)return alert(x.error);alert('Worker profile ও bank details Save হয়েছে');setSelectedWorker(null);load();}
  async function createAnnouncement(){const r=await fetch('/api/admin/announcements',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(announcementForm)}),x=await readJson(r);if(!r.ok)return alert(x.error);setAnnouncementForm({title:"",description:"",image:"",targetUserId:""});load();}
  async function toggleAnnouncement(id){await fetch('/api/admin/announcements/'+id,{method:'PUT'});load();}
  async function saveSupport(){const r=await fetch('/api/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({supportWhatsApp:adminSettings.support_whatsapp})}),x=await readJson(r);alert(r.ok?'WhatsApp support Save হয়েছে':x.error);if(r.ok)load();}
  if(!dashboard)return <div className="loadingPage">Admin panel আসছে…</div>;
  if(tab==='users')return <div className="adminPortal usersOnly"><button className="secondary" onClick={()=>setTab('overview')}><ChevronLeft/> Admin Overview</button><AdminUserControl users={users} reload={load} master={true}/></div>;
  const adminMenu=[["overview",Home,"Overview"],["users",UsersRound,"Users"],["cases",Database,"Applications"],["finance",Wallet,"Finance"],["targets",Target,"Targets"],["payments",Download,"Withdrawals"],["announcements",Bell,"Announcements"],["settings",Settings,"Settings"]];
  return <div className={`portal adminPortal portalWithSidebar ${adminCollapsed?"sidebarCollapsed":""}`}><aside className="portalSidebar adminSidebar"><div className="sideBrand"><button aria-label="Sidebar hide or show" onClick={()=>setAdminCollapsed(!adminCollapsed)}>{adminCollapsed?<Menu/>:<PanelLeftClose/>}</button><div><b>Admin Portal</b><small>Control Center</small></div></div><nav>{adminMenu.map(([id,Icon,label])=><button key={id} className={tab===id?'active':''} onClick={()=>setTab(id)}><Icon/><span>{label}</span></button>)}</nav><button className="sideFiles" onClick={openRecords}><Database/> Customer Files</button></aside><main className="portalContent"><header className="portalTopbar"><button className="mobileMenuButton" onClick={()=>setAdminCollapsed(!adminCollapsed)}><Menu/></button><div><b>{adminMenu.find(item=>item[0]===tab)?.[2]}</b><small>Admin Control Center</small></div><button className="noticeButton" onClick={()=>setTab("announcements")}><Bell/>{announcements.filter(a=>a.active).length>0&&<span>{announcements.filter(a=>a.active).length}</span>}</button></header><div className="portalHero adminHero compactHero"><div><small>AMJHUPI CITY AGENT BANK</small><h1>{adminMenu.find(item=>item[0]===tab)?.[2]}</h1><p>সম্পূর্ণ control, review এবং management আপনার হাতে।</p></div></div>
    {tab==='overview'&&<><div className="metricGrid"><article><Clock3/><span>Worker approval অপেক্ষায়</span><b>{dashboard.users.pending||0}</b></article><article><Database/><span>নতুন Application</span><b>{dashboard.cases.submitted||0}</b></article><article><Check/><span>Account completed</span><b>{dashboard.cases.completed||0}</b></article><article><Wallet/><span>মোট Reward</span><b>{money(dashboard.totalRewards)}</b></article></div><section className="portalPanel"><h2>আজকের কাজ</h2><p className="empty">Pending worker approve করুন, submitted customer file যাচাই করুন, তারপর account complete হলে account number দিন।</p></section></>}
    {tab==='workers'&&<section className="portalPanel"><div className="panelTitle"><div><small>WORKER MANAGEMENT</small><h2>Registration ও Approval</h2></div></div><div className="portalTable">{users.map(u=><article key={u.id}><div><b>{u.full_name}</b><small>@{u.username}</small></div><div><b>{u.phone}</b><small>{u.email||'No email'}</small></div><div><b>{u.address||'—'}</b><small>Registration address</small></div><span className={`statusTag ${u.status}`}>{statusLabel[u.status]||u.status}</span><div className="rowActions"><button onClick={()=>openWorker(u.id)}>A–Z Preview</button>{u.status!=='approved'&&<button onClick={()=>userStatus(u.id,'approved')}>Approve</button>}{u.status!=='suspended'&&<button onClick={()=>userStatus(u.id,'suspended')}>Lock</button>}<button className="danger" onClick={()=>userStatus(u.id,'rejected')}>Reject</button></div></article>)}</div></section>}
    {tab==='cases'&&<section className="portalPanel"><div className="panelTitle"><div><small>APPLICATION REVIEW</small><h2>Customer submissions</h2></div></div><div className="portalTable applications">{cases.map(c=><article key={c.id}><div><b>{c.serial}</b><small>TW: {c.created_by}</small></div><div><b>{c.name}</b><small>{c.phone||'—'}</small></div><span className={`statusTag ${c.workflow_status}`}>{statusLabel[c.workflow_status]||c.workflow_status}</span><div className="rowActions"><button onClick={()=>openCase(c.id)}>A–Z Preview & Edit</button><button onClick={()=>review(c.id,'approve')}>Approve +৳50</button><button onClick={()=>review(c.id,'processing')}>Bank Processing</button><button onClick={()=>review(c.id,'complete')}>Complete +৳50</button><button onClick={()=>bonus(c.id)}>Bonus</button></div></article>)}</div></section>}
    {tab==='finance'&&<><section className="portalPanel"><div className="panelTitle"><div><small>REWARD CONTROL</small><h2>Income, Commission ও Balance</h2></div><button className="secondary" onClick={rewardSettings}><Settings/> Reward rates পরিবর্তন</button></div><div className="metricGrid financeRates"><article><Database/><span>Data approve reward</span><b>{money(finance.settings.collection_reward_paisa)}</b></article><article><Check/><span>Completion reward</span><b>{money(finance.settings.completion_reward_paisa)}</b></article><article><UsersRound/><span>Referral commission</span><b>{finance.settings.referral_percent||10}%</b></article><article><Wallet/><span>Total paid ledger</span><b>{money(dashboard.totalRewards)}</b></article></div><div className="financeWorkerTable">{finance.workers.map(w=><article key={w.id}><div><b>{w.full_name}</b><small>@{w.username} • {w.phone}</small></div><p><span>Total income</span><b>{money(w.total_income)}</b></p><p><span>Referral</span><b>{money(w.referral_income)}</b></p><p><span>Bonus</span><b>{money(w.bonus+w.target_bonus)}</b></p><p><span>Withdraw</span><b>{money(w.withdrawn)}</b></p><p><span>Balance</span><b>{money(w.balance)}</b></p><button onClick={()=>adjust(w)}>Add / Deduct</button></article>)}</div></section><section className="portalPanel"><div className="panelTitle"><div><small>ALL TRANSACTIONS</small><h2>সম্পূর্ণ Income Ledger</h2></div></div>{finance.transactions.map(t=><p className="ledgerRow" key={t.id}><span><b>{t.full_name}</b> — {t.reason}<small>{t.serial?`${t.serial} • ${t.customer_name}`:'General'} • {new Date(t.created_at).toLocaleDateString('en-GB')}</small></span><b>{t.amount_paisa>=0?'+':''}{money(t.amount_paisa)}</b></p>)}</section></>}
    {tab==='targets'&&<><section className="portalPanel targetForm"><div className="panelTitle"><div><small>AUTOMATIC BONUS</small><h2>নতুন Target তৈরি করুন</h2></div></div>{[["name","Target name"],["requiredCount","Required count"],["bonus","Bonus amount (৳)"],["startsAt","Start date/time"],["endsAt","End date/time"]].map(([key,label])=><label key={key}><span>{label}</span><input type={key.includes('At')?'datetime-local':'text'} value={targetForm[key]} onChange={e=>setTargetForm({...targetForm,[key]:e.target.value})}/></label>)}<label><span>Metric</span><select value={targetForm.metric} onChange={e=>setTargetForm({...targetForm,metric:e.target.value})}><option value="approved">Data approved</option><option value="completed">Account completed</option></select></label><label><span>Worker</span><select value={targetForm.userId} onChange={e=>setTargetForm({...targetForm,userId:e.target.value})}><option value="">সব Worker</option>{users.map(u=><option value={u.id}>{u.full_name}</option>)}</select></label><button className="primary" onClick={createTarget}>Target Save</button></section><section className="portalPanel">{targets.map(t=><p className="ledgerRow"><span><b>{t.name}</b><small>{t.metric} • {t.required_count}টি • {t.worker_name||'সব Worker'}</small></span><b>{money(t.bonus_paisa)} <button onClick={()=>toggleTarget(t.id)}>{t.active?'Active':'Inactive'}</button></b></p>)}</section></>}
    {tab==='payments'&&<section className="portalPanel"><div className="panelTitle"><div><small>WITHDRAWAL CONTROL</small><h2>Worker payout requests</h2></div></div><div className="portalTable">{withdrawals.map(w=><article key={w.id}><div><b>{w.full_name}</b><small>{w.phone} • @{w.username}</small></div><div><b>{money(w.amount_paisa)}</b><small>{w.account_number} • {w.branch}</small></div><span className={`statusTag ${w.status}`}>{w.status}</span><div className="rowActions">{w.status==='requested'&&<button onClick={()=>withdrawal(w.id,'approved')}>Approve</button>}{!['paid','rejected'].includes(w.status)&&<><button onClick={()=>withdrawal(w.id,'paid')}>Paid</button><button className="danger" onClick={()=>withdrawal(w.id,'rejected')}>Reject</button></>}</div></article>)}</div></section>}
    {tab==='announcements'&&<><section className="portalPanel announcementComposer"><div className="panelTitle"><div><small>APP OPEN NOTICE</small><h2>Notification তৈরি করুন</h2></div></div><label><span>Title</span><input value={announcementForm.title} onChange={e=>setAnnouncementForm({...announcementForm,title:e.target.value})}/></label><label><span>Description</span><textarea value={announcementForm.description} onChange={e=>setAnnouncementForm({...announcementForm,description:e.target.value})}/></label><label><span>কাদের জন্য</span><select value={announcementForm.targetUserId} onChange={e=>setAnnouncementForm({...announcementForm,targetUserId:e.target.value})}><option value="">সব Worker</option>{users.map(u=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select></label><RegistrationImage label="Optional banner image" value={announcementForm.image} onChange={image=>setAnnouncementForm({...announcementForm,image})}/><button className="primary" onClick={createAnnouncement}><Bell/> Publish Notification</button></section><section className="announcementAdminList">{announcements.map(a=><article key={a.id}>{a.image_data&&<img src={a.image_data} alt=""/>}<div><small>{a.target_name||'সব Worker'} • {new Date(a.created_at).toLocaleDateString('en-GB')}</small><h3>{a.title}</h3><p>{a.description}</p></div><button onClick={()=>toggleAnnouncement(a.id)}>{a.active?'Active':'Inactive'}</button></article>)}</section></>}
    {tab==='settings'&&<><section className="portalPanel settingsPage"><div className="panelTitle"><div><small>SUPPORT CHANNEL</small><h2>Customer Service WhatsApp</h2></div></div><label><span>WhatsApp number (country code সহ)</span><input value={adminSettings.support_whatsapp||''} onChange={e=>setAdminSettings({...adminSettings,support_whatsapp:e.target.value})} placeholder="8801XXXXXXXXX"/></label><button className="primary" onClick={saveSupport}><MessageCircle/> Save Support Number</button></section><section className="portalPanel"><h2>System Control</h2><p className="empty">Reward rates Finance page থেকে এবং Worker bank information Worker profile থেকে পরিবর্তন করুন। প্রতিটি পরিবর্তন activity log-এ সংরক্ষিত হয়।</p></section></>}
    </main>{selectedCase&&<AdminCaseModal data={selectedCase} close={()=>setSelectedCase(null)} reload={load}/>} {selectedWorker&&<div className="modalBackdrop" onMouseDown={()=>setSelectedWorker(null)}><section className="settingsModal workerFullPreview" onMouseDown={e=>e.stopPropagation()}><button className="modalClose" onClick={()=>setSelectedWorker(null)}><X/></button><small>WORKER FULL CONTROL</small><h2>{selectedWorker.full_name}</h2><div className="adminWorkerForm">{[["full_name","Full name"],["nid_number","NID number"],["phone","Mobile"],["email","Email"],["address","Address"],["payout_account_name","Bank account name"],["payout_account_number","Bank account number"],["payout_branch","Branch"]].map(([key,label])=><label key={key}><span>{label}</span><input value={selectedWorker[key]||''} onChange={e=>setSelectedWorker({...selectedWorker,[key]:e.target.value})}/></label>)}</div><div className="adminImageGrid">{Object.entries(selectedWorker.images||{}).map(([key,src])=><PreviewImage key={key} src={src} label={key}/>)}</div><button className="primary full" onClick={saveWorker}><Check/> সব পরিবর্তন Save করুন</button></section></div>}</div>;
}

function WorkerFinalPreview({ name,details,people,declaration,onBack,onSave,saving }) {
  return <div className="preview workerFinalPreview"><div className="previewTop"><button className="secondary" onClick={onBack}><ChevronLeft/> Edit করুন</button><div><small>SUBMIT PREVIEW • DETAILS ONLY</small><h1>{name}</h1></div></div><section className="previewPanel"><div className="previewDetails"><h3>Contact details</h3><dl><div><dt>Phone</dt><dd>{details.phone||"—"}</dd></div><div><dt>Email</dt><dd>{details.email||"—"}</dd></div></dl></div>{people.map((p,i)=><article className="workerPreviewPerson" key={p.id}><span>{i?"NOMINEE":"APPLICANT"}</span><h2>{p.name||p.nameBn}</h2><dl>{[["NID / ID",p.nid],["Date of Birth",p.dob],["Father",p.fatherNameEn||p.fatherNameBn],["Mother",p.motherNameEn||p.motherNameBn],["Address",p.addressEn||p.addressBn],["Profession",p.profession]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v||"—"}</dd></div>)}</dl></article>)}<section className="languageDetails"><h3>Income Declaration</h3><p>{declaration.polishedDescription||declaration.rawDescription||"—"}</p><b>Monthly income: {declaration.monthlyIncome||"—"}</b></section><p className="secureNotice"><LockKeyhole/> ID images, passport photos ও PDF এই Preview-এ দেখানো হবে না এবং Submit-এর পরে Worker খুলতে পারবে না।</p><button className="primary downloadFinal" onClick={onSave} disabled={saving}><Database/>{saving?"Submit হচ্ছে…":"Customer Data Submit করুন"}</button></section></div>;
}

function App() {
  const [auth, setAuth] = useState(null),
    [step, setStep] = useState(1),
    [name, setName] = useState(""),
    [details, setDetails] = useState({
      customerId: "",
      nameBn: "",
      email: "",
      phone: "",
      addressBn: "",
      addressEn: "",
    }),
    [people, setPeople] = useState([person()]),
    [docs, setDocs] = useState([]),
    [photoPrintLayout, setPhotoPrintLayout] = useState({width:35,height:45,positions:{}}),
    [photoPrintPreview, setPhotoPrintPreview] = useState(""),
    [declaration, setDeclaration] = useState({
      customerName: "",
      fatherName: "",
      motherName: "",
      address: "",
      postOffice: "",
      thana: "",
      district: "",
      rawDescription: "",
      polishedDescription: "",
      monthlyIncome: "",
      accountNumber: "",
      busy: false,
    }),
    [editingCustomerId, setEditingCustomerId] = useState(null),
    [declarationJpg, setDeclarationJpg] = useState(""),
    [declarationPdfPreview, setDeclarationPdfPreview] = useState(""),
    [idPdfPreviews, setIdPdfPreviews] = useState({}),
    [saving, setSaving] = useState(false),
    [savedSerial, setSavedSerial] = useState(""),
    [savedCustomerId, setSavedCustomerId] = useState(null),
    [customerConsent, setCustomerConsent] = useState(false),
    [draftSavedAt, setDraftSavedAt] = useState(""),
    [showSettings, setShowSettings] = useState(false);
  const draftLoaded = useRef(false);
  useEffect(() => { setPhotoPrintPreview(""); }, [people]);
  useEffect(() => {
    fetch("/api/auth/status")
      .then((response) => response.json())
      .then(setAuth)
      .catch(() => setAuth({ setupRequired: false, authenticated: false }));
  }, []);
  useEffect(() => {
    if (!auth?.authenticated) return;
    fetch("/api/settings/gemini")
      .then((response) => response.json())
      .then((result) => {
        if (!result.configured) setShowSettings(true);
      });
  }, [auth?.authenticated]);
  useEffect(() => {
    if (!auth?.authenticated || draftLoaded.current || true) return;
    draftLoaded.current = true;
    try {
      const draft = JSON.parse(
        localStorage.getItem("documentStudioDraft") || "null",
      );
      if (draft?.savedAt && Date.now() - draft.savedAt < 7 * 86400000) {
        setName(draft.name || "");
        setDetails(draft.details || details);
        setPeople(
          (draft.people || [person()]).map((p) => ({
            ...person(p.role),
            ...p,
          })),
        );
        setDocs(draft.docs || []);
        setPhotoPrintLayout(draft.photoPrintLayout || {width:35,height:45,positions:{}});
        setDeclaration((current) => ({
          ...current,
          ...(draft.declaration || {}),
        }));
        setEditingCustomerId(draft.editingCustomerId || null);
        setDraftSavedAt("Draft restored");
        setStep(2);
      }
    } catch {}
  }, [auth?.authenticated]);
  useEffect(() => {
    if (!auth?.authenticated || step < 2 || step > 3 || true) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          "documentStudioDraft",
          JSON.stringify({
            name,
            details,
            people,
            docs,
            declaration,
            photoPrintLayout,
            editingCustomerId,
            savedAt: Date.now(),
          }),
        );
        setDraftSavedAt("Draft auto-saved");
      } catch {
        setDraftSavedAt("Draft বড় হওয়ায় শুধু বর্তমান screen-এ আছে");
      }
    }, 700);
    return () => clearTimeout(timer);
  }, [
    auth?.authenticated,
    step,
    name,
    details,
    people,
    docs,
    declaration,
    photoPrintLayout,
    editingCustomerId,
  ]);
  useEffect(() => {
    if (auth?.authenticated && auth.role === "worker") setStep(0);
  }, [auth?.authenticated, auth?.role]);
  const progress = useMemo(() => {
    let total =
        people.length * 4 +
        docs.reduce(
          (a, d) => a + (kinds.find((k) => k.id === d.kind)?.sides || 1),
          0,
        ),
      done =
        people.reduce((a, p) => {
          const identity =
            p.identityType === "birth"
              ? [p.birthCertificate, p.birthCertificate]
              : [p.idFront, p.idBack];
          return a + [p.name, ...identity, p.photo].filter(Boolean).length;
        }, 0) + docs.reduce((a, d) => a + d.pages.filter(Boolean).length, 0);
    return total ? Math.round((done / total) * 100) : 0;
  }, [people, docs]);
  const change = (p) => setPeople((v) => v.map((x) => (x.id === p.id ? p : x))),
    changeDoc = (d) => setDocs((v) => v.map((x) => (x.id === d.id ? d : x))),
    detail = (key, value) => setDetails((v) => ({ ...v, [key]: value })),
    syncApplicant = (p) => {
      if (p.name) setName(p.name);
      setDetails((v) => ({
        ...v,
        customerId: p.nid || v.customerId,
        nameBn: p.nameBn || v.nameBn,
        addressBn: p.addressBn || v.addressBn,
        addressEn: p.addressEn || v.addressEn,
      }));
    };
  async function openPreview() {
    if (auth?.role === "worker") { setStep(3); return; }
    try {
      const previews = await Promise.all(
        people.map(async (p) => [
          p.id,
          identityPdf(p) ? await asDataUrl(identityPdf(p)) : "",
        ]),
      );
      setIdPdfPreviews(Object.fromEntries(previews));
      if (declaration.customerName) {
        const signature = docs.find((d) => d.kind === "signature")?.pages?.[0],
          canvas = await declarationCanvas(people[0], declaration, signature);
        setDeclarationJpg(await jpegInTargetRange(canvas));
        setDeclarationPdfPreview(
          await asDataUrl(
            await declarationPdf(people[0], declaration, signature),
          ),
        );
      } else {
        setDeclarationJpg("");
        setDeclarationPdfPreview("");
      }
      setStep(3);
    } catch (error) {
      alert(error.message || "Preview তৈরি হয়নি");
    }
  }
  async function save() {
    if (!name.trim()) return alert("Customer/Case-এর নাম লিখুন");
    setSaving(true);
    try {
      const applicant = people[0],
        caseData = { name, details, people, docs, declaration, photoPrintLayout, customerConsent },
        archive = await customerZip(caseData);
      const response = await fetch(
        editingCustomerId
          ? `/api/customers/${editingCustomerId}`
          : "/api/customers",
        {
          method: editingCustomerId ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            nameBn: details.nameBn,
            customerNumber: details.customerId || applicant?.nid || "",
            phone: details.phone,
            email: details.email,
            archive: await asDataUrl(archive),
            case: caseData,
          }),
        },
      );
      const saved = await response.json();
      if (!response.ok) throw new Error(saved.error || "Server-এ save হয়নি");
      setSavedSerial(saved.serial);
      setSavedCustomerId(saved.id || editingCustomerId);
      setEditingCustomerId(saved.id || editingCustomerId);
      localStorage.removeItem("documentStudioDraft");
      setStep(4);
    } catch (e) {
      console.error(e);
      alert(e.message || "File তৈরি হয়নি, আবার চেষ্টা করুন");
    } finally {
      setSaving(false);
    }
  }
  function downloadSaved() {
    if (!savedCustomerId) return alert("আগে customer file Save করুন");
    const a = document.createElement("a");
    a.href = `/api/customers/${savedCustomerId}/download`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  if (!auth)
    return <div className="loadingPage">Document Studio চালু হচ্ছে…</div>;
  if (!auth.authenticated)
    return (
      <Access
        setupRequired={auth.setupRequired}
        onAccess={(result) => {
          setAuth({ setupRequired: false, ...result });
          setStep(isAdminRole(result.role) ? 6 : 0);
        }}
      />
    );
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuth({ setupRequired: false, authenticated: false, username: "" });
  }
  function editSavedCase(caseData, customerId) {
    setName(caseData.name || "");
    setDetails(caseData.details || details);
    setPeople(
      (caseData.people || [person()]).map((p) => ({
        ...person(p.role),
        ...p,
        id: p.id || uid(),
      })),
    );
    setDocs((caseData.docs || []).map((d) => ({ ...d, id: d.id || uid() })));
    setPhotoPrintLayout(caseData.photoPrintLayout || {width:35,height:45,positions:{}});
    setPhotoPrintPreview("");
    setDeclaration((current) => ({
      ...current,
      ...(caseData.declaration || {}),
      busy: false,
    }));
    setEditingCustomerId(customerId);
    setStep(2);
  }
  return (
    <>
      <header>
        <div className="brand">
          <img className="cityLogo" src="/city-bank-logo.png" alt="City Bank" />
          <div>
            <b>Amjhupi Agent Banking</b>
            <small>DOCUMENT COLLECTION SYSTEM</small>
          </div>
        </div>
        <div className="headerActions">
          {isAdminRole(auth.role) && <button className="settingsButton" onClick={() => setStep(6)}>
            <ShieldCheck /> Admin
          </button>}
          {isAdminRole(auth.role) && <button className="settingsButton" onClick={() => setStep(5)}>
            <Database /> Records
          </button>}
          {auth.role === "worker" && <button className="settingsButton" onClick={() => setStep(0)}><Database /> Dashboard</button>}
          {isAdminRole(auth.role) && <button
            className="settingsButton"
            onClick={() => setShowSettings(true)}
          >
            <Settings /> AI Settings
            <i
              className={
                localStorage.getItem("documentStudioGeminiKey") ||
                localStorage.getItem("documentStudioGoogleVisionKey")
                  ? "connected"
                  : ""
              }
            />
          </button>}
          <button
            className="logoutButton"
            onClick={logout}
            title={`${auth.username} — Logout`}
          >
            <LogOut />
          </button>
        </div>
      </header>
      {isAdminRole(auth.role) && <ApiSettings open={showSettings} onClose={() => setShowSettings(false)} />}
      <main>
        {step === 0 ? (
          <WorkerDashboard startNew={() => setStep(1)} />
        ) : step === 6 ? (
          <AdminPortal openRecords={() => setStep(5)} />
        ) : step === 5 ? (
          <Records onBack={() => setStep(1)} onEditCase={editSavedCase} />
        ) : step === 1 ? (
          <div className="welcome">
            <span className="pill">নতুন ডকুমেন্ট কেস</span>
            <h1>
              ছবি তুলুন।<em>বাকি কাজ অটোমেটিক।</em>
            </h1>
            <p>
              ID card, nominee, additional document এবং blue-background passport
              photo—সব একটি গোছানো folder-এ।
            </p>
            <button className="primary" onClick={() => setStep(2)}>
              Applicant ID Scan করুন <ScanLine />
            </button>
            <div className="features">
              <span>
                <IdCard />
                Front + Back PDF
              </span>
              <span>
                <UsersRound />
                একাধিক Nominee
              </span>
              <span>
                <ImagePlus />
                Passport Photo
              </span>
            </div>
          </div>
        ) : step === 2 ? (
          <>
            <div className="workhead">
              <button onClick={() => setStep(1)}>
                <ChevronLeft /> ফিরে যান
              </button>
              <div>
                <small>চলমান কেস</small>
                <h1>{name || "Applicant ID Scan করুন"}</h1>
              </div>
              <b>{progress}% সম্পন্ন</b>
            </div>
            <div className="layout">
              <div className="stack">
                <section className="card details">
                  <div className="title">
                    <i>
                      <UserRound />
                    </i>
                    <div>
                      <small>Contact information</small>
                      <h3>Phone ও Email</h3>
                    </div>
                  </div>
                  <div className="grid fields">
                    <label>
                      <span>Email / Gmail</span>
                      <input
                        type="email"
                        value={details.email}
                        onChange={(e) => detail("email", e.target.value)}
                        placeholder="name@gmail.com"
                      />
                    </label>
                    <label>
                      <span>Phone</span>
                      <input
                        value={details.phone}
                        onChange={(e) => detail("phone", e.target.value)}
                        placeholder="01XXXXXXXXX"
                      />
                    </label>
                  </div>
                </section>
                {people.map((p, i) => (
                  <Person
                    key={p.id}
                    p={p}
                    index={i}
                    change={change}
                    onApplicantOcr={syncApplicant}
                    remove={() =>
                      setPeople((v) => v.filter((x) => x.id !== p.id))
                    }
                  />
                ))}
                {auth.role === "worker" && <label className="consentBox"><input type="checkbox" checked={customerConsent} onChange={e=>setCustomerConsent(e.target.checked)} /><span><b>গ্রাহকের সম্মতি নেওয়া হয়েছে</b><small>City Bank account opening-এর জন্য তথ্য ও document সংগ্রহে গ্রাহক সম্মতি দিয়েছেন।</small></span></label>}
                <button
                  className="add"
                  onClick={() =>
                    setPeople((v) => [...v, person(`Nominee ${v.length}`)])
                  }
                >
                  <i>
                    <Plus />
                  </i>
                  <b>আরেকজন Nominee যোগ করুন</b>
                  <small>আলাদা ID ও passport photo</small>
                </button>
                {docs
                  .filter(
                    (d) =>
                      d.kind === "signature" || d.kind === "signature_card",
                  )
                  .map((d) => (
                    <Extra
                      key={d.id}
                      d={d}
                      change={changeDoc}
                      remove={() =>
                        setDocs((v) => v.filter((x) => x.id !== d.id))
                      }
                    />
                  ))}
                {!docs.some((d) => d.kind === "signature") && (
                  <button
                    className="add"
                    onClick={() =>
                      setDocs((v) => [
                        ...v,
                        {
                          id: uid(),
                          kind: "signature",
                          name: "Signature Card",
                          pages: [],
                        },
                      ])
                    }
                  >
                    <i>
                      <FilePlus2 />
                    </i>
                    <b>Signature Scanner খুলুন</b>
                    <small>শুধু স্বাক্ষর • Background removed • PNG</small>
                  </button>
                )}
                {!docs.some((d) => d.kind === "signature_card") && (
                  <button
                    className="add goldline"
                    onClick={() =>
                      setDocs((v) => [
                        ...v,
                        {
                          id: uid(),
                          kind: "signature_card",
                          name: "Signed A4 Signature Card",
                          pages: [],
                        },
                      ])
                    }
                  >
                    <i className="gold">
                      <FilePlus2 />
                    </i>
                    <b>Signature Card Scan করুন</b>
                    <small>গ্রাহকের স্বাক্ষর করা সম্পূর্ণ A4 card</small>
                  </button>
                )}
                <section className="additionalDivider">
                  <small>SIGNATURE CARD-এর পরে</small>
                  <h2>Additional Documents</h2>
                  <p>
                    Document-এর নাম লিখে Camera অথবা Gallery থেকে scan করুন।
                  </p>
                </section>
                {docs
                  .filter(
                    (d) =>
                      d.kind !== "signature" && d.kind !== "signature_card",
                  )
                  .map((d) => (
                    <Extra
                      key={d.id}
                      d={d}
                      change={changeDoc}
                      remove={() =>
                        setDocs((v) => v.filter((x) => x.id !== d.id))
                      }
                    />
                  ))}
                <button
                  className="add goldline"
                  onClick={() =>
                    setDocs((v) => [
                      ...v,
                      { id: uid(), kind: "job", name: "", pages: [] },
                    ])
                  }
                >
                  <i className="gold">
                    <FilePlus2 />
                  </i>
                  <b>Additional Document যোগ করুন</b>
                  <small>নাম লিখুন • Auto crop • PDF save</small>
                </button>
                <DeclarationForm
                  value={declaration}
                  change={setDeclaration}
                  applicant={people[0]}
                  signature={
                    docs.find((d) => d.kind === "signature")?.pages?.[0]
                  }
                />
                <section className="detailsDivider">
                  <small>SCAN শেষ হওয়ার পর</small>
                  <h2>Applicant ও Nominee Details Review</h2>
                  <p>
                    ID থেকে পাওয়া সব লেখা এখানে দেখুন। ভুল থাকলে পরিবর্তন
                    করুন। Server-এ Save না করা পর্যন্ত স্থায়ী হবে না।
                  </p>
                </section>
                {people.map((p, i) => (
                  <PersonDetails
                    key={`details-${p.id}`}
                    p={p}
                    index={i}
                    change={change}
                  />
                ))}
              </div>
              <aside>
                <small>CASE SUMMARY</small>
                <h3>{name || "ID scan-এর অপেক্ষায়"}</h3>
                <p>
                  <span>Customer ID</span>
                  <b>{details.customerId || "—"}</b>
                </p>
                <p>
                  <span>ব্যক্তি</span>
                  <b>{people.length}</b>
                </p>
                <p>
                  <span>অতিরিক্ত PDF</span>
                  <b>{docs.length}</b>
                </p>
                <p>
                  <span>সম্পন্ন</span>
                  <b>{progress}%</b>
                </p>
                <small className="draftStatus"><Clock3 size={14} /> Save না করলে Reload-এ তথ্য reset হবে</small>
                <hr />
                <ul>
                  <li>Applicant/Nominee ID: JPG + PDF</li>
                  <li>Additional document: শুধু PDF</li>
                  <li>Signature Card: transparent PNG</li>
                  <li>Signed A4 Signature Card: JPG</li>
                  <li>Passport photo: blue JPG</li>
                </ul>
                <button className="primary full" onClick={openPreview}>
                  <Eye />
                  Preview দেখুন
                </button>
                <small className="note">
                  Preview নিশ্চিত করার পর download হবে
                </small>
              </aside>
            </div>
          </>
        ) : step === 3 && auth.role === "worker" ? (
          <WorkerFinalPreview name={name} details={details} people={people} declaration={declaration} onBack={()=>setStep(2)} onSave={save} saving={saving}/>
        ) : step === 3 ? (
          <div className="preview">
            <div className="previewTop">
              <button className="secondary" onClick={() => setStep(2)}>
                <ChevronLeft /> Edit করুন
              </button>
              <div>
                <small>DOWNLOAD PREVIEW</small>
                <h1>
                  {details.customerId ? details.customerId + " — " : ""}
                  {name}
                </h1>
              </div>
            </div>
            <section className="previewPanel">
              <div className="previewDetails">
                <h3>Customer Details</h3>
                <dl>
                  <div>
                    <dt>Customer ID</dt>
                    <dd>{details.customerId || "—"}</dd>
                  </div>
                  <div>
                    <dt>Name (English)</dt>
                    <dd>{name}</dd>
                  </div>
                  <div>
                    <dt>নাম (বাংলা)</dt>
                    <dd>{details.nameBn || "—"}</dd>
                  </div>
                  <div>
                    <dt>Email / Gmail</dt>
                    <dd>{details.email || "—"}</dd>
                  </div>
                  <div>
                    <dt>Phone</dt>
                    <dd>{details.phone || "—"}</dd>
                  </div>
                  <div>
                    <dt>ঠিকানা (বাংলা)</dt>
                    <dd>{details.addressBn || "—"}</dd>
                  </div>
                  <div>
                    <dt>Address (English)</dt>
                    <dd>{details.addressEn || "—"}</dd>
                  </div>
                </dl>
              </div>
              {declaration.customerName && (
                <div className="declarationPreview primaryDeclarationPreview">
                  <div className="pdfPreviewHead">
                    <h3>Income & Correction Declaration</h3>
                    <button className="secondary" onClick={() => setStep(2)}>
                      <Pencil size={16} /> Details Edit
                    </button>
                  </div>
                  <dl>
                    {[
                      ["নাম", declaration.customerName],
                      ["পিতা", declaration.fatherName],
                      ["মাতা", declaration.motherName],
                      ["ঠিকানা", declaration.address],
                      ["ডাকঘর", declaration.postOffice],
                      ["থানা", declaration.thana],
                      ["জেলা", declaration.district],
                      ["মাসিক আয়", declaration.monthlyIncome],
                      ["Account", declaration.accountNumber],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    {declaration.polishedDescription ||
                      declaration.rawDescription}
                  </p>
                  <PreviewImage
                    src={declarationJpg}
                    label="Income Declaration — Page 1 Preview"
                  />
                  <section className="idPdfPreview">
                    <div className="pdfPreviewHead">
                      <h3>Income Declaration PDF</h3>
                      <small>Original first page layout</small>
                    </div>
                    <PdfEmbed data={declarationPdfPreview}>
                      <a
                        href={declarationPdfPreview}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Declaration PDF খুলুন
                      </a>
                    </PdfEmbed>
                    <PdfActions
                      data={declarationPdfPreview}
                      filename="Income_Correction_Declaration.pdf"
                    />
                  </section>
                </div>
              )}
              <h3>Applicant ও Nominee Full Preview</h3>
              <div className="previewPeople detailedPeople">
                {people.map((p, i) => (
                  <article key={p.id}>
                    <header className="personPreviewHead">
                      <span>{i ? `NOMINEE ${i}` : "APPLICANT"}</span>
                      <h2>{p.name || p.nameBn || `Person ${i + 1}`}</h2>
                    </header>
                    <dl className="personFacts">
                      <div>
                        <dt>Name</dt>
                        <dd>{p.name || "—"}</dd>
                      </div>
                      <div>
                        <dt>NID / ID Number</dt>
                        <dd>{p.nid || "—"}</dd>
                      </div>
                      <div>
                        <dt>Date of Birth</dt>
                        <dd>{p.dob || "—"}</dd>
                      </div>
                    </dl>
                    <div className="largeDocumentGrid">
                      <PreviewImage
                        src={p.idFront}
                        label={`${i ? "Nominee" : "Applicant"} ID Front`}
                      />
                      <PreviewImage
                        src={p.idBack}
                        label={`${i ? "Nominee" : "Applicant"} ID Back`}
                      />
                    </div>
                    {p.birthCertificate && (
                      <PreviewImage
                        src={p.birthCertificate}
                        label="Nominee Birth Certificate"
                      />
                    )}
                    {idPdfPreviews[p.id] && (
                      <section className="idPdfPreview">
                        <div className="pdfPreviewHead">
                          <h3>ID Card PDF Preview</h3>
                          <small>Front ও Back • A4 PDF</small>
                        </div>
                        <PdfEmbed
                          data={idPdfPreviews[p.id]}
                          type="application/pdf"
                          aria-label={`${p.name || p.role} ID Card PDF Preview`}
                        >
                          <a
                            href={idPdfPreviews[p.id]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            ID Card PDF preview খুলুন
                          </a>
                        </PdfEmbed>
                        <PdfActions
                          data={idPdfPreviews[p.id]}
                          filename={`${personBase(p)}_${p.identityType === "birth" ? "Birth_Certificate" : "ID_Card"}.pdf`}
                        />
                      </section>
                    )}
                    <section className="languageDetails">
                      <h4>English Details</h4>
                      <p>
                        <b>Father:</b> {p.fatherNameEn || "—"}
                      </p>
                      <p>
                        <b>Mother:</b> {p.motherNameEn || "—"}
                      </p>
                      <p>
                        <b>Address:</b> {p.addressEn || "—"}
                      </p>
                    </section>
                    <section className="languageDetails banglaDetails">
                      <h4>বাংলা তথ্য</h4>
                      <p>
                        <b>নাম:</b> {p.nameBn || "—"}
                      </p>
                      <p>
                        <b>পিতা:</b> {p.fatherNameBn || "—"}
                      </p>
                      <p>
                        <b>মাতা:</b> {p.motherNameBn || "—"}
                      </p>
                      <p>
                        <b>ঠিকানা:</b> {p.addressBn || "—"}
                      </p>
                    </section>
                    <PreviewImage
                      src={p.photo}
                      label={`${i ? "Nominee" : "Applicant"} Passport Photo`}
                      portrait
                    />
                  </article>
                ))}
              </div>
              <h3>Additional Documents</h3>
              {docs.length ? (
                <div className="fileList">
                  {docs.map((d) => (
                    <p>
                      <FilePlus2 />
                      <span>
                        {d.name || kinds.find((k) => k.id === d.kind)?.label}
                      </span>
                      <b>
                        {d.pages.filter(Boolean).length} image →{" "}
                        {d.kind === "signature"
                          ? "PNG"
                          : d.kind === "signature_card"
                            ? "JPG"
                            : "PDF"}
                      </b>
                    </p>
                  ))}
                </div>
              ) : (
                <p className="empty">কোনো Additional Document যোগ করা হয়নি</p>
              )}
              <div className="additionalImagePreviews">
                {docs
                  .filter((d) => d.kind !== "signature_card")
                  .flatMap((d) =>
                    d.pages
                      .filter(Boolean)
                      .map((page, index) => (
                        <PreviewImage
                          key={`${d.id}-${index}`}
                          src={page}
                          label={`${d.name || kinds.find((k) => k.id === d.kind)?.label} ${d.pages.length > 1 ? `— Page ${index + 1}` : ""}`}
                        />
                      )),
                  )}
              </div>
              {docs.some((d) => d.kind === "signature_card" && d.pages[0]) && (
                <section className="signatureCardPreview">
                  <h3>Signature Card</h3>
                  {docs
                    .filter((d) => d.kind === "signature_card" && d.pages[0])
                    .map((d) => (
                      <PreviewImage
                        key={d.id}
                        src={d.pages[0]}
                        label="Customer Signed A4 Signature Card"
                      />
                    ))}
                </section>
              )}
              <div className="folderPreview">
                <PhotoPrintEditor people={people} value={photoPrintLayout} change={value=>{setPhotoPrintLayout(value);setPhotoPrintPreview("");}} onPreview={async()=>{try{const pdf=photoPrintPdf(people,photoPrintLayout);setPhotoPrintPreview(pdf ? await asDataUrl(pdf) : "");}catch(error){alert(error.message || "Print preview হয়নি");}}}/>
                {photoPrintPreview && <><PdfEmbed data={photoPrintPreview}/><PdfActions data={photoPrintPreview} filename="Passport_Photos_Print.pdf"/></>}
                <b>Download folder</b>
                <code>
                  {exportName(`${name}_${details.phone || "NO-MOBILE"}`)}
                  /
                </code>
                <small>
                  ZIP-এর এই একটি folder-এ Details TXT, ID JPG/PDF, Photo JPG, Signature PNG, Signature Card JPG, Income PDF ও Photo Print PDF থাকবে।
                </small>
              </div>
              <button
                className="primary downloadFinal"
                onClick={save}
                disabled={saving}
              >
                <Database />
                {saving ? "Server-এ save হচ্ছে…" : "Server-এ Save করুন"}
              </button>
            </section>
          </div>
        ) : (
          <div className="success">
            <i>
              <Check />
            </i>
            <h1>ফাইল Save হয়েছে!</h1>
            <p>
              <b>{name}</b>-এর serial <b>{savedSerial}</b>। Server-এ রাখা হয়েছে
              । এখন চাইলে নিচের button থেকে download করতে পারবেন।
            </p>
            {isAdminRole(auth.role) && <button className="primary" onClick={downloadSaved}>
              <Download /> Customer ZIP Download করুন
            </button>}
            <button
              className="secondary"
              onClick={() => {
                setName("");
                setDetails({
                  customerId: "",
                  nameBn: "",
                  email: "",
                  phone: "",
                  addressBn: "",
                  addressEn: "",
                });
                setPeople([person()]);
                setDocs([]);
                setPhotoPrintLayout({width:35,height:45,positions:{}});
                setPhotoPrintPreview("");
                setDeclaration({
                  customerName: "",
                  fatherName: "",
                  motherName: "",
                  address: "",
                  postOffice: "",
                  thana: "",
                  district: "",
                  rawDescription: "",
                  polishedDescription: "",
                  monthlyIncome: "",
                  accountNumber: "",
                  busy: false,
                });
                setEditingCustomerId(null);
                setDeclarationJpg("");
                setDeclarationPdfPreview("");
                setIdPdfPreviews({});
                setSavedSerial("");
                setSavedCustomerId(null);
                setCustomerConsent(false);
                localStorage.removeItem("documentStudioDraft");
                setStep(auth.role === "worker" ? 0 : 1);
              }}
            >
              নতুন কেস শুরু করুন
            </button>
            <button className="secondary" onClick={() => setStep(2)}>
              আগের কেসে ফিরে যান
            </button>
          </div>
        )}
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
