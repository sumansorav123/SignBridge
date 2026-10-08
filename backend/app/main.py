from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict, EmailStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, create_engine, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker


class Settings(BaseSettings):
    database_url: str = "sqlite:///./signbridge.db"
    jwt_secret: str = "dev-only-change-me"
    access_token_minutes: int = 1440
    cors_origins: str = "http://localhost:5173,http://localhost:5500"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

settings = Settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

class Base(DeclarativeBase):
    pass

class Role(str, Enum):
    teacher = "teacher"
    student = "student"

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

class ClassSession(Base):
    __tablename__ = "class_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(180))
    code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

class Transcript(Base):
    __tablename__ = "transcripts"
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_sessions.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    text: Mapped[str] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="voice")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

class RecognitionResult(Base):
    __tablename__ = "recognition_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_sessions.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    sign: Mapped[str] = mapped_column(String(120))
    confidence: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

class Attendance(Base):
    __tablename__ = "attendance"
    id: Mapped[int] = mapped_column(primary_key=True)
    class_id: Mapped[int] = mapped_column(ForeignKey("class_sessions.id"), index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    left_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

Base.metadata.create_all(engine)

pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2 = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

app = FastAPI(title="SignBridge API", version="1.0.0", description="Accessibility-first classroom API")
app.add_middleware(CORSMiddleware, allow_origins=[x.strip() for x in settings.cors_origins.split(",") if x.strip()] or ["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

def db():
    session = SessionLocal()
    try: yield session
    finally: session.close()

def token_for(user: User):
    exp = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": str(user.id), "role": user.role, "exp": exp}, settings.jwt_secret, algorithm="HS256")

def current_user(token: str = Depends(oauth2), session: Session = Depends(db)) -> User:
    cred = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        uid = int(payload.get("sub"))
    except (JWTError, TypeError, ValueError): raise cred
    user = session.get(User, uid)
    if not user: raise cred
    return user

def require_role(role: Role):
    def checker(user: User = Depends(current_user)):
        if user.role != role.value: raise HTTPException(403, f"{role.value} access required")
        return user
    return checker

class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int; name: str; email: EmailStr; role: Role

class RegisterIn(BaseModel):
    name: str; email: EmailStr; password: str; role: Role
class LoginIn(BaseModel):
    email: EmailStr; password: str
class TokenOut(BaseModel):
    access_token: str; token_type: str = "bearer"; user: UserOut
class ClassCreate(BaseModel): title: str
class ClassOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int; teacher_id: int; title: str; code: str; status: str; started_at: datetime; ended_at: Optional[datetime] = None
class TranscriptIn(BaseModel): class_id: int; text: str; source: str = "voice"
class RecognitionIn(BaseModel): class_id: int; sign: str; confidence: float
class EventOut(BaseModel): id: int; message: str

@app.get("/health")
def health(session: Session = Depends(db)):
    session.execute(select(func.count(User.id)))
    return {"ok": True, "service": "signbridge-api", "database": "connected"}

@app.post("/api/auth/register", response_model=TokenOut)
def register(data: RegisterIn, session: Session = Depends(db)):
    if len(data.password) < 6: raise HTTPException(400, "Password must be at least 6 characters")
    if session.scalar(select(User).where(User.email == data.email.lower())): raise HTTPException(409, "Email already registered")
    user = User(name=data.name.strip(), email=data.email.lower(), password_hash=pwd.hash(data.password), role=data.role.value)
    session.add(user); session.commit(); session.refresh(user)
    return {"access_token": token_for(user), "user": user}

@app.post("/api/auth/login", response_model=TokenOut)
def login(data: LoginIn, session: Session = Depends(db)):
    user = session.scalar(select(User).where(User.email == data.email.lower()))
    if not user or not pwd.verify(data.password, user.password_hash): raise HTTPException(401, "Wrong email or password")
    return {"access_token": token_for(user), "user": user}

@app.get("/api/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)): return user

@app.post("/api/classes", response_model=ClassOut)
def create_class(data: ClassCreate, user: User = Depends(require_role(Role.teacher)), session: Session = Depends(db)):
    import secrets
    code = secrets.token_urlsafe(5).upper().replace("-", "")[:7]
    item = ClassSession(teacher_id=user.id, title=data.title.strip(), code=code)
    session.add(item); session.commit(); session.refresh(item)
    return item

@app.get("/api/classes", response_model=list[ClassOut])
def classes(user: User = Depends(current_user), session: Session = Depends(db)):
    stmt = select(ClassSession).where(ClassSession.teacher_id == user.id).order_by(ClassSession.started_at.desc()) if user.role == "teacher" else select(ClassSession).order_by(ClassSession.started_at.desc())
    return list(session.scalars(stmt).all())

@app.post("/api/classes/{class_id}/end", response_model=ClassOut)
def end_class(class_id: int, user: User = Depends(require_role(Role.teacher)), session: Session = Depends(db)):
    item = session.get(ClassSession, class_id)
    if not item or item.teacher_id != user.id: raise HTTPException(404, "Class not found")
    item.status = "completed"; item.ended_at = datetime.now(timezone.utc); session.commit(); session.refresh(item)
    return item

@app.post("/api/transcripts", response_model=EventOut)
def add_transcript(data: TranscriptIn, user: User = Depends(current_user), session: Session = Depends(db)):
    if not data.text.strip(): raise HTTPException(400, "Transcript cannot be empty")
    session.add(Transcript(class_id=data.class_id, user_id=user.id, text=data.text.strip(), source=data.source)); session.commit()
    return {"id": data.class_id, "message": "Transcript saved"}

@app.post("/api/recognitions", response_model=EventOut)
def add_recognition(data: RecognitionIn, user: User = Depends(current_user), session: Session = Depends(db)):
    if not 0 <= data.confidence <= 1: raise HTTPException(400, "Confidence must be between 0 and 1")
    session.add(RecognitionResult(class_id=data.class_id, user_id=user.id, sign=data.sign.strip().lower(), confidence=data.confidence)); session.commit()
    return {"id": data.class_id, "message": "Recognition saved"}

@app.get("/api/classes/{class_id}/activity")
def activity(class_id: int, user: User = Depends(current_user), session: Session = Depends(db)):
    transcripts = session.scalars(select(Transcript).where(Transcript.class_id == class_id).order_by(Transcript.created_at.desc()).limit(50)).all()
    recognitions = session.scalars(select(RecognitionResult).where(RecognitionResult.class_id == class_id).order_by(RecognitionResult.created_at.desc()).limit(50)).all()
    return {"transcripts": transcripts, "recognitions": recognitions}

@app.get("/api/teachers/{teacher_id}/dashboard")
def dashboard(teacher_id: int, user: User = Depends(current_user), session: Session = Depends(db)):
    if user.id != teacher_id and user.role != "teacher": raise HTTPException(403, "Not allowed")
    classes_count = session.scalar(select(func.count(ClassSession.id)).where(ClassSession.teacher_id == teacher_id)) or 0
    class_ids = select(ClassSession.id).where(ClassSession.teacher_id == teacher_id)
    recognition_count = session.scalar(select(func.count(RecognitionResult.id)).where(RecognitionResult.class_id.in_(class_ids))) or 0
    transcript_count = session.scalar(select(func.count(Transcript.id)).where(Transcript.class_id.in_(class_ids))) or 0
    avg_conf = session.scalar(select(func.avg(RecognitionResult.confidence)).where(RecognitionResult.class_id.in_(class_ids)))
    recent = session.scalars(select(ClassSession).where(ClassSession.teacher_id == teacher_id).order_by(ClassSession.started_at.desc()).limit(5)).all()
    return {"metrics": {"classes": classes_count, "recognitions": recognition_count, "transcripts": transcript_count, "average_confidence": round(float(avg_conf or 0), 3)}, "recent_classes": [ClassOut.model_validate(x) for x in recent]}
