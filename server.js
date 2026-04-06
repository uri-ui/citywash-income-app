const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(__dirname));

// Database initialization
const db = new sqlite3.Database(path.join(__dirname, 'citywash.db'), (err) => {
  if (err) console.error('Database error:', err);
  else console.log('✅ Database connected');
});

// Create tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT UNIQUE NOT NULL,
    company_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    otp_code TEXT,
    otp_expires INTEGER,
    otp_used INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(branch_id) REFERENCES branches(id)
  )`);

  // Companies table
  db.run(`CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  // Branches table
  db.run(`CREATE TABLE IF NOT EXISTS branches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company_id INTEGER NOT NULL,
    FOREIGN KEY(company_id) REFERENCES companies(id)
  )`);

  // Income types table
  db.run(`CREATE TABLE IF NOT EXISTS income_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL
  )`);

  // Income table
  db.run(`CREATE TABLE IF NOT EXISTS income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    company_id INTEGER NOT NULL,
    branch_id INTEGER NOT NULL,
    income_type_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    include_vat INTEGER DEFAULT 1,
    amount_without_vat REAL,
    vat_amount REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(company_id) REFERENCES companies(id),
    FOREIGN KEY(branch_id) REFERENCES branches(id),
    FOREIGN KEY(income_type_id) REFERENCES income_types(id)
  )`);

  console.log('✅ Tables created');
});

// ==================== API Routes ====================

// 1. Send OTP
app.post('/api/send-otp', (req, res) => {
  const { phone } = req.body;

  if (!phone) return res.status(400).json({ error: 'Phone number required' });

  const otp_code = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_expires = Date.now() + 5 * 60 * 1000; // 5 minutes

  // First check if user exists
  db.get('SELECT id FROM users WHERE phone = ?', [phone], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    if (user) {
      // User exists - UPDATE
      db.run(
        'UPDATE users SET otp_code = ?, otp_expires = ?, otp_used = 0 WHERE phone = ?',
        [otp_code, otp_expires, phone],
        (err) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          console.log(`📱 OTP for ${phone}: ${otp_code}`);
          // For development/testing: include OTP in response (never do this in production!)
          res.json({ success: true, message: 'OTP sent', otp_code: otp_code });
        }
      );
    } else {
      // User doesn't exist - INSERT (with default values)
      db.run(
        'INSERT INTO users (phone, name, company_id, branch_id, otp_code, otp_expires, otp_used) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [phone, 'User', 1, 1, otp_code, otp_expires, 0],
        (err) => {
          if (err) return res.status(500).json({ error: 'Database error' });
          console.log(`📱 OTP for ${phone}: ${otp_code}`);
          // For development/testing: include OTP in response (never do this in production!)
          res.json({ success: true, message: 'OTP sent', otp_code: otp_code });
        }
      );
    }
  });
});

// 2. Verify OTP
app.post('/api/verify-otp', (req, res) => {
  const { phone, otp_code } = req.body;

  if (!phone || !otp_code) return res.status(400).json({ error: 'Phone and OTP required' });

  // Convert otp_code to string and trim
  const cleanOtp = otp_code.toString().trim();

  console.log(`🔐 Verifying OTP for ${phone}: received ${cleanOtp}`);

  db.get(
    'SELECT * FROM users WHERE phone = ?',
    [phone],
    (err, user) => {
      if (err) {
        console.error('DB error:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        console.log(`❌ User not found: ${phone}`);
        return res.status(401).json({ error: 'Invalid OTP' });
      }

      console.log(`📋 User found: ${user.phone}, stored OTP: ${user.otp_code}, expires: ${user.otp_expires}, now: ${Date.now()}, used: ${user.otp_used}`);

      // Check if OTP was already used
      if (user.otp_used === 1) {
        console.log(`❌ OTP already used for ${phone}`);
        return res.status(401).json({ error: 'Invalid OTP' });
      }

      // Check OTP and expiration
      if (user.otp_code !== cleanOtp) {
        console.log(`❌ OTP mismatch: stored=${user.otp_code}, received=${cleanOtp}`);
        return res.status(401).json({ error: 'Invalid OTP' });
      }

      if (user.otp_expires < Date.now()) {
        console.log(`❌ OTP expired: ${user.otp_expires} < ${Date.now()}`);
        return res.status(401).json({ error: 'Invalid OTP' });
      }

      console.log(`✅ OTP valid for ${phone}`);

      // Mark OTP as used (don't delete it, keep for audit trail)
      db.run('UPDATE users SET otp_used = 1 WHERE id = ?', [user.id], (err) => {
        if (err) {
          console.error('Error marking OTP as used:', err);
        } else {
          console.log(`🔒 OTP marked as used for ${phone}`);
        }
      });

      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          phone: user.phone,
          company_id: user.company_id,
          branch_id: user.branch_id
        }
      });
    }
  );
});

