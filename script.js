// Global state
let currentUser = null;
let companies = [];
let incomeTypes = [];

const API_URL = 'http://localhost:3000/api';

// ==================== Login Functions ====================

document.getElementById('sendOtpBtn').addEventListener('click', async () => {
  const phone = document.getElementById('phoneInput').value;

  if (!phone) {
    showStatus('loginScreen', 'אנא הכנס מספר טלפון', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'שגיאה בשליחת OTP');

    // For development: display OTP code to user
    if (data.otp_code) {
      showStatus('loginScreen', `קוד OTP: ${data.otp_code}`, 'success');
      document.getElementById('otpInput').placeholder = `הכנס את הקוד: ${data.otp_code}`;
    } else {
      showStatus('loginScreen', 'קוד OTP נשלח בהצלחה!', 'success');
    }

    document.getElementById('otpSection').style.display = 'block';
  } catch (error) {
    showStatus('loginScreen', 'שגיאה: ' + error.message, 'error');
  }
});

document.getElementById('verifyOtpBtn').addEventListener('click', async () => {
  const phone = document.getElementById('phoneInput').value;
  const otp_code = document.getElementById('otpInput').value;

  if (!otp_code || otp_code.length !== 6) {
    showStatus('loginScreen', 'אנא הכנס קוד 6 ספרות', 'error');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp_code })
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'שגיאה בהאמת קוד');

    currentUser = data.user;
    localStorage.setItem('user', JSON.stringify(currentUser));

    document.getElementById('userDisplay').textContent = `שלום, ${currentUser.name}`;
    switchScreen('mainScreen');
    await loadData();

  } catch (error) {
    showStatus('loginScreen', 'שגיאה: ' + error.message, 'error');
  }
});

document.getElementById('resendOtpBtn').addEventListener('click', () => {
  document.getElementById('sendOtpBtn').click();
});

// ==================== Logout ====================

document.getElementById('logoutBtn').addEventListener('click', () => {
  currentUser = null;
  localStorage.removeItem('user');
  
  document.getElementById('phoneInput').value = '';
  document.getElementById('otpInput').value = '';
  document.getElementById('otpSection').style.display = 'none';
  document.getElementById('otpStatus').textContent = '';
  
  switchScreen('loginScreen');
});

// ==================== Tab Navigation ====================

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tabName = btn.getAttribute('data-tab');
    
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    
    btn.classList.add('active');
    document.getElementById(tabName + 'Tab').classList.add('active');
  });
});

// ==================== Income Form ====================

document.getElementById('companySelect').addEventListener('change', async (e) => {
  const companyId = e.target.value;
  const branchSelect = document.getElementById('branchSelect');
  
  if (!companyId) {
    branchSelect.disabled = true;
    branchSelect.innerHTML = '<option value="">בחר סניף</option>';
    return;
  }

  branchSelect.disabled = false;

  try {
    const response = await fetch(`${API_URL}/branches/${companyId}`);
    const branches = await response.json();

    branchSelect.innerHTML = '<option value="">בחר סניף</option>';
    branches.forEach(branch => {
      const option = document.createElement('option');
      option.value = branch.id;
      option.textContent = branch.name;
      branchSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading branches:', error);
  }
});

// VAT Calculation
document.getElementById('amountInput').addEventListener('input', calculateVat);
document.getElementById('includeVatCheckbox').addEventListener('change', calculateVat);

function calculateVat() {
  const amount = parseFloat(document.getElementById('amountInput').value) || 0;
  const includeVat = document.getElementById('includeVatCheckbox').checked;

  let withoutVat, vat;
  
  if (includeVat) {
    withoutVat = amount / 1.18;
    vat = amount - withoutVat;
  } else {
    withoutVat = amount;
    vat = amount * 0.18;
  }

  document.getElementById('amountWithoutVat').textContent = withoutVat.toFixed(2);
  document.getElementById('vatAmount').textContent = vat.toFixed(2);
}

document.getElementById('incomeForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = {
    user_id: currentUser.id,
    company_id: parseInt(document.getElementById('companySelect').value),
    branch_id: parseInt(document.getElementById('branchSelect').value),
    income_type_id: parseInt(document.getElementById('incomeTypeSelect').value),
    amount: parseFloat(document.getElementById('amountInput').value),
    include_vat: document.getElementById('includeVatCheckbox').checked
  };

  try {
    const response = await fetch(`${API_URL}/income`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData)
    });

    if (!response.ok) throw new Error('שגיאה בשמירת הכנסה');

    showStatus('incomeTab', 'הכנסה נוספה בהצלחה! ✅', 'success');
    document.getElementById('incomeForm').reset();
    calculateVat();
    document.getElementById('branchSelect').disabled = true;

  } catch (error) {
    showStatus('incomeTab', 'שגיאה: ' + error.message, 'error');
  }
});

