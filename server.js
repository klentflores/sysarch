const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(cors());

app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

const dbPath = path.resolve(__dirname, "klent.db");
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Database Connection Error:", err.message);
    } else {
        console.log("Connected to SQLite database at:", dbPath);
    }
});

// Initialize Tables
db.serialize(() => {
    db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idNumber TEXT,
        lastName TEXT,
        firstName TEXT,
        middleName TEXT,
        course TEXT,
        yearLevel TEXT,
        email TEXT,
        password TEXT,
        address TEXT,
        profilePhoto TEXT
    )
    `);

    // Add columns if they don't exist yet (safety for existing DBs)
    db.run(`ALTER TABLE users ADD COLUMN remainingSession INTEGER DEFAULT 30`, (err) => {});
    db.run(`ALTER TABLE users ADD COLUMN profilePhoto TEXT`, (err) => {});

    db.run(`
    CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idNumber TEXT,
        purpose TEXT,
        lab TEXT,
        timeIn TEXT,
        timeOut TEXT,
        date TEXT
    )
    `);
});

// --- REGISTRATION ---
app.post("/register", (req, res) => {
    const { idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address } = req.body;
    const sql = `INSERT INTO users (idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    db.run(sql, [idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "User registered successfully!" });
    });
});

// --- LOGIN ---
app.post("/login", (req, res) => {
    const { loginInput, password } = req.body;
    const sql = `SELECT * FROM users WHERE email = ? OR idNumber = ?`;

    db.get(sql, [loginInput, loginInput], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (user && user.password === password) {
            res.json({ message: "Login successful!", user: user });
        } else {
            res.status(401).json({ message: "Invalid credentials." });
        }
    });
});

// --- GET STUDENT ---
app.get("/student/:idNumber", (req, res) => {
    const sql = `SELECT * FROM users WHERE idNumber = ?`;
    db.get(sql, [req.params.idNumber], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ message: "Student not found." });
        res.json(user);
    });
});

// --- SAVE PROFILE PHOTO ---
app.post("/upload-photo", (req, res) => {
    const { idNumber, photo } = req.body;
    if (!idNumber || !photo) return res.status(400).json({ error: "Missing data." });

    db.run(`UPDATE users SET profilePhoto = ? WHERE idNumber = ?`, [photo, idNumber], function(err) {
        if (err) {
            console.error("Upload Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Photo saved successfully!" });
    });
});

// --- UPDATE PROFILE ---
app.post('/update-profile', (req, res) => {
    const { oldIdNumber, idNumber, lastName, firstName, middleName, yearLevel, course, email, address } = req.body;
    const sql = `UPDATE users SET idNumber = ?, lastName = ?, firstName = ?, middleName = ?, 
                yearLevel = ?, course = ?, email = ?, address = ? WHERE idNumber = ?`;

    db.run(sql, [idNumber, lastName, firstName, middleName, yearLevel, course, email, address, oldIdNumber], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Update successful!" });
    });
});

// --- MAKE RESERVATION ---
app.post("/make-reservation", (req, res) => {
    const { idNumber, purpose, lab, timeIn, date } = req.body;
    db.run(`INSERT INTO reservations (idNumber, purpose, lab, timeIn, date) VALUES (?, ?, ?, ?, ?)`,
        [idNumber, purpose, lab, timeIn, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Reservation submitted successfully!" });
    });
});

// --- GET HISTORY ---
app.get("/history/:idNumber", (req, res) => {
    const sql = `
        SELECT u.idNumber as id, 
               (u.firstName || ' ' || u.lastName) as name,
               r.purpose, r.lab, r.timeIn as login, r.timeOut as logout, r.date
        FROM reservations r
        JOIN users u ON u.idNumber = r.idNumber
        WHERE r.idNumber = ?
        ORDER BY r.date DESC, r.timeIn DESC`;

    db.all(sql, [req.params.idNumber], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- ADMIN ROUTES ---
app.get("/admin/stats", (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM users WHERE idNumber != 'Admin'`, [], (err, r) => {
        db.get(`SELECT COUNT(*) as count FROM reservations WHERE timeOut IS NULL`, [], (err2, c) => {
            db.get(`SELECT COUNT(*) as count FROM reservations`, [], (err3, t) => {
                db.all(`SELECT purpose, COUNT(*) as count FROM reservations GROUP BY purpose`, [], (err4, p) => {
                    res.json({ registered: r?.count || 0, currentSitin: c?.count || 0, totalSitin: t?.count || 0, purposeCounts: p || [] });
                });
            });
        });
    });
});

app.get("/admin/students", (req, res) => {
    db.all(`SELECT idNumber, firstName, lastName, middleName, course, yearLevel, remainingSession FROM users WHERE idNumber != 'Admin' ORDER BY lastName ASC`,
        [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.delete("/admin/student/:idNumber", (req, res) => {
    db.run(`DELETE FROM users WHERE idNumber = ?`, [req.params.idNumber], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Student deleted." });
    });
});

app.post("/admin/reset-sessions", (req, res) => {
    db.run(`UPDATE users SET remainingSession = 30 WHERE idNumber != 'Admin'`, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "All sessions reset to 30." });
    });
});

// --- START SERVER ---
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});