// 3. Add income
app.post('/api/income', (req, res) => {
  const { user_id, company_id, branch_id, income_type_id, amount, include_vat } = req.body;

  if (!user_id || !company_id || !branch_id || !income_type_id || !amount) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const amount_without_vat = include_vat ? amount / 1.18 : amount;
  const vat_amount = amount - amount_without_vat;

  db.run(
    `INSERT INTO income (user_id, company_id, branch_id, income_type_id, amount, include_vat, amount_without_vat, vat_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [user_id, company_id, branch_id, income_type_id, amount, include_vat ? 1 : 0, amount_without_vat, vat_amount],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 4. Get reports - Total income by month
app.get('/api/reports/total', (req, res) => {
  const { month, year } = req.query;

  const query = `
    SELECT 
      SUM(amount_without_vat) as total_without_vat,
      SUM(vat_amount) as total_vat,
      SUM(amount) as total_with_vat,
      COUNT(*) as transaction_count
    FROM income
    WHERE strftime('%m', created_at) = ? AND strftime('%Y', created_at) = ?
  `;

  db.get(query, [month.padStart(2, '0'), year], (err, row) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(row);
  });
});

// 5. Get reports - By company
app.get('/api/reports/by-company', (req, res) => {
  const { month, year } = req.query;

  const query = `
    SELECT 
      c.id,
      c.name,
      SUM(i.amount_without_vat) as total_without_vat,
      SUM(i.amount) as total_with_vat,
      COUNT(*) as transaction_count
    FROM income i
    JOIN companies c ON i.company_id = c.id
    WHERE strftime('%m', i.created_at) = ? AND strftime('%Y', i.created_at) = ?
    GROUP BY c.id, c.name
    ORDER BY total_with_vat DESC
  `;

  db.all(query, [month.padStart(2, '0'), year], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

// 6. Get reports - By branch
app.get('/api/reports/by-branch', (req, res) => {
  const { month, year } = req.query;

  const query = `
    SELECT 
      b.id,
      b.name,
      c.name as company_name,
      SUM(i.amount_without_vat) as total_without_vat,
      SUM(i.amount) as total_with_vat,
      COUNT(*) as transaction_count
    FROM income i
    JOIN branches b ON i.branch_id = b.id
    JOIN companies c ON i.company_id = c.id
    WHERE strftime('%m', i.created_at) = ? AND strftime('%Y', i.created_at) = ?
    GROUP BY b.id, b.name, c.name
    ORDER BY total_with_vat DESC
  `;

  db.all(query, [month.padStart(2, '0'), year], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

// 7. Get companies
app.get('/api/companies', (req, res) => {
  db.all('SELECT * FROM companies ORDER BY name', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

// 8. Get branches by company
app.get('/api/branches/:company_id', (req, res) => {
  const { company_id } = req.params;
  db.all('SELECT * FROM branches WHERE company_id = ? ORDER BY name', [company_id], (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

// 9. Get income types
app.get('/api/income-types', (req, res) => {
  db.all('SELECT * FROM income_types ORDER BY name', (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows || []);
  });
});

// 10. Import data from Excel
app.post('/api/import-data', (req, res) => {
  const { data, userId } = req.body;

  if (!data || !Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: 'No data provided' });
  }

  if (!userId) {
    return res.status(400).json({ error: 'User ID required' });
  }

  // Mapping for company names
  const companyMapping = {
    'אבת': 'אבת שירותי שטיפה',
    'Jacobs': 'ג\'ייקובס',
    'ג\'ייקובס': 'ג\'ייקובס',
    'UBR': 'יו בי אר',
    'יו בי אר': 'יו בי אר',
    'בי יו איי': 'בי יו איי',
    'א.א רכב ורכש': 'א.א.רכב וסחר',
    'א.א.רכב וסחר': 'א.א.רכב וסחר',
    'אבי': 'א.ב.י.',
    'א.ב.י.': 'א.ב.י.',
    'זכיין': 'רמי מרדכייב - זכיין',
    'BUI CAR WASH': 'BUI CAR WASH'
  };

  // Mapping for income type names
  const incomeTypeMapping = {
    'קופה': 'קופה רושמת',
    'מנויים': 'הכנסה ממנויים',
    'שטיפומט': 'שטיפומט',
    'פזומט': 'פזומט',
    'אפליקציה': 'אפליקציה',
    'שואב': 'מכונות אוטומטיות - שואבים וקיוסק',
    'wash point': 'קופה רושמת',
    'הסדרים': 'הכנסה ממנויים',
    'וושלי': 'קופה רושמת'
  };

  let importedCount = 0;
  let errorCount = 0;
  const errors = [];

  // Get company and branch info for mapping
  const processData = () => {
    db.all('SELECT id, name FROM companies', (err, companies) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to load companies' });
      }

      db.all('SELECT id, name, company_id FROM branches', (err, branches) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to load branches' });
        }

        db.all('SELECT id, name FROM income_types', (err, incomeTypes) => {
          if (err) {
            return res.status(500).json({ error: 'Failed to load income types' });
          }

          // Create mappings
          const companyMap = {};
          companies.forEach(c => {
            companyMap[c.name] = c.id;
          });

          const branchMap = {};
          branches.forEach(b => {
            branchMap[`${b.name}|${b.company_id}`] = b.id;
          });

          const incomeTypeMap = {};
          incomeTypes.forEach(t => {
            incomeTypeMap[t.name] = t.id;
          });

          // Process each data row
          data.forEach((row, index) => {
            try {
              const excelCompanyName = row.company_name?.trim();
              const mappedCompanyName = companyMapping[excelCompanyName] || excelCompanyName;
              const companyId = companyMap[mappedCompanyName];

              const branchName = row.branch_name?.trim();
              const branchKey = `${branchName}|${companyId}`;
              const branchId = branchMap[branchKey];

              const excelIncomeType = row.income_type?.trim();
              const mappedIncomeType = incomeTypeMapping[excelIncomeType] || excelIncomeType;
              const incomeTypeId = incomeTypeMap[mappedIncomeType];

              const amount = parseFloat(row.amount);
              const includeVat = row.include_vat !== false ? 1 : 0;

              if (!companyId || !branchId || !incomeTypeId || isNaN(amount)) {
                errorCount++;
                errors.push(`Row ${index + 1}: Missing mapping - Company: ${companyId}, Branch: ${branchId}, Type: ${incomeTypeId}`);
                return;
              }

              const amount_without_vat = includeVat ? amount / 1.18 : amount;
              const vat_amount = amount - amount_without_vat;

              db.run(
                `INSERT INTO income (user_id, company_id, branch_id, income_type_id, amount, include_vat, amount_without_vat, vat_amount)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, companyId, branchId, incomeTypeId, amount, includeVat, amount_without_vat, vat_amount],
                (err) => {
                  if (err) {
                    errorCount++;
                    errors.push(`Row ${index + 1}: ${err.message}`);
                  } else {
                    importedCount++;
                  }
                }
              );
            } catch (err) {
              errorCount++;
              errors.push(`Row ${index + 1}: ${err.message}`);
            }
          });

          // Send response after a short delay to allow insertions
          setTimeout(() => {
            res.json({
              success: true,
              imported: importedCount,
              errors: errorCount,
              errorDetails: errors.slice(0, 10) // Show first 10 errors
            });
          }, 500);
        });
      });
    });
  };

  processData();
});

