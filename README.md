# biometric-hybrid

Гибридная архитектура биометрического сервиса:

```
┌─────────────────────────────────────┐
│  Go API :8080  (HTTP + Qdrant)      │
│  - роутинг, бизнес-логика           │
│  - Qdrant gRPC (persons/portraits)  │
└──────────────┬──────────────────────┘
               │ POST /embed (HTTP)
┌──────────────▼──────────────────────┐
│  Python embed-service :8001         │
│  - InsightFace (buffalo_l)          │
│  - возвращает bbox + embedding      │
└─────────────────────────────────────┘
               │
┌──────────────▼──────────────────────┐
│  Qdrant :6334 (gRPC)                │
│  - хранение векторов                │
│  - HNSW поиск                       │
└─────────────────────────────────────┘
```

## Структура папок

```
biometric-hybrid/
├── docker-compose.yml
├── embed-service/              ← Python (InsightFace)
│   ├── embed_service.py
│   ├── requirements.txt
│   └── Dockerfile
└── biometric-go/               ← Go (API + Qdrant)
    ├── main.go
    ├── go.mod
    ├── go.sum                  ← генерируется через go mod tidy
    ├── embedclient/client.go
    ├── store/store.go
    ├── api/
    │   ├── service.go
    │   └── router.go
    └── Dockerfile
```

## Запуск

### Шаг 1 — Сгенерировать go.sum

```bash
cd biometric-go
go mod tidy
cd ..
```

### Шаг 2 — Запустить всё

```bash
docker compose up --build
```

Первый запуск дольше обычного — `embed-service` скачивает модели `buffalo_l` (~300 МБ).  
Дождись в логах:

```
embed-service  | INFO:     Application startup complete.
biometric-api  | [boot] listening on :8080
```

### Шаг 3 — Проверить

```bash
# Healthcheck
curl http://localhost:8080/health
curl http://localhost:8001/health

# Зарегистрировать лицо
curl -X POST http://localhost:8080/subjects \
  -F "image=@photo.jpg"

# Идентифицировать
curl -X POST "http://localhost:8080/verify?allow_enroll=true" \
  -F "image=@photo.jpg"

# Топ-3 похожих
curl -X POST "http://localhost:8080/search?top_k=3" \
  -F "image=@photo.jpg"

# Добавить фото к субъекту
curl -X POST http://localhost:8080/subjects/{id}/portraits \
  -F "image=@photo2.jpg"

# Удалить фото
curl -X DELETE "http://localhost:8080/subjects/{id}/portraits?origin=photo2.jpg"

# Профиль субъекта
curl http://localhost:8080/subjects/{id}
```

## Переменные окружения

### embed-service (Python)

| Переменная  | По умолчанию | Описание                    |
|-------------|-------------|------------------------------|
| MODEL_TAG   | buffalo_l   | Модель InsightFace           |
| CUDA_ON     | false       | Включить CUDA (GPU)          |
| LOG_FACES   | false       | Логировать кол-во лиц        |

### biometric-api (Go)

| Переменная    | По умолчанию        | Описание                  |
|---------------|---------------------|---------------------------|
| QDRANT_ADDR   | qdrant:6334         | Qdrant gRPC адрес         |
| EMBED_URL     | http://embed-service:8001 | URL embed-service   |
| MATCH_CUTOFF  | 0.35                | Порог схожести (косинус)  |
| ADDR          | :8080               | Порт Go-сервиса           |
| PERSONS_COL   | persons             | Коллекция субъектов       |
| PORTRAITS_COL | portraits           | Коллекция портретов       |

## API (совместим с оригинальным Python-сервисом)

| Метод  | Путь | Описание |
|--------|------|----------|
| POST   | `/verify?allow_enroll=bool&cutoff=float` | Идентификация |
| POST   | `/subjects` | Регистрация субъекта |
| POST   | `/subjects/{id}/portraits` | Добавить фото |
| DELETE | `/subjects/{id}/portraits?origin=name` | Удалить фото |
| POST   | `/search?top_k=int&cutoff=float` | Поиск топ-K |
| GET    | `/subjects/{id}` | Профиль субъекта |
| GET    | `/health` | Статус сервиса |
