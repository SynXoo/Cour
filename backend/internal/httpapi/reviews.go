package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"

	"cour/internal/httpapi/apigen"
	"cour/internal/reviews"
	"cour/internal/store/sqlcgen"
)

type reviewHandlers struct {
	svc *reviews.Service
	q   *sqlcgen.Queries
	log *slog.Logger
}

const defaultReviewsPerPage = 10

func reviewPaging(page, per *int) (int, int) {
	p, pp := 1, defaultReviewsPerPage
	if page != nil && *page > 0 {
		p = *page
	}
	if per != nil && *per > 0 && *per <= maxPerPage {
		pp = *per
	}
	return p, pp
}

func (h reviewHandlers) ListAnimeReviews(w http.ResponseWriter, r *http.Request, animeID int64, params apigen.ListAnimeReviewsParams) {
	page, per := reviewPaging(params.Page, params.PerPage)
	rows, hasMore, err := h.svc.ForAnime(r.Context(), animeID, page, per)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}

	voted := h.votedSetFor(r, collectIDs(rows, func(row sqlcgen.ListReviewsForAnimeRow) int64 { return row.Review.ID }))
	callerID, _ := callerUserID(r)

	data := make([]apigen.Review, len(rows))
	for i, row := range rows {
		data[i] = toReview(row.Review, row.User, voted[row.Review.ID], callerID)
	}
	writeJSON(w, http.StatusOK, apigen.ReviewList{
		Data: data,
		Page: apigen.PageInfo{Page: page, PerPage: per, HasMore: hasMore},
	})
}

