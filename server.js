const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const path = require("path");

const app = express();
const PORT = 3000;

// إعدادات أساسية
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false }));

// افتح قاعدة البيانات أو أنشئها تلقائيًا
const db = new Database(path.join(__dirname, "school-results.sqlite"));

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// إنشاء الجداول
db.exec(`
  CREATE TABLE IF NOT EXISTS schools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_name TEXT NOT NULL,
    seat_number TEXT NOT NULL,
    school_id INTEGER NOT NULL,
    grade TEXT NOT NULL,
    arabic REAL NOT NULL DEFAULT 0,
    english REAL NOT NULL DEFAULT 0,
    math REAL NOT NULL DEFAULT 0,
    science REAL NOT NULL DEFAULT 0,
    social REAL NOT NULL DEFAULT 0,
    published INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (school_id) REFERENCES schools(id)
      ON DELETE RESTRICT,
    UNIQUE (school_id, grade, seat_number)
  );
`);

// كلمة مرور الإدارة: يجب تغييرها قبل النشر
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error(
    "خطأ: عيّن متغير البيئة ADMIN_PASSWORD قبل تشغيل الخادم."
  );
  process.exit(1);
}

// جلسات تسجيل الدخول
app.use(
  session({
    name: "school_admin_session",
    secret: process.env.SESSION_SECRET || "change-this-development-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      maxAge: 30 * 60 * 1000
    }
  })
);

// أدوات مساعدة
function isValidId(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }

  return res.status(401).json({
    success: false,
    message: "يجب تسجيل الدخول أولًا."
  });
}

function validText(value, maxLength = 150) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= maxLength
  );
}

function validMark(value) {
  return (
    value !== "" &&
    value !== null &&
    value !== undefined &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
  );
}

function validateResult(body) {
  const fields = [
    "arabic",
    "english",
    "math",
    "science",
    "social"
  ];

  if (!validText(body.student_name)) {
    return "اسم الطالب مطلوب.";
  }

  if (!validText(String(body.seat_number ?? ""), 30)) {
    return "رقم الجلوس مطلوب.";
  }

  if (!validText(body.grade, 80)) {
    return "الصف الدراسي مطلوب.";
  }

  if (!isValidId(body.school_id)) {
    return "المدرسة المحددة غير صحيحة.";
  }

  for (const field of fields) {
    if (!validMark(body[field])) {
      return `درجة المادة ${field} غير صحيحة.`;
    }
  }

  return null;
}

// تسجيل دخول الإدارة
app.post("/api/admin/login", (req, res) => {
  const password = req.body?.password;

  if (
    typeof password !== "string" ||
    password.length > 200 ||
    password !== ADMIN_PASSWORD
  ) {
    return res.status(401).json({
      success: false,
      message: "كلمة المرور غير صحيحة."
    });
  }

  req.session.regenerate((error) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "تعذر إنشاء جلسة تسجيل الدخول."
      });
    }

    req.session.isAdmin = true;

    return res.json({
      success: true,
      message: "تم تسجيل الدخول بنجاح."
    });
  });
});

// التحقق من جلسة الإدارة
app.get("/api/admin/session", requireAdmin, (req, res) => {
  res.json({ success: true, authenticated: true });
});

// تسجيل الخروج
app.post("/api/admin/logout", requireAdmin, (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      return res.status(500).json({
        success: false,
        message: "تعذر تسجيل الخروج."
      });
    }

    res.clearCookie("school_admin_session");
    res.json({ success: true });
  });
});

// عرض المدارس
app.get("/api/schools", (req, res) => {
  const schools = db
    .prepare("SELECT id, name FROM schools ORDER BY name")
    .all();

  res.json({ success: true, schools });
});

// إضافة مدرسة
app.post("/api/admin/schools", requireAdmin, (req, res) => {
  const name = req.body?.name;

  if (!validText(name, 150)) {
    return res.status(400).json({
      success: false,
      message: "اسم المدرسة مطلوب."
    });
  }

  try {
    const result = db
      .prepare("INSERT INTO schools (name) VALUES (?)")
      .run(name.trim());

    res.status(201).json({
      success: true,
      id: result.lastInsertRowid,
      name: name.trim()
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        success: false,
        message: "هذه المدرسة مسجلة بالفعل."
      });
    }

    console.error(error);
    res.status(500).json({
      success: false,
      message: "تعذر إضافة المدرسة."
    });
  }
});

// حذف مدرسة لا توجد نتائج مرتبطة بها
app.delete("/api/admin/schools/:id", requireAdmin, (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "رقم المدرسة غير صحيح."
    });
  }

  const result = db
    .prepare("DELETE FROM schools WHERE id = ?")
    .run(Number(req.params.id));

  if (result.changes === 0) {
    return res.status(404).json({
      success: false,
      message: "المدرسة غير موجودة."
    });
  }

  res.json({ success: true });
});

