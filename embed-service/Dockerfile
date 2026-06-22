FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        g++ \
        libgl1 \
        libglib2.0-0 \
        libgomp1 && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY embed_service.py .

ENV MODEL_TAG=buffalo_l
ENV CUDA_ON=false
ENV LOG_FACES=false
ENV INSIGHTFACE_HOME=/root/.insightface

EXPOSE 8001
CMD ["uvicorn", "embed_service:app", "--host", "0.0.0.0", "--port", "8001"]
