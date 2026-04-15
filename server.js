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

// --- GET STUDENT PROFILE ---
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
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ message: "Student not found." });
        res.json(user);
    });
});

// --- PROFILE UPDATE ---
app.post('/update-profile', (req, res) => {
    const { oldIdNumber, idNumber, lastName, firstName, middleName, yearLevel, course, email, address, profilePhoto } = req.body;
    const sql = `UPDATE users SET idNumber = ?, lastName = ?, firstName = ?, middleName = ?, yearLevel = ?, course = ?, email = ?, address = ?, profilePhoto = ? WHERE idNumber = ?`;
    db.run(sql, [idNumber, lastName, firstName, middleName, yearLevel, course, email, address, profilePhoto, oldIdNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Update successful!" });
    });
});

// --- SIT-IN: Record a new sit-in (called from Confirm Sit-In modal) ---
app.post("/sit-in", (req, res) => {
    const { idNumber, purpose, lab } = req.body;
    const timeIn = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const date   = new Date().toLocaleDateString('en-CA');
 
    db.get(`SELECT remainingSession FROM users WHERE idNumber = ?`, [idNumber], (err, user) => {
        if (err) return res.status(500).send("Database error");
        if (!user) return res.status(404).send("Student ID not found!");
        if (user.remainingSession <= 0) return res.status(400).send("No remaining sessions!");
 
        const sql = `INSERT INTO reservations (idNumber, purpose, lab, timeIn, date, status) VALUES (?, ?, ?, ?, ?, 'Active')`;
        db.run(sql, [idNumber, purpose, lab, timeIn, date], function (err) {
            if (err) return res.status(500).send(err.message);
 
            db.run(`UPDATE users SET remainingSession = remainingSession - 1 WHERE idNumber = ?`, [idNumber], (err) => {
                if (err) return res.status(500).send("Failed to deduct session");
                res.json({ message: "Sit-in recorded!", id: this.lastID });
            });
        });
    });
});

