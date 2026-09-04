package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"cour/internal/httpapi/apigen"
	"cour/internal/pulse"
	"cour/internal/store/sqlcgen"
)

type pulseHandlers struct {
	svc *pulse.Service
	log *slog.Logger
}

func (h pulseHandlers) GetMyPulse(w http.ResponseWriter, r *http.Request, params apigen.GetMyPulseParams) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	tz := "UTC"
	if params.Tz != nil && *params.Tz != "" {
		tz = *params.Tz
	}
	p, err := h.svc.Pulse(r.Context(), id.UserID, tz, time.Now())
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, toPulse(p))
}

func toPulse(p pulse.Pulse) apigen.Pulse {
	out := apigen.Pulse{
		Streak: apigen.Streak{
			Current:     p.Streak.Current,
			Best:        p.Streak.Best,
			ActiveToday: p.Streak.ActiveToday,
			Week:        p.Streak.Week[:],
		},
		Badges:  make([]apigen.Badge, len(p.Badges)),
		Replies: make([]apigen.ReplyToMe, len(p.Replies)),
		Kudos:   apigen.Kudos{ReactionsWeek: p.Kudos.ReactionsWeek},
	}
	for i, b := range p.Badges {
		out.Badges[i] = apigen.Badge{Id: b.ID, Label: b.Label, Description: b.Description, Tier: apigen.BadgeTier(b.Tier)}
	}
	if n := p.NextBadge; n != nil {
		out.NextBadge = &apigen.BadgeProgress{
			Id: n.ID, Label: n.Label, Description: n.Description, Tier: apigen.BadgeTier(n.Tier),
			Progress: n.Progress, Target: n.Target,
		}
	}
	for i, r := range p.Replies {
		out.Replies[i] = apigen.ReplyToMe{
			CommentId:     r.CommentID,
			Actor:         apigen.ReviewAuthor{Username: r.ActorUsername, AvatarUrl: r.ActorAvatar},
			Anime:         toSummary(r.Anime),
			Episode:       episodeNumber(r.Episode),
			Kind:          roomKind(r.Kind),
			Snippet:       r.Snippet,
			ParentSnippet: r.ParentSnippet,
			CreatedAt:     r.CreatedAt,
		}
	}
	if t := p.Kudos.Top; t != nil {
		out.Kudos.Top = &apigen.KudosComment{
			CommentId: t.CommentID,
			Anime:     toSummary(t.Anime),
			Episode:   episodeNumber(t.Episode),
			Kind:      roomKind(t.Kind),
			Snippet:   t.Snippet,
			Reactions: t.Reactions,
		}
	}
	return out
}

func episodeNumber(n *int32) *int {
	if n == nil {
		return nil
	}
	v := int(*n)
	return &v
}

func roomKind(k sqlcgen.ThreadKind) apigen.RoomKind {
	if k == sqlcgen.ThreadKindEpisode {
		return apigen.RoomKindEpisode
	}
	return apigen.RoomKindSeries
}
