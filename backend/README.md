# SignBridge API

FastAPI + MySQL backend for the SignBridge accessibility classroom.

## 1. Create the MySQL database

```sql
CREATE DATABASE signbridge CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

## 2. Setup

Windows PowerShell:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your MySQL credentials.

## 3. Run

```powershell
uvicorn app.main:app --reload --port 8000
```

API docs: `http://localhost:8000/docs`

For a quick frontend demo without MySQL, leave `DATABASE_URL` unset and the API uses SQLite.

## Main endpoints

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/classes`
- `GET /api/classes`
- `POST /api/classes/{id}/end`
- `POST /api/transcripts`
- `POST /api/recognitions`
- `GET /api/classes/{id}/activity`
- `GET /api/teachers/{teacher_id}/dashboard`
- `GET /health`
