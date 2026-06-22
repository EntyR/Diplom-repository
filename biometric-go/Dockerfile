FROM golang:1.22-bookworm AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o biometric-service .

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/biometric-service .

ENV QDRANT_ADDR=qdrant:6334
ENV EMBED_URL=http://embed-service:8001
ENV ADDR=:8080
ENV MATCH_CUTOFF=0.35

EXPOSE 8080
ENTRYPOINT ["./biometric-service"]