// ==================== Reports ====================

document.getElementById('generateReportBtn').addEventListener('click', generateReports);

async function generateReports() {
  const month = document.getElementById('reportMonth').value;
  const year = document.getElementById('reportYear').value;

  try {
    // Total report
    const totalRes = await fetch(`${API_URL}/reports/total?month=${month}&year=${year}`);
    const totalData = await totalRes.json();

    document.getElementById('totalWithoutVat').textContent = (totalData.total_without_vat || 0).toFixed(2);
    document.getElementById('totalVat').textContent = (totalData.total_vat || 0).toFixed(2);
    document.getElementById('totalWithVat').textContent = (totalData.total_with_vat || 0).toFixed(2);

    // By company report
    const companyRes = await fetch(`${API_URL}/reports/by-company?month=${month}&year=${year}`);
    const companyData = await companyRes.json();

    const companyTable = document.getElementById('byCompanyTable');
    companyTable.innerHTML = '';
    
    if (companyData.length > 0) {
      companyData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.name}</td>
          <td>${(row.total_without_vat || 0).toFixed(2)} ₪</td>
          <td>${(row.total_with_vat || 0).toFixed(2)} ₪</td>
          <td>${row.transaction_count}</td>
        `;
        companyTable.appendChild(tr);
      });
    } else {
      companyTable.innerHTML = '<tr><td colspan="4">אין נתונים</td></tr>';
    }

    // By branch report
    const branchRes = await fetch(`${API_URL}/reports/by-branch?month=${month}&year=${year}`);
    const branchData = await branchRes.json();

    const branchTable = document.getElementById('byBranchTable');
    branchTable.innerHTML = '';

    if (branchData.length > 0) {
      branchData.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${row.name}</td>
          <td>${row.company_name}</td>
          <td>${(row.total_without_vat || 0).toFixed(2)} ₪</td>
          <td>${(row.total_with_vat || 0).toFixed(2)} ₪</td>
          <td>${row.transaction_count}</td>
        `;
        branchTable.appendChild(tr);
      });
    } else {
      branchTable.innerHTML = '<tr><td colspan="5">אין נתונים</td></tr>';
    }

  } catch (error) {
    console.error('Error generating reports:', error);
  }
}

// ==================== Utility Functions ====================

function switchScreen(screenName) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenName).classList.add('active');
}

function showStatus(screenName, message, type) {
  const statusEl = document.getElementById(screenName === 'loginScreen' ? 'otpStatus' : 'incomeStatus');
  statusEl.textContent = message;
  statusEl.className = 'status ' + type;

  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className = 'status';
  }, 5000);
}

async function loadData() {
  try {
    const companiesRes = await fetch(`${API_URL}/companies`);
    companies = await companiesRes.json();

    const typesRes = await fetch(`${API_URL}/income-types`);
    incomeTypes = await typesRes.json();

    // Fill company select
    const companySelect = document.getElementById('companySelect');
    companySelect.innerHTML = '<option value="">בחר חברה</option>';
    companies.forEach(company => {
      const option = document.createElement('option');
      option.value = company.id;
      option.textContent = company.name;
      companySelect.appendChild(option);
    });

    // Fill income type select
    const typeSelect = document.getElementById('incomeTypeSelect');
    typeSelect.innerHTML = '<option value="">בחר סוג</option>';
    incomeTypes.forEach(type => {
      const option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.name;
      typeSelect.appendChild(option);
    });

    // Set current month and year
    const today = new Date();
    document.getElementById('reportMonth').value = String(today.getMonth() + 1).padStart(2, '0');
    document.getElementById('reportYear').value = today.getFullYear();

  } catch (error) {
    console.error('Error loading data:', error);
  }
}

// ==================== Initialize ====================

// Check if user is already logged in
window.addEventListener('load', () => {
  const savedUser = localStorage.getItem('user');
  if (savedUser) {
    currentUser = JSON.parse(savedUser);
    document.getElementById('userDisplay').textContent = `שלום, ${currentUser.name}`;
    switchScreen('mainScreen');
    loadData();
  }
});