// استعلام الطالب عن نتيجة منشورة
app.get("/api/results", (req, res) => {
  const schoolId = req.query.school_id;
  const grade = req.query.grade;
  const seatNumber = req.query.seat_number;

  if (
    !isValidId(schoolId) ||
    !validText(grade, 80) ||
    !validText(seatNumber, 30)
  ) {
    return res.status(400).json({
      success: false,
      message: "أدخل المدرسة والصف ورقم الجلوس بصورة صحيحة."
    });
  }

  const result = db.prepare(`
    SELECT
      r.student_name,
      r.seat_number,
      r.grade,
      s.name AS school_name,
      r.arabic,
      r.english,
      r.math,
      r.science,
      r.social,
      (
        r.arabic + r.english + r.math +
        r.science + r.social
      ) AS total
    FROM results r
    JOIN schools s ON s.id = r.school_id
    WHERE r.school_id = ?
      AND r.grade = ?
      AND r.seat_number = ?
      AND r.published = 1
  `).get(Number(schoolId), grade.trim(), seatNumber.trim());

  if (!result) {
    return res.status(404).json({
      success: false,
      message: "لم يتم العثور على نتيجة منشورة تطابق البيانات."
    });
  }

  res.json({ success: true, result });
});

// عرض كل النتائج للإدارة
app.get("/api/admin/results", requireAdmin, (req, res) => {
  const results = db.prepare(`
    SELECT
      r.*,
      s.name AS school_name,
      (
        r.arabic + r.english + r.math +
        r.science + r.social
      ) AS total
    FROM results r
    JOIN schools s ON s.id = r.school_id
    ORDER BY r.id DESC
  `).all();

  res.json({ success: true, results });
});

// إضافة نتيجة
app.post("/api/admin/results", requireAdmin, (req, res) => {
  const errorMessage = validateResult(req.body || {});

  if (errorMessage) {
    return res.status(400).json({
      success: false,
      message: errorMessage
    });
  }

  const b = req.body;

  try {
    const result = db.prepare(`
      INSERT INTO results (
        student_name, seat_number, school_id, grade,
        arabic, english, math, science, social, published
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      b.student_name.trim(),
      String(b.seat_number).trim(),
      Number(b.school_id),
      b.grade.trim(),
      Number(b.arabic),
      Number(b.english),
      Number(b.math),
      Number(b.science),
      Number(b.social),
      b.published === true || b.published === 1 ? 1 : 0
    );

    res.status(201).json({
      success: true,
      id: result.lastInsertRowid
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        success: false,
        message: "رقم الجلوس مسجل بالفعل لهذه المدرسة والصف."
      });
    }

    if (error.code === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      return res.status(400).json({
        success: false,
        message: "المدرسة المحددة غير موجودة."
      });
    }

    console.error(error);
    res.status(500).json({
      success: false,
      message: "تعذرت إضافة النتيجة."
    });
  }
});

// تعديل نتيجة
app.put("/api/admin/results/:id", requireAdmin, (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "رقم النتيجة غير صحيح."
    });
  }

  const errorMessage = validateResult(req.body || {});

  if (errorMessage) {
    return res.status(400).json({
      success: false,
      message: errorMessage
    });
  }

  const b = req.body;

  try {
    const result = db.prepare(`
      UPDATE results SET
        student_name = ?,
        seat_number = ?,
        school_id = ?,
        grade = ?,
        arabic = ?,
        english = ?,
        math = ?,
        science = ?,
        social = ?,
        published = ?
      WHERE id = ?
    `).run(
      b.student_name.trim(),
      String(b.seat_number).trim(),
      Number(b.school_id),
      b.grade.trim(),
      Number(b.arabic),
      Number(b.english),
      Number(b.math),
      Number(b.science),
      Number(b.social),
      b.published === true || b.published === 1 ? 1 : 0,
      Number(req.params.id)
    );

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: "النتيجة غير موجودة."
      });
    }

    res.json({ success: true });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        success: false,
        message: "رقم الجلوس مسجل بالفعل لهذه المدرسة والصف."
      });
    }

    console.error(error);
    res.status(500).json({
      success: false,
      message: "تعذر تعديل النتيجة."
    });
  }
});

// حذف نتيجة
app.delete("/api/admin/results/:id", requireAdmin, (req, res) => {
  if (!isValidId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "رقم النتيجة غير صحيح."
    });
  }

  const result = db
    .prepare("DELETE FROM results WHERE id = ?")
    .run(Number(req.params.id));

  if (result.changes === 0) {
    return res.status(404).json({
      success: false,
      message: "النتيجة غير موجودة."
    });
  }

  res.json({ success: true });
});

// نشر نتيجة أو إخفاؤها
app.patch(
  "/api/admin/results/:id/publish",
  requireAdmin,
  (req, res) => {
    if (!isValidId(req.params.id)) {
      return res.status(400).json({
        success: false,
        message: "رقم النتيجة غير صحيح."
      });
    }

    if (typeof req.body?.published !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "حدد حالة النشر."
      });
    }

    const result = db.prepare(`
      UPDATE results
      SET published = ?
      WHERE id = ?
    `).run(
      req.body.published ? 1 : 0,
      Number(req.params.id)
    );

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        message: "النتيجة غير موجودة."
      });
    }

    res.json({ success: true });
  }
);

// منع الوصول المباشر إلى ملفات الخادم وقاعدة البيانات
app.use((req, res, next) => {
  const blocked = [
    "/server.js",
    "/package.json",
    "/package-lock.json",
    "/school-results.sqlite",
    "/school-results.sqlite-wal",
    "/school-results.sqlite-shm",
    "/.env"
  ];

  if (blocked.includes(req.path)) {
    return res.sendStatus(404);
  }

  next();
});

// عرض صفحات الموقع الحالية
app.use(express.static(__dirname));

// تشغيل الخادم
app.listen(PORT, "127.0.0.1", () => {
  console.log(`الخادم يعمل على http://127.0.0.1:${PORT}`);
  console.log("قاعدة البيانات: school-results.sqlite");
});