// ==================== Database Seeding ====================

// Seed companies and branches
const seedData = () => {
  const companies = [
    { id: 1, name: 'אבת שירותי שטיפה' },
    { id: 2, name: 'ג\'ייקובס' },
    { id: 3, name: 'יו בי אר' },
    { id: 4, name: 'בי יו איי' },
    { id: 5, name: 'א.א.רכב וסחר' },
    { id: 6, name: 'א.ב.י.' },
    { id: 7, name: 'רמי מרדכייב - זכיין' },
    { id: 8, name: 'BUI CAR WASH' }
  ];

  const branches = [
    { company_id: 1, name: 'באר שבע' },
    { company_id: 1, name: 'דור אלון' },
    { company_id: 1, name: 'נחלים' },
    { company_id: 1, name: 'חדרה' },
    { company_id: 2, name: 'רמת גן' },
    { company_id: 2, name: 'אשדוד' },
    { company_id: 2, name: 'אשקלון' },
    { company_id: 3, name: 'חולון' },
    { company_id: 4, name: 'כפר סבא' },
    { company_id: 5, name: 'קרית גת' },
    { company_id: 6, name: 'מודיעין ליגד' },
    { company_id: 7, name: 'פתח תקווה געש' },
    { company_id: 8, name: 'כפר סבא' },
    { company_id: 1, name: 'באר יעקב' },
    { company_id: 1, name: 'בית דגן' },
    { company_id: 1, name: 'גבעת שמואל' },
    { company_id: 1, name: 'גדרה' },
    { company_id: 1, name: 'המפגש' },
    { company_id: 2, name: 'חבצלת השרון' },
    { company_id: 2, name: 'יבנה' },
    { company_id: 3, name: 'ירושלים' },
    { company_id: 3, name: 'ישפרו מודיעין' },
    { company_id: 3, name: 'כרמיאל' },
    { company_id: 4, name: 'ליגד מודיעין' },
    { company_id: 5, name: 'מזכרת בתיה' },
    { company_id: 6, name: 'מנטה' },
    { company_id: 7, name: 'נס ציונה' },
    { company_id: 8, name: 'סער' },
    { company_id: 8, name: 'עכו' },
    { company_id: 2, name: 'פרדס חנה' },
    { company_id: 3, name: 'צפריה' },
    { company_id: 1, name: 'קרית מלאכי' },
    { company_id: 6, name: 'ראשון לציון' },
    { company_id: 1, name: 'רעננה' },
    { company_id: 5, name: 'שדי חמד' }
  ];

  const incomeTypes = [
    { id: 1, name: 'קופה רושמת' },
    { id: 2, name: 'הכנסה ממנויים' },
    { id: 3, name: 'שטיפומט' },
    { id: 4, name: 'פזומט' },
    { id: 5, name: 'פנגו' },
    { id: 6, name: 'אפליקציה' },
    { id: 7, name: 'מכונות אוטומטיות - שואבים וקיוסק' },
    { id: 8, name: 'wash point' },
    { id: 9, name: 'הסדרים' }
  ];

  // Check if already seeded
  db.get('SELECT COUNT(*) as count FROM companies', (err, row) => {
    if (row && row.count === 0) {
      companies.forEach(c => {
        db.run('INSERT INTO companies (id, name) VALUES (?, ?)', [c.id, c.name]);
      });
      branches.forEach(b => {
        db.run('INSERT INTO branches (company_id, name) VALUES (?, ?)', [b.company_id, b.name]);
      });
      incomeTypes.forEach(t => {
        db.run('INSERT INTO income_types (id, name) VALUES (?, ?)', [t.id, t.name]);
      });
      console.log('✅ Database seeded');
    }
  });
};

setTimeout(seedData, 500);

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`📱 Open your browser to: http://localhost:${PORT}\n`);
});
