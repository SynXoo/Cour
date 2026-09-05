package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/parties"
	"cour/internal/realtime"
)

// Watch parties (docs/WATCH_PARTIES.md). Every handler here is dark unless
// FEATURE_WATCH_PARTIES is on: the REST routes 404 exactly like an unknown
// path, and the /ws route is not mounted at all (server.go). /features is
// always live so the client can decide whether to show any entry point.
type partyHandlers struct {
	enabled bool
	svc     *parties.Service
	gateway *realtime.PartyGateway
	log     *slog.Logger
}

func (h partyHandlers) GetFeatures(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, apigen.Features{WatchParties: h.enabled})
}

// gate 404s when the feature is off, so nothing here is discoverable dark.
func (h partyHandlers) gate(w http.ResponseWriter) bool {
	if !h.enabled {
		writeNotFound(w)
	}
	return h.enabled
}

func (h partyHandlers) CreateParty(w http.ResponseWriter, r *http.Request) {
	if !h.gate(w) {
		return
	}
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.CreatePartyRequest](w, r)
	if !ok {
		return
	}
	fields := map[string]string{}
	if req.AnimeId <= 0 {
		fields["anime_id"] = "must be a positive id"
	}
	if req.Episode <= 0 {
		fields["episode"] = "must be a positive episode number"
	}
	var visibilityRaw string
	if req.Visibility != nil {
		visibilityRaw = string(*req.Visibility)
	}
	visibility, err := parties.ParseVisibility(visibilityRaw)
	if err != nil {
		fields["visibility"] = "must be public, followers, or invite"
	}
	if len(fields) > 0 {
		writeValidation(w, fields)
		return
	}

	v, err := h.svc.Create(r.Context(), id.UserID, req.AnimeId, req.Episode, visibility)
	if err != nil {
		if errors.Is(err, parties.ErrNotFound) {
			writeError(w, http.StatusNotFound, CodeNotFound, "episode not found")
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusCreated, toWatchParty(v))
}

func (h partyHandlers) GetParty(w http.ResponseWriter, r *http.Request, partyID int64) {
	if !h.gate(w) {
		return
	}
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	v, err := h.svc.Get(r.Context(), id.UserID, partyID)
	if err != nil {
		switch {
		case errors.Is(err, parties.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, parties.ErrForbidden):
			writeError(w, http.StatusForbidden, CodeForbidden, "this party is not open to you")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, toWatchParty(v))
}

func (h partyHandlers) CloseParty(w http.ResponseWriter, r *http.Request, partyID int64) {
	if !h.gate(w) {
		return
	}
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if err := h.svc.Close(r.Context(), id.UserID, partyID); err != nil {
		switch {
		case errors.Is(err, parties.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, parties.ErrForbidden):
			writeError(w, http.StatusForbidden, CodeForbidden, "only the host can end a party")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	// The row is closed; now the live side. Best-effort — the sweeper
	// would also catch a room whose keys survived.
	if err := h.gateway.CloseRoom(r.Context(), partyID); err != nil {
		h.log.Warn("party close: live state", "party_id", partyID, "err", err)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h partyHandlers) ListParties(w http.ResponseWriter, r *http.Request, params apigen.ListPartiesParams) {
	if !h.gate(w) {
		return
	}
	var viewer *int64
	if id, ok := identity(r); ok {
		viewer = &id.UserID
	}
	limit := int32(20)
	if params.Limit != nil {
		limit = int32(max(1, min(*params.Limit, 50)))
	}
	var episode *int32
	if params.Episode != nil {
		e := int32(*params.Episode)
		episode = &e
	}
	views, err := h.svc.ListOpen(r.Context(), viewer, params.AnimeId, episode, limit)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.WatchPartySummary, 0, len(views))
	for _, v := range views {
		watching, err := h.gateway.PresenceCount(r.Context(), v.Party.ID)
		if err != nil {
			h.log.Warn("party list: presence", "party_id", v.Party.ID, "err", err)
		}
		data = append(data, toWatchPartySummary(v, int(watching)))
	}
	writeJSON(w, http.StatusOK, apigen.WatchPartyList{Data: data})
}

// PartySocket is GET /ws — hand-routed in server.go (outside the request
// timeout, excluded from codegen) and only mounted when the feature is on.
// A bearer header on the upgrade authenticates up front; a browser socket
// authenticates with its first frame instead (browsers can't set headers on
// a WebSocket handshake, and the token never rides the URL).
func (h partyHandlers) PartySocket(w http.ResponseWriter, r *http.Request) {
	var pre *realtime.PartyUser
	if id, ok := identity(r); ok {
		pre = &realtime.PartyUser{ID: id.UserID, Username: id.Username}
	}
	h.gateway.Serve(w, r, pre)
}

// ── DTOs ───────────────────────────────────────────────────────────────────

func toWatchParty(v parties.View) apigen.WatchParty {
	return apigen.WatchParty{
		Id:         v.Party.ID,
		Anime:      toSummary(v.Anime),
		Episode:    apigen.Episode{Number: int(v.Episode.Number), Title: v.Episode.Title, AiringAt: v.Episode.AiringAt},
		Host:       apigen.ReviewAuthor{Username: v.HostUsername, AvatarUrl: v.HostAvatarURL},
		Visibility: apigen.PartyVisibility(v.Party.Visibility),
		CreatedAt:  v.Party.CreatedAt,
		ClosedAt:   v.Party.ClosedAt,
	}
}

// toWatchPartySummary is WatchParty + the live member count (the spec's
// allOf, which oapi-codegen flattens into one struct).
func toWatchPartySummary(v parties.View, watching int) apigen.WatchPartySummary {
	p := toWatchParty(v)
	return apigen.WatchPartySummary{
		Id:         p.Id,
		Anime:      p.Anime,
		Episode:    p.Episode,
		Host:       p.Host,
		Visibility: p.Visibility,
		CreatedAt:  p.CreatedAt,
		ClosedAt:   p.ClosedAt,
		Watching:   watching,
	}
}

// toPartyAny adapts toWatchParty for the gateway, which speaks `any`.
func toPartyAny(v parties.View) any { return toWatchParty(v) }
