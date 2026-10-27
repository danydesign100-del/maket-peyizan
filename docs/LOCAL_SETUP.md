# Local Database Setup (Non-Supabase)

This guide explains how to run Maket Peyizan with a local SQLite database instead of Supabase.

## Overview

The local setup uses:
- **SQLite** (via sql.js - no Docker required)
- **Node.js/Express** backend server for authentication and API
- **JWT tokens** for authentication (instead of Supabase Auth)

## Prerequisites

- Node.js 18+ installed
- npm or yarn installed

## Quick Start

### 1. Install Backend Dependencies

```bash
cd server
npm install
```

### 2. Initialize the Database

```bash
cd server
npm run init-db
```

This creates or updates `server/maket-peyizan.db` with all tables and initial data. It also resets the local preview account password to the documented value; it must never be used for production data.

### 3. Configure Environment Variables

Copy the example environment file:

```bash
# Copy to .env.local (ignored by git)
cp .env.local.example .env.local
```

Edit `.env.local` if needed (defaults should work for local development):

```env
API_URL=http://localhost:3001
PORT=3001
JWT_SECRET=your-secret-key-change-in-production
VITE_USE_LOCAL_DB=true
```

### 4. Start the Backend Server

```bash
cd server
npm start
```

The API server will run on `http://localhost:3001`

### 5. Start the Frontend

In a new terminal:

```bash
# Install frontend dependencies (if not already done)
npm install

# Start the development server
npm run dev
```

The frontend will run on `http://localhost:5173` (or another port if 5173 is in use)

## Default Login

The database is initialized with a default admin user:

- **Email:** `admin@maketpeyizan.com`
- **Password:** `admin123`

⚠️ **Important:** Change this password immediately in production!

## Database Schema

The local database schema is created by `server/init-db.js`:

- All tables from the original Supabase schema
- Chart of accounts for Haiti
- Default roles (director, accountant, cashier, stock_manager)
- Initial settings and configuration

The database file is stored at `server/maket-peyizan.db`.

## API Endpoints

### Authentication

- `POST /auth/login` - Login with email and password
- `GET /auth/me` - Get current user profile
- `POST /rpc/complete_sale` - Process a sale
- `POST /query` - Execute SELECT queries

### RPC Functions

Available RPC functions (called via `/rpc/{functionName}`):

- `complete_sale` - Process a sale

## Switching Between Local and Supabase

To switch between local database and Supabase, set the environment variable:

```env
# Use local database
VITE_USE_LOCAL_DB=true

# Use Supabase
VITE_USE_LOCAL_DB=false
```

Then restart the frontend development server.

## Development Workflow

### Adding New Tables

1. Add the table definition to `server/init-db.js`
2. Reinitialize the database: `cd server && npm run init-db`
3. This will recreate the database file with the new schema

### Adding New RPC Functions

1. Add the function to `server/server.js`
2. Restart the backend server: `cd server && npm start`
3. Call from frontend using `localApi.rpc('functionName', params)`

### Resetting the Database

```bash
# Delete the database file
rm server/maket-peyizan.db

# Reinitialize
cd server && npm run init-db
```

## Troubleshooting

### Backend Server Won't Start

- Check that Node.js is installed: `node --version`
- Check that dependencies are installed: `cd server && npm install`
- Check the port is not in use: Change `PORT` in `.env.local`

### Frontend Can't Connect to Backend

- Verify the backend is running: `curl http://localhost:3001/health`
- Check `API_URL` in `.env.local` matches the backend port
- Check browser console for CORS errors

### Database Issues

- If the database file is corrupted, delete it and run `npm run init-db` again
- The database is automatically saved every 30 seconds

## Security Notes

⚠️ **This is a development setup. For production:**

1. Change the default admin password
2. Use a strong `JWT_SECRET`
3. Enable SSL/TLS for the backend
4. Implement rate limiting
5. Add input validation and sanitization
6. Use environment-specific configurations
7. Consider using a proper database (PostgreSQL) for production

## File Structure

```
maket-peyizan/
├── server/
│   ├── package.json            # Backend dependencies
│   ├── server.js              # Express API server
│   ├── init-db.js             # Database initialization script
│   └── maket-peyizan.db       # SQLite database file (created after init)
├── src/
│   ├── lib/
│   │   ├── localApi.ts         # Local API client
│   │   └── supabase.ts        # Supabase client (for comparison)
│   └── contexts/
│       └── AuthContext.tsx    # Auth context (supports both)
└── .env.local.example         # Environment variables template
```

## Additional Resources

- [SQLite Documentation](https://www.sqlite.org/docs.html)
- [sql.js Documentation](https://sql.js.org/)
- [Express.js Documentation](https://expressjs.com/)
