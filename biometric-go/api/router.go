package api

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// ── Router ────────────────────────────────────────────────────────────────────

func NewRouter(svc *Service) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /verify", svc.handleVerify)
	mux.HandleFunc("POST /subjects", svc.handleCreateSubject)
	mux.HandleFunc("POST /subjects/{subject_id}/portraits", svc.handleAddPortrait)
	mux.HandleFunc("DELETE /subjects/{subject_id}/portraits", svc.handleRemovePortrait)
	mux.HandleFunc("POST /search", svc.handleSearch)
	mux.HandleFunc("GET /subjects/{subject_id}", svc.handleGetSubject)
	mux.HandleFunc("GET /health", handleHealth)

	return corsMiddleware(mux)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "*")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ── Response schemas ──────────────────────────────────────────────────────────

type subjectOut struct {
	SubjectID string    `json:"subject_id"`
	Origins   []string  `json:"origins"`
	BBox      []float32 `json:"bbox,omitempty"`
}

type verifyResponse struct {
	BBox       []float32   `json:"bbox"`
	Subject    *subjectOut `json:"subject"`
	Similarity *float32    `json:"similarity"`
	Status     string      `json:"status"`
}

type candidateOut struct {
	Subject    subjectOut `json:"subject"`
	Similarity float32    `json:"similarity"`
}

type searchResponse struct {
	BBox       []float32      `json:"bbox"`
	Candidates []candidateOut `json:"candidates"`
}

// ── Handlers ──────────────────────────────────────────────────────────────────

// POST /verify?allow_enroll=true&cutoff=0.35
func (s *Service) handleVerify(w http.ResponseWriter, r *http.Request) {
	data, filename, err := readImageUpload(r)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}

	allowEnroll := r.URL.Query().Get("allow_enroll") == "true"
	cutoff := s.cutoff
	if v := r.URL.Query().Get("cutoff"); v != "" {
		fmt.Sscanf(v, "%f", &cutoff)
	}

	res, err := s.FindOrEnroll(data, filename, cutoff, allowEnroll)
	if err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	resp := verifyResponse{Status: string(res.Status)}
	if res.Status != StatusNoFace {
		resp.BBox = res.BBox[:]
		f := res.Score
		resp.Similarity = &f
		if res.Subject != nil {
			resp.Subject = &subjectOut{SubjectID: res.Subject.SubjectID, Origins: res.Subject.Origins}
		}
	}
	jsonResp(w, http.StatusOK, resp)
}

// POST /subjects
func (s *Service) handleCreateSubject(w http.ResponseWriter, r *http.Request) {
	data, filename, err := readImageUpload(r)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	meta, err := s.EnrollFromImage(data, filename)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonResp(w, http.StatusOK, subjectOut{SubjectID: meta.SubjectID, Origins: meta.Origins})
}

// POST /subjects/{subject_id}/portraits
func (s *Service) handleAddPortrait(w http.ResponseWriter, r *http.Request) {
	subjectID := r.PathValue("subject_id")
	data, filename, err := readImageUpload(r)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	bbox, meta, err := s.AddPortrait(data, filename, subjectID)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	jsonResp(w, http.StatusOK, subjectOut{
		SubjectID: meta.SubjectID,
		Origins:   meta.Origins,
		BBox:      bbox[:],
	})
}

// DELETE /subjects/{subject_id}/portraits?origin=filename.jpg
func (s *Service) handleRemovePortrait(w http.ResponseWriter, r *http.Request) {
	subjectID := r.PathValue("subject_id")
	origin := r.URL.Query().Get("origin")
	if origin == "" {
		httpErr(w, http.StatusBadRequest, "origin query param required")
		return
	}
	meta, err := s.RemovePortrait(subjectID, origin)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}
	if meta == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	jsonResp(w, http.StatusOK, subjectOut{SubjectID: meta.SubjectID, Origins: meta.Origins})
}

// POST /search?top_k=3&cutoff=0.35
func (s *Service) handleSearch(w http.ResponseWriter, r *http.Request) {
	data, filename, err := readImageUpload(r)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}

	topK := 3
	fmt.Sscanf(r.URL.Query().Get("top_k"), "%d", &topK)
	cutoff := s.cutoff
	if v := r.URL.Query().Get("cutoff"); v != "" {
		fmt.Sscanf(v, "%f", &cutoff)
	}

	res, err := s.Search(data, filename, topK, cutoff)
	if err != nil {
		httpErr(w, http.StatusBadRequest, err.Error())
		return
	}

	candidates := make([]candidateOut, len(res.Candidates))
	for i, h := range res.Candidates {
		candidates[i] = candidateOut{
			Subject:    subjectOut{SubjectID: h.Subject.SubjectID, Origins: h.Subject.Origins},
			Similarity: h.Similarity,
		}
	}
	jsonResp(w, http.StatusOK, searchResponse{BBox: res.BBox[:], Candidates: candidates})
}

// GET /subjects/{subject_id}
func (s *Service) handleGetSubject(w http.ResponseWriter, r *http.Request) {
	subjectID := r.PathValue("subject_id")
	meta, err := s.GetSubject(subjectID)
	if err != nil {
		httpErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if meta == nil {
		httpErr(w, http.StatusNotFound, fmt.Sprintf("subject %q not found", subjectID))
		return
	}
	jsonResp(w, http.StatusOK, subjectOut{SubjectID: meta.SubjectID, Origins: meta.Origins})
}

// GET /health
func handleHealth(w http.ResponseWriter, _ *http.Request) {
	jsonResp(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Image upload ──────────────────────────────────────────────────────────────

func readImageUpload(r *http.Request) ([]byte, string, error) {
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		return nil, "", fmt.Errorf("parse multipart: %w", err)
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		return nil, "", fmt.Errorf("field 'image' missing: %w", err)
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		return nil, "", fmt.Errorf("read file: %w", err)
	}
	return data, header.Filename, nil
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func jsonResp(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func httpErr(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"detail": msg})
}
