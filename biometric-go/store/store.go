// Package store — обёртка над Qdrant gRPC клиентом.
// Две коллекции: persons (агрегированные векторы) и portraits (отдельные фото).
package store

import (
	"context"
	"fmt"
	"math"

	"github.com/google/uuid"
	pb "github.com/qdrant/go-client/qdrant"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const vectorDim = 512

// ── Доменные типы ─────────────────────────────────────────────────────────────

type SubjectMeta struct {
	SubjectID string
	Origins   []string
}

type VectorHit struct {
	Subject    SubjectMeta
	Similarity float32
}

// ── Store ─────────────────────────────────────────────────────────────────────

type Store struct {
	conn         *grpc.ClientConn
	points       pb.PointsClient
	collections  pb.CollectionsClient
	personsCol   string
	portraitsCol string
}

// New подключается к Qdrant по gRPC (addr = "host:6334") и создаёт коллекции.
func New(addr, personsCol, portraitsCol string) (*Store, error) {
	conn, err := grpc.Dial(addr,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		return nil, fmt.Errorf("qdrant dial %s: %w", addr, err)
	}

	s := &Store{
		conn:         conn,
		points:       pb.NewPointsClient(conn),
		collections:  pb.NewCollectionsClient(conn),
		personsCol:   personsCol,
		portraitsCol: portraitsCol,
	}

	if err := s.ensureCollections(); err != nil {
		_ = conn.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() { _ = s.conn.Close() }

// ── Bootstrap ─────────────────────────────────────────────────────────────────

func (s *Store) ensureCollections() error {
	ctx := context.Background()
	for _, col := range []string{s.personsCol, s.portraitsCol} {
		_, err := s.collections.Get(ctx, &pb.GetCollectionInfoRequest{CollectionName: col})
		if err == nil {
			continue
		}
		_, err = s.collections.Create(ctx, &pb.CreateCollection{
			CollectionName: col,
			VectorsConfig: &pb.VectorsConfig{
				Config: &pb.VectorsConfig_Params{
					Params: &pb.VectorParams{
						Size:     vectorDim,
						Distance: pb.Distance_Cosine,
					},
				},
			},
		})
		if err != nil {
			return fmt.Errorf("create collection %s: %w", col, err)
		}
	}
	return nil
}

// ── Portrait helpers ──────────────────────────────────────────────────────────

type portraitRow struct {
	id     string
	origin string
	vec    []float32
}

func (s *Store) savePortrait(id, origin string, vec []float32) error {
	existing, err := s.portraitsByOrigins([]string{origin})
	if err != nil {
		return err
	}
	if len(existing) > 0 {
		return fmt.Errorf("portrait with origin %q already exists", origin)
	}

	_, err = s.points.Upsert(context.Background(), &pb.UpsertPoints{
		CollectionName: s.portraitsCol,
		Points: []*pb.PointStruct{{
			Id:      strID(id),
			Vectors: floatVec(vec),
			Payload: map[string]*pb.Value{
				"origin":      strVal(origin),
				"portrait_id": strVal(id),
			},
		}},
		Wait: boolPtr(true),
	})
	return err
}

func (s *Store) deletePortrait(origin string) error {
	pts, err := s.portraitsByOrigins([]string{origin})
	if err != nil {
		return err
	}
	if len(pts) == 0 {
		return fmt.Errorf("portrait %q not found", origin)
	}
	_, err = s.points.Delete(context.Background(), &pb.DeletePoints{
		CollectionName: s.portraitsCol,
		Points: &pb.PointsSelector{
			PointsSelectorOneOf: &pb.PointsSelector_Points{
				Points: &pb.PointsIdsList{Ids: []*pb.PointId{strID(pts[0].id)}},
			},
		},
		Wait: boolPtr(true),
	})
	return err
}

func (s *Store) portraitsByOrigins(origins []string) ([]portraitRow, error) {
	resp, err := s.points.Scroll(context.Background(), &pb.ScrollPoints{
		CollectionName: s.portraitsCol,
		Filter: &pb.Filter{
			Must: []*pb.Condition{{
				ConditionOneOf: &pb.Condition_Field{
					Field: &pb.FieldCondition{
						Key:   "origin",
						Match: &pb.Match{MatchValue: &pb.Match_Keywords{Keywords: &pb.RepeatedStrings{Strings: origins}}},
					},
				},
			}},
		},
		WithVectors: &pb.WithVectorsSelector{SelectorOptions: &pb.WithVectorsSelector_Enable{Enable: true}},
		Limit:       uint32Ptr(1000),
	})
	if err != nil {
		return nil, err
	}
	rows := make([]portraitRow, 0, len(resp.Result))
	for _, pt := range resp.Result {
		rows = append(rows, portraitRow{
			id:     pointIDStr(pt.Id),
			origin: pt.Payload["origin"].GetStringValue(),
			vec:    pt.Vectors.GetVector().GetData(),
		})
	}
	return rows, nil
}

// ── Subject CRUD ──────────────────────────────────────────────────────────────

// RegisterSubject создаёт нового субъекта с первым портретом.
func (s *Store) RegisterSubject(origin string, vec []float32) (SubjectMeta, error) {
	id := uuid.New().String()

	if err := s.savePortrait(id, origin, vec); err != nil {
		return SubjectMeta{}, err
	}

	meta := SubjectMeta{SubjectID: id, Origins: []string{origin}}
	_, err := s.points.Upsert(context.Background(), &pb.UpsertPoints{
		CollectionName: s.personsCol,
		Points: []*pb.PointStruct{{
			Id:      strID(id),
			Vectors: floatVec(vec),
			Payload: subjectPayload(meta),
		}},
		Wait: boolPtr(true),
	})
	if err != nil {
		return SubjectMeta{}, err
	}
	return meta, nil
}

// AttachPortrait добавляет портрет к субъекту, пересчитывает средний вектор.
func (s *Store) AttachPortrait(subjectID, origin string, vec []float32) (SubjectMeta, error) {
	ptID, meta, err := s.fetchSubjectMeta(subjectID)
	if err != nil {
		return SubjectMeta{}, err
	}
	if meta == nil {
		return SubjectMeta{}, fmt.Errorf("subject not found: %s", subjectID)
	}
	for _, o := range meta.Origins {
		if o == origin {
			return SubjectMeta{}, fmt.Errorf("origin %q already attached", origin)
		}
	}

	existing, err := s.portraitsByOrigins(meta.Origins)
	if err != nil {
		return SubjectMeta{}, err
	}
	vecs := make([][]float32, 0, len(existing)+1)
	for _, p := range existing {
		vecs = append(vecs, p.vec)
	}
	vecs = append(vecs, vec)
	meanVec := meanNormalized(vecs)

	portID := uuid.New().String()
	if err := s.savePortrait(portID, origin, vec); err != nil {
		return SubjectMeta{}, err
	}

	meta.Origins = append(meta.Origins, origin)
	_, err = s.points.Upsert(context.Background(), &pb.UpsertPoints{
		CollectionName: s.personsCol,
		Points: []*pb.PointStruct{{
			Id:      strID(ptID),
			Vectors: floatVec(meanVec),
			Payload: subjectPayload(*meta),
		}},
		Wait: boolPtr(true),
	})
	if err != nil {
		return SubjectMeta{}, err
	}
	return *meta, nil
}

// DetachPortrait удаляет портрет. Возвращает nil если субъект удалён полностью.
func (s *Store) DetachPortrait(subjectID, origin string) (*SubjectMeta, error) {
	ptID, meta, err := s.fetchSubjectMeta(subjectID)
	if err != nil {
		return nil, err
	}
	if meta == nil {
		return nil, fmt.Errorf("subject not found: %s", subjectID)
	}

	found := false
	newOrigins := make([]string, 0, len(meta.Origins))
	for _, o := range meta.Origins {
		if o == origin {
			found = true
		} else {
			newOrigins = append(newOrigins, o)
		}
	}
	if !found {
		return nil, fmt.Errorf("origin %q not found for subject %s", origin, subjectID)
	}

	if err := s.deletePortrait(origin); err != nil {
		return nil, err
	}

	// Последний портрет — удаляем субъекта целиком
	if len(newOrigins) == 0 {
		_, err = s.points.Delete(context.Background(), &pb.DeletePoints{
			CollectionName: s.personsCol,
			Points: &pb.PointsSelector{
				PointsSelectorOneOf: &pb.PointsSelector_Points{
					Points: &pb.PointsIdsList{Ids: []*pb.PointId{strID(ptID)}},
				},
			},
			Wait: boolPtr(true),
		})
		return nil, err
	}

	remaining, err := s.portraitsByOrigins(newOrigins)
	if err != nil {
		return nil, err
	}
	vecs := make([][]float32, 0, len(remaining))
	for _, p := range remaining {
		vecs = append(vecs, p.vec)
	}

	meta.Origins = newOrigins
	_, err = s.points.Upsert(context.Background(), &pb.UpsertPoints{
		CollectionName: s.personsCol,
		Points: []*pb.PointStruct{{
			Id:      strID(ptID),
			Vectors: floatVec(meanNormalized(vecs)),
			Payload: subjectPayload(*meta),
		}},
		Wait: boolPtr(true),
	})
	if err != nil {
		return nil, err
	}
	return meta, nil
}

// Nearest — ANN поиск топ-k субъектов выше cutoff.
func (s *Store) Nearest(vec []float32, topK int, cutoff float32) ([]VectorHit, error) {
	resp, err := s.points.Search(context.Background(), &pb.SearchPoints{
		CollectionName: s.personsCol,
		Vector:         vec,
		Limit:          uint64(topK),
		ScoreThreshold: &cutoff,
		WithPayload:    &pb.WithPayloadSelector{SelectorOptions: &pb.WithPayloadSelector_Enable{Enable: true}},
	})
	if err != nil {
		return nil, err
	}
	hits := make([]VectorHit, 0, len(resp.Result))
	for _, r := range resp.Result {
		hits = append(hits, VectorHit{
			Subject:    subjectMetaFromPayload(r.Payload),
			Similarity: r.Score,
		})
	}
	return hits, nil
}

// FetchSubject возвращает метаданные субъекта по ID или nil.
func (s *Store) FetchSubject(subjectID string) (*SubjectMeta, error) {
	_, meta, err := s.fetchSubjectMeta(subjectID)
	return meta, err
}

// ── Internal ──────────────────────────────────────────────────────────────────

func (s *Store) fetchSubjectMeta(subjectID string) (string, *SubjectMeta, error) {
	resp, err := s.points.Scroll(context.Background(), &pb.ScrollPoints{
		CollectionName: s.personsCol,
		Filter: &pb.Filter{
			Must: []*pb.Condition{{
				ConditionOneOf: &pb.Condition_Field{
					Field: &pb.FieldCondition{
						Key:   "subject_id",
						Match: &pb.Match{MatchValue: &pb.Match_Keyword{Keyword: subjectID}},
					},
				},
			}},
		},
		WithPayload: &pb.WithPayloadSelector{SelectorOptions: &pb.WithPayloadSelector_Enable{Enable: true}},
		Limit:       uint32Ptr(1),
	})
	if err != nil || len(resp.Result) == 0 {
		return "", nil, err
	}
	pt := resp.Result[0]
	meta := subjectMetaFromPayload(pt.Payload)
	return pointIDStr(pt.Id), &meta, nil
}

func subjectMetaFromPayload(p map[string]*pb.Value) SubjectMeta {
	sid := p["subject_id"].GetStringValue()
	var origins []string
	for _, v := range p["origins"].GetListValue().GetValues() {
		origins = append(origins, v.GetStringValue())
	}
	return SubjectMeta{SubjectID: sid, Origins: origins}
}

func subjectPayload(m SubjectMeta) map[string]*pb.Value {
	origVals := make([]*pb.Value, len(m.Origins))
	for i, o := range m.Origins {
		origVals[i] = strVal(o)
	}
	return map[string]*pb.Value{
		"subject_id": strVal(m.SubjectID),
		"origins":    {Kind: &pb.Value_ListValue{ListValue: &pb.ListValue{Values: origVals}}},
	}
}

func meanNormalized(vecs [][]float32) []float32 {
	if len(vecs) == 0 {
		return make([]float32, vectorDim)
	}
	out := make([]float32, len(vecs[0]))
	for _, v := range vecs {
		for i, x := range v {
			out[i] += x
		}
	}
	n := float32(len(vecs))
	for i := range out {
		out[i] /= n
	}
	var sum float32
	for _, x := range out {
		sum += x * x
	}
	if norm := float32(math.Sqrt(float64(sum))); norm > 0 {
		for i := range out {
			out[i] /= norm
		}
	}
	return out
}

// ── Proto helpers ─────────────────────────────────────────────────────────────

func strID(id string) *pb.PointId {
	return &pb.PointId{PointIdOptions: &pb.PointId_Uuid{Uuid: id}}
}
func strVal(s string) *pb.Value {
	return &pb.Value{Kind: &pb.Value_StringValue{StringValue: s}}
}
func floatVec(v []float32) *pb.Vectors {
	return &pb.Vectors{VectorsOptions: &pb.Vectors_Vector{Vector: &pb.Vector{Data: v}}}
}
func boolPtr(b bool) *bool    { return &b }
func uint32Ptr(v uint32) *uint32 { return &v }
func pointIDStr(id *pb.PointId) string {
	if id == nil {
		return ""
	}
	return id.GetUuid()
}
