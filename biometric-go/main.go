package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"biometric/api"
	"biometric/embedclient"
	"biometric/store"
)

func main() {
	cfg := loadConfig()

	log.Printf("[boot] connecting to Qdrant at %s", cfg.QdrantAddr)
	vs, err := store.New(cfg.QdrantAddr, cfg.PersonsCol, cfg.PortraitsCol)
	if err != nil {
		log.Fatalf("qdrant: %v", err)
	}
	defer vs.Close()

	log.Printf("[boot] embed-service at %s", cfg.EmbedURL)
	embed := embedclient.New(cfg.EmbedURL)

	svc := api.NewService(embed, vs, cfg.MatchCutoff)
	router := api.NewRouter(svc)

	log.Printf("[boot] listening on %s", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, router); err != nil {
		log.Fatalf("server: %v", err)
	}
}

type config struct {
	QdrantAddr   string
	EmbedURL     string
	MatchCutoff  float32
	Addr         string
	PersonsCol   string
	PortraitsCol string
}

func loadConfig() config {
	return config{
		QdrantAddr:   getenv("QDRANT_ADDR", "localhost:6334"),
		EmbedURL:     getenv("EMBED_URL", "http://localhost:8001"),
		MatchCutoff:  float32(getenvFloat("MATCH_CUTOFF", 0.35)),
		Addr:         getenv("ADDR", ":8080"),
		PersonsCol:   getenv("PERSONS_COL", "persons"),
		PortraitsCol: getenv("PORTRAITS_COL", "portraits"),
	}
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvFloat(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		var f float64
		if _, err := fmt.Sscanf(v, "%f", &f); err == nil {
			return f
		}
	}
	return def
}
