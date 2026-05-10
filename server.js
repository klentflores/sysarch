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
        date TEXT,
        status TEXT DEFAULT 'Active'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        author TEXT,
        content TEXT,
        date TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        idNumber TEXT,
        lab TEXT,
        message TEXT,
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

// --- STUDENT SEARCH: partial match by idNumber, firstName, or lastName ---
app.get("/search-students", (req, res) => {
    const query = req.query.q ? `%${req.query.q}%` : '%';
    const sql = `
        SELECT idNumber, firstName, lastName, course, yearLevel, remainingSession
        FROM users
        WHERE idNumber != 'Admin'
          AND (idNumber LIKE ? OR firstName LIKE ? OR lastName LIKE ?)
        ORDER BY lastName ASC
        LIMIT 10
    `;
    db.all(sql, [query, query, query], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- SIT-IN: Get ALL sit-in records (for viewsitin.html) ---
app.get("/get-all-sitin", (req, res) => {
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
        WHERE r.status NOT IN ('Pending', 'Accepted', 'Denied')
        ORDER BY r.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
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
    const date   = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

    db.get(`SELECT remainingSession FROM users WHERE idNumber = ?`, [idNumber], (err, user) => {
        if (err) return res.status(500).send("Database error");
        if (!user) return res.status(404).send("Student ID not found!");
        if (user.remainingSession <= 0) return res.status(400).send("No remaining sessions!");

        const sql = `INSERT INTO reservations (idNumber, purpose, lab, timeIn, date, status) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(sql, [idNumber, purpose, lab, timeIn, date, 'Active'], function (err) {
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
        AND r.status NOT IN ('Pending', 'Accepted', 'Denied')
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

app.post("/make-reservation", (req, res) => {
    const { idNumber, studentName, purpose, lab, pcNumber, timeIn, date } = req.body;

    db.get(`SELECT remainingSession FROM users WHERE idNumber = ?`, [idNumber], (err, user) => {
        if (err) return res.status(500).json({ message: "Database error" });
        if (!user) return res.status(404).json({ message: "Student ID not found!" });
        
        if (user.remainingSession <= 0) return res.status(400).json({ message: "No sessions left!" });

        const sql = `INSERT INTO reservations (idNumber, studentName, purpose, lab, pcNumber, timeIn, date, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
        db.run(sql, [idNumber, studentName || '', purpose, lab, pcNumber || '', timeIn, date, 'Pending'], function (err) {
            if (err) return res.status(500).json({ message: err.message });

            res.json({ message: "Reservation submitted! Awaiting admin approval." });
        });
    });
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

// --- HISTORY (sit-in records only, NOT reservation requests) ---
app.get("/history/:idNumber", (req, res) => {
    const sql = `
        SELECT 
            r.*, 
            u.firstName, 
            u.lastName 
        FROM reservations r
        JOIN users u ON r.idNumber = u.idNumber
        WHERE r.idNumber = ?
        AND (r.status = 'Active' OR r.status IS NULL OR r.timeOut IS NOT NULL OR r.timeOut != '')
        AND r.status NOT IN ('Pending', 'Accepted', 'Denied')
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
        db.get(`SELECT COUNT(*) as count FROM reservations WHERE timeOut IS NULL OR timeOut = ''`, (err, c) => {
            db.get(`SELECT COUNT(*) as count FROM reservations`, (err, t) => {
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
            r.idNumber, 
            u.firstName, 
            u.lastName, 
            r.purpose, 
            r.lab, 
            r.timeIn, 
            r.timeOut, 
            r.date 
        FROM reservations r
        JOIN users u ON r.idNumber = u.idNumber
        WHERE r.status NOT IN ('Pending', 'Accepted', 'Denied')
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

// --- SUBMIT FEEDBACK ---s
app.post("/api/feedback", (req, res) => {
    const { idNumber, lab, message } = req.body;
    const date = new Date().toLocaleDateString();

    if (!idNumber || !message) {
        return res.status(400).json({ error: "Missing required fields" });
    }

    const sql = `INSERT INTO feedback (idNumber, lab, message, date) VALUES (?, ?, ?, ?)`;
    db.run(sql, [idNumber, lab, message, date], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Feedback submitted successfully!", id: this.lastID });
    });
});

app.get("/api/feedback", (req, res) => {
    db.all(`SELECT * FROM feedback ORDER BY id DESC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.delete("/api/feedback/:id", (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM feedback WHERE id = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Feedback deleted" });
    });
});

// --- ADMIN: GET ALL RESERVATIONS ---
app.get("/admin/reservations", (req, res) => {
    const sql = `
        SELECT 
            r.id,
            r.idNumber,
            r.studentName,
            r.purpose,
            r.lab,
            r.pcNumber,
            r.timeIn,
            r.timeOut,
            r.date,
            r.status
        FROM reservations r
        WHERE r.status IN ('Pending', 'Accepted', 'Denied')
        ORDER BY r.id DESC
    `;
    db.all(sql, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// --- ADMIN: UPDATE RESERVATION STATUS (Accept / Deny) ---
app.post("/admin/update-reservation", (req, res) => {
    const { id, status } = req.body;
    const createdAt = new Date().toLocaleString();

    db.get(`SELECT * FROM reservations WHERE id = ?`, [id], (err, rev) => {
        if (err) return res.status(500).json({ message: "DB error" });
        if (!rev) return res.status(404).json({ message: "Reservation not found" });

        db.run(`UPDATE reservations SET status = ? WHERE id = ?`, [status, id], function (err) {
            if (err) return res.status(500).json({ message: err.message });

            if (status === 'Accepted') {
                // Deduct one session from the student
                db.run(`UPDATE users SET remainingSession = remainingSession - 1 WHERE idNumber = ?`, [rev.idNumber]);

                // Insert a NEW sit-in record so it shows in sitin.html / viewsitin.html / history.html
                const timeIn = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const date   = new Date().toLocaleDateString('en-CA');
                db.run(
                    `INSERT INTO reservations (idNumber, purpose, lab, timeIn, date, status) VALUES (?, ?, ?, ?, ?, 'Active')`,
                    [rev.idNumber, rev.purpose, rev.lab, timeIn, date],
                    (err) => {
                        if (err) console.error("Sit-in insert error:", err.message);
                    }
                );
            }

            // Notify the student either way
            const msg = status === 'Accepted'
                ? `✅ Your reservation for Lab ${rev.lab} (PC: ${rev.pcNumber || 'N/A'}) on ${rev.date} at ${rev.timeIn} has been ACCEPTED. You may now proceed to the lab.`
                : `❌ Your reservation for Lab ${rev.lab} (PC: ${rev.pcNumber || 'N/A'}) on ${rev.date} at ${rev.timeIn} has been DENIED.`;

            db.run(
                `INSERT INTO notifications (idNumber, reservationId, message, isRead, createdAt) VALUES (?, ?, ?, 0, ?)`,
                [rev.idNumber, id, msg, createdAt],
                (err) => {
                    if (err) console.error("Notification insert error:", err.message);
                }
            );

            res.json({ message: `Reservation ${status} successfully.` });
        });
    });
});

// --- STUDENT: GET NOTIFICATIONS ---
app.get("/notifications/:idNumber", (req, res) => {
    db.all(
        `SELECT * FROM notifications WHERE idNumber = ? ORDER BY id DESC`,
        [req.params.idNumber],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// --- STUDENT: MARK NOTIFICATION AS READ ---
app.post("/notifications/read/:id", (req, res) => {
    db.run(`UPDATE notifications SET isRead = 1 WHERE id = ?`, [req.params.id], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Marked as read" });
    });
});

// --- STUDENT: MARK ALL NOTIFICATIONS AS READ ---
app.post("/notifications/read-all/:idNumber", (req, res) => {
    db.run(`UPDATE notifications SET isRead = 1 WHERE idNumber = ?`, [req.params.idNumber], (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "All marked as read" });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});