// --- SIT-IN: Get all active sit-ins (no timeOut) for viewsitin.html ---
app.get("/get-sitin", (req, res) => {
    const sql = `
        SELECT 
            r.id,
            r.idNumber,
            u.firstName,
            u.lastName,
            r.purpose,
            r.lab,
            r.timeIn,
            r.timeOut,
            r.date,
            u.remainingSession
        FROM reservations r
        JOIN users u ON r.idNumber = u.idNumber
        WHERE (r.timeOut IS NULL OR r.timeOut = '')
        ORDER BY r.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- SIT-IN: Time Out a specific sit-in record by reservation ID ---
app.post("/time-out/:id", (req, res) => {
    const sitInId = req.params.id;
    const timeOut = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
 
    db.run(`UPDATE reservations SET timeOut = ? WHERE id = ?`, [timeOut, sitInId], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).send("Record not found");
        res.json({ message: "Timed out successfully", timeOut });
    });
});

// --- RESERVATION (from reservation.html) ---
app.post("/make-reservation", (req, res) => {
    const { idNumber, studentName, purpose, lab, pcNumber, timeIn, date } = req.body;
    const createdAt = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
 
    // Just verify the student exists — no session deduction here
    db.get(`SELECT remainingSession FROM users WHERE idNumber = ?`, [idNumber], (err, user) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!user) return res.status(404).json({ message: "Student ID not found!" });
        if (user.remainingSession <= 0) return res.status(400).json({ message: "No sessions left! Cannot make a reservation." });
 
        const sql = `INSERT INTO reservation_requests (idNumber, studentName, purpose, lab, pcNumber, timeIn, date, status, createdAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 'Pending', ?)`;
        db.run(sql, [idNumber, studentName, purpose, lab, pcNumber, timeIn, date, createdAt], function (err) {
            if (err) return res.status(500).json({ message: err.message });
            res.json({ message: "Reservation request submitted! Please wait for admin approval." });
        });
    });
});

app.get("/admin/reservations", (req, res) => {
    const sql = `SELECT * FROM reservation_requests ORDER BY id DESC`;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post("/admin/update-reservation", (req, res) => {
    const { id, status } = req.body;
 
    if (status === 'Accepted') {
        // First, get the reservation request details
        db.get(`SELECT * FROM reservation_requests WHERE id = ?`, [id], (err, req_row) => {
            if (err) return res.status(500).json({ message: "Database error" });
            if (!req_row) return res.status(404).json({ message: "Reservation not found" });
 
            // Check student has sessions remaining
            db.get(`SELECT remainingSession FROM users WHERE idNumber = ?`, [req_row.idNumber], (err, user) => {
                if (err) return res.status(500).json({ message: "Database error" });
                if (!user) return res.status(404).json({ message: "Student not found" });
                if (user.remainingSession <= 0) {
                    // Update request to Denied since no sessions left
                    db.run(`UPDATE reservation_requests SET status = 'Denied' WHERE id = ?`, [id]);
                    return res.status(400).json({ message: "Student has no remaining sessions. Reservation denied." });
                }
 
                const timeIn = req_row.timeIn || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const date = req_row.date || new Date().toLocaleDateString('en-CA');
 
                // Insert into active sit-in reservations
                const insertSql = `INSERT INTO reservations (idNumber, purpose, lab, pcNumber, timeIn, date, status) VALUES (?, ?, ?, ?, ?, ?, 'Active')`;
                db.run(insertSql, [req_row.idNumber, req_row.purpose, req_row.lab, req_row.pcNumber, timeIn, date], function (err) {
                    if (err) return res.status(500).json({ message: "Failed to record sit-in" });
 
                    // Deduct one session from student
                    db.run(`UPDATE users SET remainingSession = remainingSession - 1 WHERE idNumber = ?`, [req_row.idNumber], (err) => {
                        if (err) return res.status(500).json({ message: "Failed to deduct session" });
 
                        // Mark request as Accepted
                        db.run(`UPDATE reservation_requests SET status = 'Accepted' WHERE id = ?`, [id], (err) => {
                            if (err) return res.status(500).json({ message: "Failed to update request status" });
                            res.json({ message: "Reservation accepted! Sit-in recorded and session deducted." });
                        });
                    });
                });
            });
        });
 
    } else if (status === 'Denied') {
        db.run(`UPDATE reservation_requests SET status = 'Denied' WHERE id = ?`, [id], function (err) {
            if (err) return res.status(500).json({ message: err.message });
            if (this.changes === 0) return res.status(404).json({ message: "Reservation not found" });
            res.json({ message: "Reservation denied." });
        });
 
    } else {
        res.status(400).json({ message: "Invalid status. Use 'Accepted' or 'Denied'." });
    }
});

app.post("/record-final-logout", (req, res) => {
    const { idNumber } = req.body;
    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    db.run(
        `UPDATE reservations SET timeOut = ? WHERE idNumber = ? AND (timeOut IS NULL OR timeOut = '') AND id = (SELECT MAX(id) FROM reservations WHERE idNumber = ?)`,
        [currentTime, idNumber, idNumber],
        (err) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ message: "Lab logout recorded", time: currentTime });
        }
    );
});

// --- HISTORY ---
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

// --- ANNOUNCEMENTS ---
app.get("/announcements", (req, res) => {
    db.all(`SELECT * FROM announcements ORDER BY id DESC`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- ADMIN ENDPOINTS ---

// Dashboard stats: registered students, current sit-ins, total sit-ins, chart data
app.get("/admin/dashboard-data", (req, res) => {
    db.get(`SELECT COUNT(*) as count FROM users WHERE idNumber != 'Admin'`, (err, r) => {
        db.get(`SELECT COUNT(*) as count FROM reservations WHERE (timeOut IS NULL OR timeOut = '') AND (status = 'Active' OR status IS NULL)`, (err, c) => {
            db.get(`SELECT COUNT(*) as count FROM reservations WHERE status = 'Active' OR status IS NULL`, (err, t) => {
                db.all(`SELECT purpose, COUNT(*) as count FROM reservations GROUP BY purpose`, (err, p) => {
                    res.json({
                        registered:   r?.count || 0,
                        currentSitin: c?.count || 0,
                        totalSitin:   t?.count || 0,
                        chartData:    p || []
                    });
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
    db.run(`DELETE FROM announcements WHERE id = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: "Announcement not found" });
        res.json({ message: "Announcement deleted successfully" });
    });
});

app.get("/admin/students", (req, res) => {
    db.all(
        `SELECT idNumber, firstName, lastName, course, yearLevel, remainingSession FROM users WHERE idNumber != 'Admin' ORDER BY lastName ASC`,
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.delete("/admin/students/:idNumber", (req, res) => {
    const idNumber = req.params.idNumber;
    console.log("Delete request received for ID:", idNumber);
    db.run(`DELETE FROM users WHERE idNumber = ?`, [idNumber], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ message: "Student not found" });
        res.json({ message: "Student deleted successfully" });
    });
});

app.post("/admin/reset-sessions", (req, res) => {
    db.run(`UPDATE users SET remainingSession = 30 WHERE idNumber != 'Admin'`, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "All sessions reset to 30." });
    });
});

app.post("/admin/reset-single-student", (req, res) => {
    const { idNumber } = req.body;
    db.run(`UPDATE users SET remainingSession = 30 WHERE idNumber = ?`, [idNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: `Sessions reset for ${idNumber}` });
    });
});

// --- SIT-IN REPORTS ---
app.get("/admin/reports", (req, res) => {
    const filterDate = req.query.date;
    let sql = `
        SELECT 
            r.idNumber, u.firstName, u.lastName,
            r.purpose, r.lab, r.pcNumber,
            r.timeIn, r.timeOut, r.date
        FROM reservations r
        JOIN users u ON r.idNumber = u.idNumber
        WHERE (r.status = 'Active' OR r.status IS NULL)
    `;
    let params = [];
 
    if (filterDate) {
        sql += ` AND r.date = ?`;
        params.push(filterDate);
    }
 
    sql += ` ORDER BY r.date DESC, r.timeIn DESC`;
 
    db.all(sql, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
 
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});