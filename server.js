require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "public", "uploads");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (process.env.NODE_ENV === "production" && (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)) {
  throw new Error("In production, set SESSION_SECRET to a random secret of at least 32 characters.");
}
const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(48).toString("hex");
const db = new Database(path.join(DATA_DIR, "shopnest.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK(price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  image TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  total INTEGER NOT NULL CHECK(total >= 0),
  status TEXT NOT NULL DEFAULT 'pending',
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`);

const adminCount = db.prepare("SELECT COUNT(*) AS count FROM admins").get().count;
if (adminCount === 0) {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12) {
    console.warn("No admin account created yet. Set ADMIN_USERNAME and ADMIN_PASSWORD (12+ chars) in .env, then restart.");
  } else {
    db.prepare("INSERT INTO admins(username, password_hash) VALUES(?, ?)").run(username, bcrypt.hashSync(password, 12));
    console.log(`Initial admin account created for username "${username}". Change the password after first login.`);
  }
}
if (db.prepare("SELECT COUNT(*) AS count FROM products").get().count === 0) {
  const seed = db.prepare("INSERT INTO products(name,description,category,price,stock,image) VALUES(?,?,?,?,?,?)");
  [
    ["কটন টি-শার্ট", "আরামদায়ক সফট কটন টি-শার্ট।", "ফ্যাশন", 650, 18, ""],
    ["ওয়্যারলেস হেডফোন", "দৈনন্দিন ব্যবহারের জন্য দারুণ সাউন্ড।", "ইলেকট্রনিক্স", 1450, 9, ""],
    ["ক্যানভাস ব্যাগ", "হালকা ও টেকসই ক্যারি ব্যাগ।", "লাইফস্টাইল", 520, 24, ""],
    ["স্মার্ট ওয়াচ", "স্টাইলিশ ডিজাইনের স্মার্ট ওয়াচ।", "ইলেকট্রনিক্স", 2250, 7, ""]
  ].forEach(p => seed.run(...p));
}

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(express.json({ limit: "150kb" }));
app.use(express.urlencoded({ extended: false, limit: "150kb" }));
app.use(session({
  name: "shopnest.sid",
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000
  }
}));
app.use(express.static(path.join(ROOT, "public"), { extensions: ["html"] }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "অনেকবার চেষ্টা হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।" } });
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "অনেক অর্ডার রিকোয়েস্ট হয়েছে। পরে আবার চেষ্টা করুন।" } });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(16).toString("hex") + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(allowed.includes(file.mimetype) ? null : new Error("শুধু JPG, PNG, WebP বা GIF ছবি আপলোড করুন।"), allowed.includes(file.mimetype));
  }
});

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: "অ্যাডমিন লগইন প্রয়োজন।" });
  next();
}
function cleanText(value, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function publicProduct(p) {
  return { id: p.id, name: p.name, description: p.description, category: p.category, price: p.price, stock: p.stock, image: p.image, createdAt: p.created_at };
}
function publicOrder(o) {
  let items = [];
  try { items = JSON.parse(o.items_json); } catch {}
  return { id: o.id, code: o.order_code, customerName: o.customer_name, phone: o.phone, address: o.address, total: o.total, status: o.status, items, createdAt: o.created_at };
}
function deleteImageIfLocal(image) {
  if (!image || !image.startsWith("/uploads/")) return;
  const filename = path.basename(image);
  const full = path.join(UPLOAD_DIR, filename);
  if (full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) fs.unlink(full, () => {});
}
function csrfCheck(req, res, next) {
  // SameSite cookie plus same-origin checks on mutating authenticated requests.
  const origin = req.get("origin");
  const host = req.get("host");
  if (origin && host) {
    try { if (new URL(origin).host !== host) return res.status(403).json({ error: "অননুমোদিত রিকোয়েস্ট।" }); }
    catch { return res.status(403).json({ error: "অননুমোদিত রিকোয়েস্ট।" }); }
  }
  next();
}

app.get("/api/products", (_req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC, id DESC").all();
  res.json(rows.map(publicProduct));
});
app.post("/api/orders", orderLimiter, csrfCheck, (req, res) => {
  const customerName = cleanText(req.body.customerName, 100);
  const phone = cleanText(req.body.phone, 30);
  const address = cleanText(req.body.address, 1000);
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!customerName || !phone || !address || !requestedItems.length || requestedItems.length > 30) {
    return res.status(400).json({ error: "নাম, ফোন, ঠিকানা ও কার্টের তথ্য দিন।" });
  }
  if (!/^[0-9+\-\s()]{7,20}$/.test(phone)) return res.status(400).json({ error: "সঠিক মোবাইল নম্বর দিন।" });
  const normalized = new Map();
  for (const item of requestedItems) {
    const id = Number(item.id), qty = Number(item.qty);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(qty) || qty < 1 || qty > 99) return res.status(400).json({ error: "কার্টের তথ্য সঠিক নয়।" });
    normalized.set(id, (normalized.get(id) || 0) + qty);
  }
  const placeOrder = db.transaction(() => {
    const items = [];
    let total = 0;
    for (const [id, qty] of normalized.entries()) {
      const p = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
      if (!p) throw new Error("একটি প্রোডাক্ট আর পাওয়া যাচ্ছে না।");
      if (p.stock < qty) throw new Error(`${p.name}: পর্যাপ্ত স্টক নেই।`);
      items.push({ id: p.id, name: p.name, price: p.price, qty, image: p.image });
      total += p.price * qty;
    }
    for (const item of items) {
      const result = db.prepare("UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND stock >= ?").run(item.qty, item.id, item.qty);
      if (result.changes !== 1) throw new Error("স্টক আপডেট করা যায়নি, আবার চেষ্টা করুন।");
    }
    const code = "SN-" + Date.now().toString(36).toUpperCase() + "-" + crypto.randomBytes(2).toString("hex").toUpperCase();
    const info = db.prepare("INSERT INTO orders(order_code,customer_name,phone,address,total,status,items_json) VALUES(?,?,?,?,?,'pending',?)")
      .run(code, customerName, phone, address, total, JSON.stringify(items));
    return { id: info.lastInsertRowid, code, total };
  });
  try {
    const order = placeOrder();
    res.status(201).json({ message: "অর্ডার সফলভাবে গ্রহণ করা হয়েছে।", order });
  } catch (err) {
    res.status(400).json({ error: err.message || "অর্ডার নেওয়া যায়নি।" });
  }
});

app.post("/api/admin/login", loginLimiter, csrfCheck, (req, res, next) => {
  const username = cleanText(req.body.username, 100);
  const password = typeof req.body.password === "string" ? req.body.password : "";
  const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: "ইউজারনেম বা পাসওয়ার্ড সঠিক নয়।" });
  req.session.regenerate(err => {
    if (err) return next(err);
    req.session.adminId = admin.id;
    req.session.username = admin.username;
    req.session.save(err2 => {
      if (err2) return next(err2);
      res.json({ message: "লগইন সফল।", username: admin.username });
    });
  });
});
app.get("/api/admin/me", requireAdmin, (req, res) => res.json({ username: req.session.username }));
app.post("/api/admin/logout", requireAdmin, csrfCheck, (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie("shopnest.sid", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    res.json({ message: "লগআউট হয়েছে।" });
  });
});
app.get("/api/admin/stats", requireAdmin, (_req, res) => {
  const products = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
  const orders = db.prepare("SELECT COUNT(*) AS n FROM orders").get().n;
  const pending = db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'pending'").get().n;
  const revenue = db.prepare("SELECT COALESCE(SUM(total),0) AS n FROM orders WHERE status != 'cancelled'").get().n;
  res.json({ products, orders, pending, revenue });
});
app.post("/api/admin/products", requireAdmin, csrfCheck, upload.single("image"), (req, res) => {
  const name = cleanText(req.body.name, 150);
  const description = cleanText(req.body.description, 2000);
  const category = cleanText(req.body.category, 100);
  const price = Number(req.body.price), stock = Number(req.body.stock);
  if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
    if (req.file) deleteImageIfLocal("/uploads/" + req.file.filename);
    return res.status(400).json({ error: "নাম, সঠিক দাম ও স্টক দিন।" });
  }
  const image = req.file ? "/uploads/" + req.file.filename : "";
  const info = db.prepare("INSERT INTO products(name,description,category,price,stock,image) VALUES(?,?,?,?,?,?)").run(name, description, category, price, stock, image);
  res.status(201).json(publicProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(info.lastInsertRowid)));
});
app.put("/api/admin/products/:id", requireAdmin, csrfCheck, upload.single("image"), (req, res) => {
  const id = Number(req.params.id), old = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!old) { if (req.file) deleteImageIfLocal("/uploads/" + req.file.filename); return res.status(404).json({ error: "প্রোডাক্ট পাওয়া যায়নি।" }); }
  const name = cleanText(req.body.name, 150);
  const description = cleanText(req.body.description, 2000);
  const category = cleanText(req.body.category, 100);
  const price = Number(req.body.price), stock = Number(req.body.stock);
  if (!name || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(stock) || stock < 0) {
    if (req.file) deleteImageIfLocal("/uploads/" + req.file.filename);
    return res.status(400).json({ error: "নাম, সঠিক দাম ও স্টক দিন।" });
  }
  const image = req.file ? "/uploads/" + req.file.filename : old.image;
  db.prepare("UPDATE products SET name=?,description=?,category=?,price=?,stock=?,image=?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
    .run(name, description, category, price, stock, image, id);
  if (req.file && old.image !== image) deleteImageIfLocal(old.image);
  res.json(publicProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id)));
});
app.delete("/api/admin/products/:id", requireAdmin, csrfCheck, (req, res) => {
  const id = Number(req.params.id), p = db.prepare("SELECT * FROM products WHERE id = ?").get(id);
  if (!p) return res.status(404).json({ error: "প্রোডাক্ট পাওয়া যায়নি।" });
  db.prepare("DELETE FROM products WHERE id = ?").run(id);
  deleteImageIfLocal(p.image);
  res.json({ message: "প্রোডাক্ট ডিলিট হয়েছে।" });
});
app.get("/api/admin/orders", requireAdmin, (_req, res) => {
  res.json(db.prepare("SELECT * FROM orders ORDER BY id DESC").all().map(publicOrder));
});
app.patch("/api/admin/orders/:id", requireAdmin, csrfCheck, (req, res) => {
  const allowed = ["pending", "confirmed", "shipping", "completed", "cancelled"];
  const status = cleanText(req.body.status, 30);
  if (!allowed.includes(status)) return res.status(400).json({ error: "স্ট্যাটাস সঠিক নয়।" });
  const result = db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "অর্ডার পাওয়া যায়নি।" });
  res.json(publicOrder(db.prepare("SELECT * FROM orders WHERE id = ?").get(Number(req.params.id))));
});
app.delete("/api/admin/orders/:id", requireAdmin, csrfCheck, (req, res) => {
  const result = db.prepare("DELETE FROM orders WHERE id = ?").run(Number(req.params.id));
  if (!result.changes) return res.status(404).json({ error: "অর্ডার পাওয়া যায়নি।" });
  res.json({ message: "অর্ডার ডিলিট হয়েছে।" });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "ছবির সাইজ ২MB-এর মধ্যে রাখুন।" : "ছবি আপলোড করা যায়নি।" });
  res.status(500).json({ error: err.message || "সার্ভারে সমস্যা হয়েছে।" });
});
app.listen(PORT, () => console.log(`ShopNest is running on http://localhost:${PORT}`));