func (h reviewHandlers) GetMyReview(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	review, err := h.svc.Mine(r.Context(), id.UserID, animeID)
	if err != nil {
		if errors.Is(err, reviews.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	author := apigen.ReviewAuthor{Username: id.Username}
	writeJSON(w, http.StatusOK, toReviewWithAuthor(review, author, false, id.UserID))
}

func (h reviewHandlers) UpsertMyReview(w http.ResponseWriter, r *http.Request, animeID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.UpsertReviewRequest](w, r)
	if !ok {
		return
	}
	in := reviews.UpsertInput{
		Body:  req.Body,
		Score: int16(req.Score),
	}
	if req.HasSpoilers != nil {
		in.HasSpoilers = *req.HasSpoilers
	}
	if problems := in.Validate(); len(problems) > 0 {
		writeValidation(w, problems)
		return
	}

	review, err := h.svc.Upsert(r.Context(), id.UserID, animeID, in)
	if err != nil {
		if errors.Is(err, reviews.ErrAnimeNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	author := apigen.ReviewAuthor{Username: id.Username}
	writeJSON(w, http.StatusOK, toReviewWithAuthor(review, author, false, id.UserID))
}

func (h reviewHandlers) GetReview(w http.ResponseWriter, r *http.Request, reviewID int64) {
	row, err := h.svc.ByID(r.Context(), reviewID)
	if err != nil {
		if errors.Is(err, reviews.ErrNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	voted := h.votedSetFor(r, []int64{reviewID})
	callerID, _ := callerUserID(r)

	writeJSON(w, http.StatusOK, apigen.ReviewDetail{
		Id:           row.Review.ID,
		AnimeId:      row.Review.AnimeID,
		Author:       apigen.ReviewAuthor{Username: row.User.Username, AvatarUrl: row.User.AvatarUrl},
		Body:         row.Review.Body,
		Score:        int(row.Review.Score),
		HasSpoilers:  row.Review.HasSpoilers,
		HelpfulCount: int(row.Review.HelpfulCount),
		Voted:        voted[reviewID],
		IsMine:       callerID == row.Review.UserID,
		CreatedAt:    row.Review.CreatedAt,
		UpdatedAt:    row.Review.UpdatedAt,
		Anime:        toSummary(row.Anime),
	})
}

func (h reviewHandlers) DeleteReview(w http.ResponseWriter, r *http.Request, reviewID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	err := h.svc.Delete(r.Context(), reviewID, id.UserID, id.IsMod())
	if err != nil {
		switch {
		case errors.Is(err, reviews.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, reviews.ErrForbidden):
			writeError(w, http.StatusForbidden, CodeForbidden, "you can only delete your own review")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h reviewHandlers) MarkHelpful(w http.ResponseWriter, r *http.Request, reviewID int64) {
	h.setHelpful(w, r, reviewID, true)
}

func (h reviewHandlers) UnmarkHelpful(w http.ResponseWriter, r *http.Request, reviewID int64) {
	h.setHelpful(w, r, reviewID, false)
}

func (h reviewHandlers) setHelpful(w http.ResponseWriter, r *http.Request, reviewID int64, helpful bool) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	count, err := h.svc.SetHelpful(r.Context(), reviewID, id.UserID, helpful)
	if err != nil {
		switch {
		case errors.Is(err, reviews.ErrNotFound):
			writeNotFound(w)
		case errors.Is(err, reviews.ErrForbidden):
			writeError(w, http.StatusForbidden, CodeForbidden, "you cannot vote on your own review")
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	writeJSON(w, http.StatusOK, apigen.HelpfulState{HelpfulCount: int(count), Voted: helpful})
}

func (h reviewHandlers) ListUserReviews(w http.ResponseWriter, r *http.Request, username string, params apigen.ListUserReviewsParams) {
	user, err := h.q.GetUserByUsername(r.Context(), username)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}

	page, per := reviewPaging(params.Page, params.PerPage)
	rows, hasMore, err := h.svc.ByUser(r.Context(), user.ID, page, per)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}

	voted := h.votedSetFor(r, collectIDs(rows, func(row sqlcgen.ListReviewsByUserRow) int64 { return row.Review.ID }))
	callerID, _ := callerUserID(r)
	author := apigen.ReviewAuthor{Username: user.Username, AvatarUrl: user.AvatarUrl}

	data := make([]apigen.ReviewDetail, len(rows))
	for i, row := range rows {
		base := toReviewWithAuthor(row.Review, author, voted[row.Review.ID], callerID)
		data[i] = apigen.ReviewDetail{
			Id: base.Id, AnimeId: base.AnimeId, Author: base.Author, Body: base.Body,
			Score: base.Score, HasSpoilers: base.HasSpoilers, HelpfulCount: base.HelpfulCount,
			Voted: base.Voted, IsMine: base.IsMine, CreatedAt: base.CreatedAt, UpdatedAt: base.UpdatedAt,
			Anime: toSummary(row.Anime),
		}
	}
	writeJSON(w, http.StatusOK, apigen.UserReviewList{
		Data: data,
		Page: apigen.PageInfo{Page: page, PerPage: per, HasMore: hasMore},
	})
}

// ── helpers ────────────────────────────────────────────────────────────────

func callerUserID(r *http.Request) (int64, bool) {
	if id, ok := identity(r); ok {
		return id.UserID, true
	}
	return 0, false
}

func (h reviewHandlers) votedSetFor(r *http.Request, reviewIDs []int64) map[int64]bool {
	id, ok := identity(r)
	if !ok {
		return map[int64]bool{}
	}
	set, err := h.svc.VotedSet(r.Context(), id.UserID, reviewIDs)
	if err != nil {
		h.log.Warn("voted set lookup failed", "err", err)
		return map[int64]bool{}
	}
	return set
}

func collectIDs[T any](rows []T, id func(T) int64) []int64 {
	out := make([]int64, len(rows))
	for i, row := range rows {
		out[i] = id(row)
	}
	return out
}

func toReview(review sqlcgen.Review, user sqlcgen.User, voted bool, callerID int64) apigen.Review {
	return toReviewWithAuthor(review,
		apigen.ReviewAuthor{Username: user.Username, AvatarUrl: user.AvatarUrl},
		voted, callerID)
}

func toReviewWithAuthor(review sqlcgen.Review, author apigen.ReviewAuthor, voted bool, callerID int64) apigen.Review {
	return apigen.Review{
		Id:           review.ID,
		AnimeId:      review.AnimeID,
		Author:       author,
		Body:         review.Body,
		Score:        int(review.Score),
		HasSpoilers:  review.HasSpoilers,
		HelpfulCount: int(review.HelpfulCount),
		Voted:        voted,
		IsMine:       callerID == review.UserID,
		CreatedAt:    review.CreatedAt,
		UpdatedAt:    review.UpdatedAt,
	}
}
