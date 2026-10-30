package playback

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/auth"
	"github.com/weirhq/weir/server/internal/media"
	"github.com/weirhq/weir/server/internal/store"
	"github.com/weirhq/weir/server/internal/store/dbgen"
)

// directPlayGrace is how long a direct-play URL outlives the film, for
// pauses and seeking back.
const directPlayGrace = 6 * time.Hour

var errNoItem = connect.NewError(connect.CodeNotFound, errors.New("no such item"))

// Service implements weir.api.v1alpha.Playback.
type Service struct {
	// Heartbeat and Stop answer Unimplemented until sessions exist.
	apiv1alpha.UnimplementedPlaybackHandler
	store  *store.Store
	signer *media.Signer
	// The engine's last reported capabilities; nil until it has reported.
	engine func() *enginev1alpha.CapabilitiesResponse
}

func NewService(st *store.Store, signer *media.Signer, engine func() *enginev1alpha.CapabilitiesResponse) *Service {
	return &Service{store: st, signer: signer, engine: engine}
}

var _ apiv1alpha.PlaybackHandler = (*Service)(nil)

func (s *Service) Start(ctx context.Context, req *connect.Request[apiv1alpha.StartRequest]) (*connect.Response[apiv1alpha.StartResponse], error) {
	msg := req.Msg
	userID, err := auth.ClaimsFrom(ctx).UserID()
	if err != nil {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("invalid access token"))
	}
	if msg.Capabilities == nil {
		return nil, auth.InvalidArgument(errors.New("capabilities are required"))
	}
	itemID, err := uuid.Parse(msg.ItemId)
	if err != nil {
		return nil, errNoItem
	}
	if _, err := s.store.GetItem(ctx, itemID); errors.Is(err, pgx.ErrNoRows) {
		return nil, errNoItem
	} else if err != nil {
		return nil, auth.Internal(ctx, "load item", err)
	}
	versions, err := s.store.ItemVersions(ctx, itemID)
	if err != nil {
		return nil, auth.Internal(ctx, "load versions", err)
	}
	if msg.VersionId != "" {
		versions = keepVersion(versions, msg.VersionId)
	}
	if len(versions) == 0 {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("nothing playable for this item"))
	}

	prefs, err := s.prefs(ctx, userID)
	if err != nil {
		return nil, auth.Internal(ctx, "load preferences", err)
	}
	engineCaps := s.engine()

	var best *apiv1alpha.PlaybackPlan
	var bestRow dbgen.ItemVersionsRow
	for _, v := range versions {
		probe := &enginev1alpha.ProbeResponse{}
		if err := protojson.Unmarshal(v.Probe, probe); err != nil {
			return nil, auth.Internal(ctx, "read probe", err)
		}
		sel := SelectStreams(probe, prefs)
		if msg.AudioStreamIndex != nil {
			sel.Audio = int(*msg.AudioStreamIndex)
		}
		if msg.SubtitleStreamIndex != nil {
			sel.Subtitle = int(*msg.SubtitleStreamIndex)
		}
		plan, err := s.decide(ctx, v.ProbeHash, probe, msg.Capabilities, sel, Limits{MaxBitrate: prefs.MaxBitrate}, engineCaps)
		if err != nil {
			return nil, auth.Internal(ctx, "decide", err)
		}
		if best == nil || Better(plan, best) {
			best, bestRow = plan, v
		}
	}

	best.VersionId = bestRow.VersionID.String()
	if best.Method == apiv1alpha.PlaybackMethod_PLAYBACK_METHOD_DIRECT_PLAY {
		ttl := directPlayGrace
		if bestRow.DurationMs != nil {
			ttl += time.Duration(*bestRow.DurationMs) * time.Millisecond
		}
		best.Url = s.signer.FileURL(bestRow.FileID, userID, ttl)
	}
	// Remux and transcode URLs come from engine sessions, which aren't wired
	// up yet; those plans go out with an empty URL.
	return connect.NewResponse(&apiv1alpha.StartResponse{Plan: best}), nil
}

// decide returns the plan for one version, from the decision cache when the
// same inputs were seen before.
func (s *Service) decide(ctx context.Context, probeHash string, probe *enginev1alpha.ProbeResponse, caps *apiv1alpha.ClientCapabilities, sel Selection, limits Limits, engine *enginev1alpha.CapabilitiesResponse) (*apiv1alpha.PlaybackPlan, error) {
	inputHash, err := hashInputs(caps, sel, limits, engine)
	if err != nil {
		return nil, err
	}
	if cached, err := s.store.GetPlaybackDecision(ctx, dbgen.GetPlaybackDecisionParams{ProbeHash: probeHash, InputHash: inputHash}); err == nil {
		plan := &apiv1alpha.PlaybackPlan{}
		if err := proto.Unmarshal(cached, plan); err == nil {
			return plan, nil
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	plan := Decide(probe, caps, sel, limits, EngineCapsFrom(engine))
	encoded, err := proto.Marshal(plan)
	if err != nil {
		return nil, err
	}
	err = s.store.PutPlaybackDecision(ctx, dbgen.PutPlaybackDecisionParams{ProbeHash: probeHash, InputHash: inputHash, Plan: encoded})
	return plan, err
}

// hashInputs covers everything besides the file that a decision depends on.
func hashInputs(caps *apiv1alpha.ClientCapabilities, sel Selection, limits Limits, engine *enginev1alpha.CapabilitiesResponse) (string, error) {
	opts := proto.MarshalOptions{Deterministic: true}
	c, err := opts.Marshal(caps)
	if err != nil {
		return "", err
	}
	e, err := opts.Marshal(engine)
	if err != nil {
		return "", err
	}
	h := sha256.New()
	fmt.Fprintf(h, "v1|%d|%d|%d|", sel.Audio, sel.Subtitle, limits.MaxBitrate)
	h.Write(c)
	h.Write([]byte{0})
	h.Write(e)
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (s *Service) prefs(ctx context.Context, userID uuid.UUID) (Prefs, error) {
	row, err := s.store.GetPlaybackPreferences(ctx, userID)
	if err != nil {
		return Prefs{}, err
	}
	var p Prefs
	if row.PreferredAudioLanguage != nil {
		p.AudioLanguage = *row.PreferredAudioLanguage
	}
	if row.PreferredSubtitleLanguage != nil {
		p.SubtitleLanguage = *row.PreferredSubtitleLanguage
	}
	if row.MaxBitrate != nil && *row.MaxBitrate > 0 {
		p.MaxBitrate = uint64(*row.MaxBitrate)
	}
	return p, nil
}

func keepVersion(versions []dbgen.ItemVersionsRow, id string) []dbgen.ItemVersionsRow {
	for _, v := range versions {
		if v.VersionID.String() == id {
			return []dbgen.ItemVersionsRow{v}
		}
	}
	return nil
}
