// Package embedclient вызывает Python embed-service и возвращает
// эмбеддинг, bbox и позу лица для переданного изображения.
package embedclient

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"time"
)

// FaceResult — ответ от embed-service.
type FaceResult struct {
	Embedding []float32 `json:"embedding"`
	BBox      [4]float32
	Pose      struct {
		Yaw   float32 `json:"yaw"`
		Pitch float32 `json:"pitch"`
		Roll  float32 `json:"roll"`
	} `json:"pose"`
}

type rawBBox []float32

type rawResponse struct {
	Embedding []float32 `json:"embedding"`
	BBox      rawBBox   `json:"bbox"`
	Pose      struct {
		Yaw   float32 `json:"yaw"`
		Pitch float32 `json:"pitch"`
		Roll  float32 `json:"roll"`
	} `json:"pose"`
	Detail string `json:"detail"` // ошибка от FastAPI
}

// Client — HTTP клиент к embed-service.
type Client struct {
	baseURL string
	http    *http.Client
}

// New создаёт клиент. baseURL например "http://embed-service:8001".
func New(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		http:    &http.Client{Timeout: 30 * time.Second},
	}
}

// Embed отправляет изображение в embed-service.
// Возвращает (nil, nil) если лицо не найдено (HTTP 422).
// Возвращает ошибку при сетевых проблемах или HTTP 4xx/5xx.
func (c *Client) Embed(imageData []byte, filename string) (*FaceResult, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)

	part, err := writer.CreateFormFile("image", filename)
	if err != nil {
		return nil, fmt.Errorf("create form file: %w", err)
	}
	if _, err = io.Copy(part, bytes.NewReader(imageData)); err != nil {
		return nil, fmt.Errorf("copy image data: %w", err)
	}
	writer.Close()

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/embed", body)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("embed-service unreachable: %w", err)
	}
	defer resp.Body.Close()

	// 422 = лицо не обнаружено — не ошибка, просто пустой результат
	if resp.StatusCode == http.StatusUnprocessableEntity {
		return nil, nil
	}

	respBytes, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		var raw rawResponse
		_ = json.Unmarshal(respBytes, &raw)
		return nil, fmt.Errorf("embed-service error %d: %s", resp.StatusCode, raw.Detail)
	}

	var raw rawResponse
	if err := json.Unmarshal(respBytes, &raw); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	if len(raw.BBox) != 4 {
		return nil, fmt.Errorf("invalid bbox length: %d", len(raw.BBox))
	}

	result := &FaceResult{
		Embedding: raw.Embedding,
		Pose:      raw.Pose,
	}
	result.BBox = [4]float32{raw.BBox[0], raw.BBox[1], raw.BBox[2], raw.BBox[3]}
	return result, nil
}
