# 🚀 AIO Asistan Backend API

Production-ready backend API for AIO Asistan - Turkey's AI Voice Assistant Platform.

## 📋 Table of Contents
- [Quick Start](#quick-start)
- [Frontend Integration Guide](#frontend-integration-guide)
- [API Endpoints](#api-endpoints)
- [Authentication](#authentication)
- [Error Handling](#error-handling)

---

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Environment Variables
```env
DATABASE_URL=postgresql://user:pass@host:5432/db
JWT_SECRET=your-super-secret-key
PORT=3000
NODE_ENV=production

# Paynet
PAYNETEASY_ENABLE_PRODUCTION=true
PAYNETEASY_SECRET_KEY=sck_xxx
PAYNETEASY_PUBLIC_KEY=pbk_xxx

# Verimor
VERIMOR_BASE_URL=https://api.bulutsantralim.com
VERIMOR_USERNAME=xxx
VERIMOR_PASSWORD=xxx
```

---

## 🎯 Frontend Integration Guide

Base URL: `https://api.aioasistan.com/api`

### 1. Authentication

#### Login
```typescript
// POST /api/auth/login
const login = async (email: string, password: string) => {
  const response = await fetch('https://api.aioasistan.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  // { token: "eyJhbG...", tenant: { id, slug, name } }
  
  // Store token
  localStorage.setItem('token', data.token);
  return data;
};
```

#### Signup (New User Registration)
```typescript
// POST /api/public/signup
const signup = async (formData: {
  businessName: string;
  contactEmail: string;
  websiteUrl?: string;
  industry?: string;
  planId: string; // 'starter' | 'pro' | 'enterprise'
}) => {
  const response = await fetch('https://api.aioasistan.com/api/public/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  });
  
  const data = await response.json();
  // {
  //   success: true,
  //   token: "eyJhbG...",
  //   tenant: { id, name, slug, email },
  //   temporaryPassword: "abc12345",
  //   phoneNumber: "+908501234567",  // Assigned Verimor DID
  //   assignmentType: "verimor"
  // }
  
  return data;
};
```

### 2. Dashboard Data

```typescript
// GET /api/me (requires auth)
const getDashboard = async () => {
  const token = localStorage.getItem('token');
  
  const response = await fetch('https://api.aioasistan.com/api/me', {
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });
  
  const data = await response.json();
  // {
  //   tenant: { name, email, phone_number, slug },
  //   quota: { monthly_message_limit: 5000, current_message_count: 150 },
  //   agent: { name, model, twilio_phone_number }
  // }
  
  return data;
};
```

### 3. Agent Management

```typescript
// GET /api/agent (requires auth)
const getAgent = async () => {
  const token = localStorage.getItem('token');
  
  const response = await fetch('https://api.aioasistan.com/api/agent', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  return response.json();
  // { name, role_type, system_prompt, model, temperature }
};

// PUT /api/agent (requires auth)
const updateAgent = async (agentData: {
  name: string;
  system_prompt: string;
  model: string;
  temperature: number;
  role_type: string;
}) => {
  const token = localStorage.getItem('token');
  
  const response = await fetch('https://api.aioasistan.com/api/agent', {
    method: 'PUT',
    headers: { 
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(agentData)
  });
  
  return response.json();
};
```

### 4. Payment / Billing

```typescript
// POST /api/billing/checkout
const checkout = async (planId: 'starter' | 'pro' | 'enterprise') => {
  const response = await fetch('https://api.aioasistan.com/api/billing/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId })
  });
  
  const data = await response.json();
  // { redirectUrl: "https://paynet.com.tr/pay/...", sessionId: "..." }
  
  // Redirect user to payment page
  window.location.href = data.redirectUrl;
};
```

### 5. React Hook Example

```typescript
// hooks/useApi.ts
import { useState, useEffect } from 'react';

const API_BASE = 'https://api.aioasistan.com/api';

export const useAuth = () => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    if (storedToken) {
      setToken(storedToken);
      fetchUser(storedToken);
    } else {
      setLoading(false);
    }
  }, []);

  const fetchUser = async (authToken: string) => {
    try {
      const res = await fetch(`${API_BASE}/me`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
      }
    } finally {
      setLoading(false);
    }
  };

  const login = async (email: string, password: string) => {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    if (!res.ok) throw new Error('Login failed');
    
    const data = await res.json();
    localStorage.setItem('token', data.token);
    setToken(data.token);
    await fetchUser(data.token);
    return data;
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
  };

  return { token, user, loading, login, logout };
};
```

---

## 📡 API Endpoints

### Public (No Auth Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | User login |
| POST | `/api/public/signup` | New user registration |
| POST | `/api/billing/checkout` | Start payment flow |
| POST | `/api/paynet/callback` | Payment webhook (Paynet) |
| GET/POST | `/api/verimor/incoming-call` | Voice webhook (Verimor) |

### Protected (JWT Required)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/me` | Get dashboard data |
| GET | `/api/agent` | Get agent details |
| PUT | `/api/agent` | Update agent settings |
| GET | `/api/health` | Health check |

---

## 🔐 Authentication

All protected endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Token expires in **7 days**.

---

## ⚠️ Error Handling

All errors return JSON with this structure:

```json
{
  "error": "Error message here"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request |
| 401 | Unauthorized |
| 404 | Not Found |
| 429 | Too Many Requests (Rate Limited) |
| 500 | Internal Server Error |

### Rate Limits

| Endpoint | Limit |
|----------|-------|
| General | 100 req / 15 min |
| Login | 10 req / 15 min |
| Payment | 5 req / 1 min |

---

## 🐳 Docker Deployment

```bash
# Build and run
docker-compose up -d --build

# View logs
docker-compose logs -f
```

---

## 📞 Verimor Integration

The backend handles incoming calls from Verimor Cloud PBX and forwards them to n8n for AI processing.

Webhook URL to configure in Verimor Panel:
```
https://api.aioasistan.com/api/verimor/incoming-call
```

---

## 📄 License

MIT © AIO Asistan
