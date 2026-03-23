const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const cors = require("cors");

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json());

const db = new sqlite3.Database("klent.db", (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log("Connected to SQLite database.");
    }
});

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
    address TEXT
)
`);

app.post("/register", (req, res) => {
    console.log("DATA RECEIVED", req.body);
    const {
        idNumber,
        lastName,
        firstName,
        middleName,
        course,
        yearLevel,
        email,
        password,
        address,

    } = req.body;

    const sql = `
    INSERT INTO users (idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.run(sql, [idNumber, lastName, firstName, middleName, course, yearLevel, email, password, address], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        res.json({ message: "User registered successfully!" });
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// --- UPDATED LOGIN ROUTE --- //
app.post("/login", (req, res) => {
    const { loginInput, password } = req.body;
    const sql = `SELECT * FROM users WHERE email = ? OR idNumber = ?`;

    db.get(sql, [loginInput, loginInput], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });

        if (user && user.password === password) {
            res.json({ 
                message: "Login successful!", 
                user: user 
            });
        } else {
            res.status(401).json({ message: "Invalid credentials." });
        }
    });
});

app.post('/update-profile', (req, res) => {
    const { oldIdNumber, idNumber, lastName, firstName, middleName, yearLevel, course, email, address } = req.body;

    console.log(`Processing update for: ${oldIdNumber} -> ${idNumber}`);
    // ✅ To THIS
    const sql = `UPDATE users SET 
                idNumber = ?, lastName = ?, firstName = ?, middleName = ?, 
                yearLevel = ?, course = ?, email = ?, address = ? 
                WHERE idNumber = ?`;

    const params = [idNumber, lastName, firstName, middleName, yearLevel, course, email, address, oldIdNumber];

    db.run(sql, params, function(err) {
        if (err) {
            console.error("❌ Database Error:", err.message); 
            return res.status(500).json({ error: err.message });
        }
        
        if (this.changes === 0) {
            console.warn("⚠️ No record found with ID:", oldIdNumber);
            return res.status(404).json({ error: "Original student record not found." });
        }

        console.log("✅ Profile updated successfully!");
        res.json({ message: "Update successful!" });
    });
});



