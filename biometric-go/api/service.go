// Package api — бизнес-логика и HTTP-слой Go-сервиса.
package api

import (
	"fmt"
	"path/filepath"
	"strings"

	"biometric/embedclient"
	"biometric/store"
)

// ── Service ───────────────────────────────────────────────────────────────────

type Service struct {
	embed  *embedclient.Client
	store  *store.Store
	cutoff float32
}

func NewService(embed *embedclient.Client, st *store.Store, cutoff float32) *Service {
	return &Service{embed: embed, store: st, cutoff: cutoff}
}

// ── Result types ──────────────────────────────────────────────────────────────

type VerifyStatus string

const (
	StatusMatched  VerifyStatus = "matched"
	StatusEnrolled VerifyStatus = "enrolled"
	StatusNotFound VerifyStatus = "not_found"
	StatusNoFace   VerifyStatus = "no_face"
)

type VerifyResult struct {
	BBox    [4]float32
	Subject *store.SubjectMeta
	Score   float32
	Status  VerifyStatus
}

type SearchResult struct {
	BBox       [4]float32
	Candidates []store.VectorHit
}

// ── Methods ───────────────────────────────────────────────────────────────────

// FindOrEnroll — идентифицировать лицо, опционально зарегистрировать.
func (s *Service) FindOrEnroll(imageData []byte, filename string, cutoff float32, allowEnroll bool) (VerifyResult, error) {
	face, err := s.embed.Embed(imageData, filename)
	if err != nil {
		return VerifyResult{}, fmt.Errorf("embed: %w", err)
	}
	if face == nil {
		return VerifyResult{Status: StatusNoFace}, nil
	}

	label := CleanFilename(filename)

	hits, err := s.store.Nearest(face.Embedding, 1, cutoff)
	if err != nil {
		return VerifyResult{}, fmt.Errorf("nearest: %w", err)
	}

	if len(hits) > 0 {
		meta := hits[0].Subject
		score := hits[0].Similarity

		if allowEnroll {
			alreadyAttached := false
			for _, o := range meta.Origins {
				if o == label {
					alreadyAttached = true
					break
				}
			}
			if !alreadyAttached {
				updated, err := s.store.AttachPortrait(meta.SubjectID, label, face.Embedding)
				if err == nil {
					meta = updated
				}
			}
		}
		return VerifyResult{BBox: face.BBox, Subject: &meta, Score: score, Status: StatusMatched}, nil
	}

	if allowEnroll {
		created, err := s.store.RegisterSubject(label, face.Embedding)
		if err != nil {
			return VerifyResult{}, fmt.Errorf("register: %w", err)
		}
		return VerifyResult{BBox: face.BBox, Subject: &created, Score: 0, Status: StatusEnrolled}, nil
	}

	return VerifyResult{BBox: face.BBox, Subject: nil, Score: 0, Status: StatusNotFound}, nil
}

// EnrollFromImage — зарегистрировать нового субъекта безусловно.
func (s *Service) EnrollFromImage(imageData []byte, filename string) (store.SubjectMeta, error) {
	face, err := s.embed.Embed(imageData, filename)
	if err != nil {
		return store.SubjectMeta{}, fmt.Errorf("embed: %w", err)
	}
	if face == nil {
		return store.SubjectMeta{}, fmt.Errorf("no face detected")
	}
	return s.store.RegisterSubject(CleanFilename(filename), face.Embedding)
}

// AddPortrait — добавить фото к существующему субъекту.
func (s *Service) AddPortrait(imageData []byte, filename, subjectID string) ([4]float32, store.SubjectMeta, error) {
	face, err := s.embed.Embed(imageData, filename)
	if err != nil {
		return [4]float32{}, store.SubjectMeta{}, fmt.Errorf("embed: %w", err)
	}
	if face == nil {
		return [4]float32{}, store.SubjectMeta{}, fmt.Errorf("no face detected")
	}
	meta, err := s.store.AttachPortrait(subjectID, CleanFilename(filename), face.Embedding)
	return face.BBox, meta, err
}

// RemovePortrait — удалить портрет. nil meta = субъект удалён.
func (s *Service) RemovePortrait(subjectID, origin string) (*store.SubjectMeta, error) {
	return s.store.DetachPortrait(subjectID, origin)
}

// Search — топ-K похожих субъектов.
func (s *Service) Search(imageData []byte, filename string, topK int, cutoff float32) (SearchResult, error) {
	face, err := s.embed.Embed(imageData, filename)
	if err != nil {
		return SearchResult{}, fmt.Errorf("embed: %w", err)
	}
	if face == nil {
		return SearchResult{}, fmt.Errorf("no face detected")
	}
	hits, err := s.store.Nearest(face.Embedding, topK, cutoff)
	if err != nil {
		return SearchResult{}, err
	}
	return SearchResult{BBox: face.BBox, Candidates: hits}, nil
}

// GetSubject — профиль субъекта по ID.
func (s *Service) GetSubject(subjectID string) (*store.SubjectMeta, error) {
	return s.store.FetchSubject(subjectID)
}

// CleanFilename — санитизация имени файла (как Python _clean).
func CleanFilename(name string) string {
	name = strings.TrimSpace(name)
	name = strings.Trim(name, "'\"")
	return filepath.Base(name)
}
