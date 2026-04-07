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

// --- INIT TABLES ---
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
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
        profilePhoto TEXT,
        remainingSession INTEGER DEFAULT 30
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idNumber TEXT,
        purpose TEXT,
        lab TEXT,
        timeIn TEXT,
        timeOut TEXT,
        date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author TEXT,
        content TEXT,
        date TEXT
    )`);
});

// --- REGISTER & LOGIN ---
app.post("/register", (req, res) => {
    const { idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address } = req.body;
    const sql = `INSERT INTO users (idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "User registered successfully!" });
    });
});

app.post("/login", (req, res) => {
    const { loginInput, password } = req.body;
    const sql = `SELECT * FROM users WHERE email = ? OR idNumber = ?`;
    db.get(sql, [loginInput, loginInput], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (user && user.password === password) {
            res.json({ message: "Login successful!", user });
        } else {
            res.status(401).json({ message: "Invalid credentials." });
        }
    });
});

// --- GET STUDENT PROFILE (SECURE VERSION) ---
app.get(["/student/:idNumber", "/get-student/:idNumber"], (req, res) => {
    const sql = `
        SELECT 
            idNumber, 
            firstName, 
            lastName, 
            middleName, 
            course, 
            yearLevel, 
            email, 
            address, 
            remainingSession, 
            profilePhoto 
        FROM users 
        WHERE idNumber = ?
    `;
    
    db.get(sql, [req.params.idNumber], (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (!user) {
            return res.status(404).json({ message: "Student not found." });
        }
        res.json(user);
    });
});

// --- PROFILE & SESSION ACTIONS ---
app.post('/update-profile', (req, res) => {
    const { oldIdNumber, idNumber, lastName, firstName, middleName, yearLevel, course, email, address, profilePhoto } = req.body;
    const sql = `UPDATE users SET idNumber = ?, lastName = ?, firstName = ?, middleName = ?, yearLevel = ?, course = ?, email = ?, address = ?, profilePhoto = ? WHERE idNumber = ?`;
    db.run(sql, [idNumber, lastName, firstName, middleName, yearLevel, course, email, address, profilePhoto, oldIdNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Update successful!" });
    });
});

// This handles the reservation from reservation.html
app.post("/make-reservation", (req, res) => {
    const { idNumber, purpose, lab, timeIn, date } = req.body;

    db.get(`SELECT remainingSession FROM users WHERE idNumber = ?`, [idNumber], (err, user) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!user) return res.status(404).json({ message: "Student ID not found!" });
        if (user.remainingSession <= 0) return res.status(400).json({ message: "No sessions left!" });

        // 2. Insert the reservation
        const sql = `INSERT INTO reservations (idNumber, purpose, lab, timeIn, date) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [idNumber, purpose, lab, timeIn, date], function(err) {
            if (err) return res.status(500).json({ message: err.message });

            db.run(`UPDATE users SET remainingSession = remainingSession - 1 WHERE idNumber = ?`, [idNumber], (err) => {
                if (err) return res.status(500).json({ message: "Failed to deduct session" });
                res.json({ message: "Reservation successful!" });
            });
        });
    });
});

app.post("/record-final-logout", (req, res) => {
    const { idNumber } = req.body;
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.run(`UPDATE reservations SET timeOut = ? WHERE idNumber = ? AND (timeOut IS NULL OR timeOut = '') AND id = (SELECT MAX(id) FROM reservations WHERE idNumber = ?)`, 
    [currentTime, idNumber, idNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Lab logout recorded", time: currentTime });
    });
});

app.get("/history/:idNumber", (req, res) => {

    const sql = `
        SELECT 
            r.*, 
            u.firstName, 
            u.lastName 
        FROM reservations r
        JOIN users u ON r.idNumber = u.idNumber
        WHERE r.idNumber = ? 
        ORDER BY r.id DESC
    `;
    
    db.all(sql, [req.params.idNumber], (err, rows) => {
        if (err) {
            console.error("History Error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(rows);
    });
});

app.get("/announcements", (req, res) => {
    db.all(`SELECT * FROM announcements ORDER BY id DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- ADMIN ENDPOINTS ---
app.get("/admin/dashboard-data", (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM users WHERE idNumber != 'Admin'`, (err, r) => {
        db.get(`SELECT COUNT(*) as count FROM reservations WHERE timeOut IS NULL OR timeOut = ''`, (err, c) => {
            db.get(`SELECT COUNT(*) as count FROM reservations`, (err, t) => {
                db.all(`SELECT purpose, COUNT(*) as count FROM reservations GROUP BY purpose`, (err, p) => {
                    res.json({ registered: r?.count || 0, currentSitin: c?.count || 0, totalSitin: t?.count || 0, chartData: p || [] });
                });
            });
        });
    });
});

app.post("/admin/announcement", (req, res) => {
    const { content } = req.body;
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    db.run(`INSERT INTO announcements (author, content, date) VALUES (?, ?, ?)`, ['CCS Admin', content, date], (err) => {
        if (err) return res.status(500).send(err.message);
        res.send("Posted");
    });
});

app.delete("/admin/announcement/:id", (req, res) => {
    const id = req.params.id;

    db.run(`DELETE FROM announcements WHERE id = ?`, [id], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: "Announcement not found" });
        }
        res.json({ message: "Announcement deleted successfully" });
    });
});

app.get("/admin/students", (req, res) => {
    db.all(`SELECT idNumber, firstName, lastName, course, yearLevel, remainingSession FROM users WHERE idNumber != 'Admin' ORDER BY lastName ASC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});


app.use(cors());

app.delete("/admin/students/:idNumber", (req, res) => {
    const idNumber = req.params.idNumber;
    console.log("Delete request received for ID:", idNumber);

    db.run(`DELETE FROM users WHERE idNumber = ?`, [idNumber], function (err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ message: "Student not found" });
        }
        res.json({ message: "Student deleted successfully" });
    });
});

app.post("/admin/reset-sessions", (req, res) => {
    db.run(`UPDATE users SET remainingSession = 30 WHERE idNumber != 'Admin'`, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "All sessions reset to 30." });
    });
});

// Add this to server.js to reset a SINGLE student
app.post("/admin/reset-single-student", (req, res) => {
    const { idNumber } = req.body;
    db.run(`UPDATE users SET remainingSession = 30 WHERE idNumber = ?`, [idNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Sessions reset for ${idNumber}` });
    });
});

app.get("/get-student/:idNumber", (req, res) => {
    const id = req.params.idNumber;
    db.get(`SELECT firstName, lastName, remainingSession FROM users WHERE idNumber = ?`, [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            res.json(row);
        } else {
            res.status(404).json({ message: "Not found" });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});