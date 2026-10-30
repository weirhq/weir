package admin

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"connectrpc.com/connect"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1alpha "github.com/weirhq/weir/proto/weir/api/v1alpha"
	enginev1alpha "github.com/weirhq/weir/proto/weir/engine/v1alpha"
	"github.com/weirhq/weir/server/internal/auth"
)

const recentJobs = 30

// Engine is what the status page needs from the engine supervisor.
type Engine interface {
	Healthy() bool
	Capabilities() *enginev1alpha.CapabilitiesResponse
	LastHealth() *enginev1alpha.HealthResponse
	Problem() string
}

// Jobs queues and lists background work.
type Jobs interface {
	Insert(ctx context.Context, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
	JobList(ctx context.Context, params *river.JobListParams) (*river.JobListResult, error)
}

func (s *Service) GetServerStatus(ctx context.Context, _ *connect.Request[apiv1alpha.GetServerStatusRequest]) (*connect.Response[apiv1alpha.GetServerStatusResponse], error) {
	if _, err := auth.RequireAdmin(ctx, s.store); err != nil {
		return nil, err
	}
	resp := &apiv1alpha.GetServerStatusResponse{Engine: &apiv1alpha.EngineStatus{}}
	if s.engine != nil {
		e := resp.Engine
		e.Healthy = s.engine.Healthy()
		e.Problem = s.engine.Problem()
		caps := s.engine.Capabilities()
		e.EngineVersion, e.FfmpegVersion, e.MaxSessions = caps.GetEngineVersion(), caps.GetFfmpegVersion(), caps.GetMaxSessions()
		for _, d := range caps.GetDevices() {
			api := strings.TrimPrefix(d.GetApi().String(), "HARDWARE_API_")
			e.Hardware = append(e.Hardware, api+": "+d.GetName())
		}
		e.ActiveSessions = s.engine.LastHealth().GetActiveSessions()
	}
	jobs, err := s.jobs.JobList(ctx, river.NewJobListParams().First(recentJobs).OrderBy(river.JobListOrderByID, river.SortOrderDesc))
	if err != nil {
		return nil, auth.Internal(ctx, "list jobs", err)
	}
	for _, j := range jobs.Jobs {
		resp.RecentJobs = append(resp.RecentJobs, jobProto(j))
	}
	return connect.NewResponse(resp), nil
}

func jobProto(j *rivertype.JobRow) *apiv1alpha.Job {
	var args struct {
		LibraryID string `json:"library_id"`
	}
	_ = json.Unmarshal(j.EncodedArgs, &args)
	out := &apiv1alpha.Job{
		Id: strconv.FormatInt(j.ID, 10), Kind: j.Kind, LibraryId: args.LibraryID, State: jobState(j.State),
		Attempt: uint32(max(j.Attempt, 0)), CreatedAt: timestamppb.New(j.CreatedAt),
	}
	if j.FinalizedAt != nil {
		out.FinishedAt = timestamppb.New(*j.FinalizedAt)
	}
	if n := len(j.Errors); n > 0 {
		out.Error = j.Errors[n-1].Error
	}
	return out
}

func jobState(s rivertype.JobState) apiv1alpha.JobState {
	switch s {
	case rivertype.JobStateRunning:
		return apiv1alpha.JobState_JOB_STATE_RUNNING
	case rivertype.JobStateCompleted:
		return apiv1alpha.JobState_JOB_STATE_COMPLETED
	case rivertype.JobStateDiscarded:
		return apiv1alpha.JobState_JOB_STATE_FAILED
	case rivertype.JobStateCancelled:
		return apiv1alpha.JobState_JOB_STATE_CANCELLED
	}
	return apiv1alpha.JobState_JOB_STATE_WAITING
}
