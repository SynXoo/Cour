package httpapi

import (
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/oapi-codegen/runtime/types"

	"cour/internal/httpapi/apigen"
	"cour/internal/imports"
	"cour/internal/store/sqlcgen"
)

// maxImportUpload caps the MAL upload body. A 10k-entry export is ~15 MB of
// plain XML; anything past this is not a list.
const maxImportUpload = 20 << 20

type importHandlers struct {
	svc      *imports.Service
	q        *sqlcgen.Queries // AnimeSummary hydration for previews
	demoMode bool
	log      *slog.Logger
}

func (h importHandlers) StartAniListImport(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	if h.demoMode {
		writeError(w, http.StatusServiceUnavailable, CodeUnavailable,
			"demo mode is fully offline; AniList import is unavailable")
		return
	}
	req, ok := decodeJSON[apigen.StartAniListImportRequest](w, r)
	if !ok {
		return
	}
	job, err := h.svc.CreateAniList(r.Context(), id.UserID, req.Username)
	if err != nil {
		h.writeImportError(w, err)
		return
	}
	writeJSON(w, http.StatusAccepted, toImportJob(job))
}

func (h importHandlers) StartMALImport(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImportUpload)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, CodeBadRequest, "expected a multipart upload")
		return
	}
	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			h.writeImportError(w, err)
			return
		}
		if part.FormName() != "file" {
			continue
		}
		job, err := h.svc.CreateMAL(r.Context(), id.UserID, part.FileName(), part)
		if err != nil {
			h.writeImportError(w, err)
			return
		}
		writeJSON(w, http.StatusAccepted, toImportJob(job))
		return
	}
	writeValidation(w, map[string]string{"file": "the export file is required"})
}

func (h importHandlers) GetImportJob(w http.ResponseWriter, r *http.Request, jobID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	job, err := h.svc.Get(r.Context(), id.UserID, jobID)
	if err != nil {
		h.writeImportError(w, err)
		return
	}
	detail, err := h.toImportJobDetail(r, job)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

func (h importHandlers) CommitImportJob(w http.ResponseWriter, r *http.Request, jobID int64) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.CommitImportRequest](w, r)
	if !ok {
		return
	}
	var resolutions map[int]*int64
	if req.Resolutions != nil {
		resolutions = make(map[int]*int64, len(*req.Resolutions))
		for _, res := range *req.Resolutions {
			resolutions[res.RowIndex] = res.AnimeId
		}
	}
	job, err := h.svc.Commit(r.Context(), id.UserID, jobID, imports.Mode(req.Mode), resolutions)
	if err != nil {
		h.writeImportError(w, err)
		return
	}
	detail, err := h.toImportJobDetail(r, job)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	writeJSON(w, http.StatusOK, detail)
}

// writeImportError maps service errors onto the envelope vocabulary.
func (h importHandlers) writeImportError(w http.ResponseWriter, err error) {
	var badInput *imports.BadInputError
	var tooBig *http.MaxBytesError
	switch {
	case errors.Is(err, imports.ErrNotFound):
		writeNotFound(w)
	case errors.Is(err, imports.ErrActiveImport):
		writeError(w, http.StatusConflict, CodeConflict,
			"an import is already running; wait for it to finish")
	case errors.Is(err, imports.ErrNotReady):
		writeError(w, http.StatusConflict, CodeConflict,
			"this import is not awaiting commit")
	case errors.As(err, &badInput):
		writeError(w, http.StatusUnprocessableEntity, CodeValidation, badInput.Reason)
	case errors.As(err, &tooBig):
		writeError(w, http.StatusRequestEntityTooLarge, CodeBadRequest,
			"the upload exceeds the 20 MiB limit")
	default:
		writeInternal(w, h.log, err)
	}
}

// ── DTO helpers ────────────────────────────────────────────────────────────

func toImportJob(job sqlcgen.ImportJob) apigen.ImportJob {
	counts := imports.DecodeCounts(job.Counts)
	return apigen.ImportJob{
		Id:     job.ID,
		Source: apigen.ImportSource(job.Source),
		Status: apigen.ImportStatus(job.Status),
		Counts: apigen.ImportCounts{
			Total:     counts.Total,
			Matched:   counts.Matched,
			Review:    counts.Review,
			Conflicts: counts.Conflicts,
			Applied:   counts.Applied,
			Skipped:   counts.Skipped,
		},
		Error:     job.Error,
		CreatedAt: job.CreatedAt,
		UpdatedAt: job.UpdatedAt,
	}
}

// toImportJobDetail hydrates preview rows with anime summaries in one query.
func (h importHandlers) toImportJobDetail(r *http.Request, job sqlcgen.ImportJob) (apigen.ImportJobDetail, error) {
	base := toImportJob(job)
	detail := apigen.ImportJobDetail{
		Id:        base.Id,
		Source:    base.Source,
		Status:    base.Status,
		Counts:    base.Counts,
		Error:     base.Error,
		CreatedAt: base.CreatedAt,
		UpdatedAt: base.UpdatedAt,
		Rows:      []apigen.ImportRow{},
	}
	rows, err := imports.DecodeRows(job.Rows)
	if err != nil {
		return apigen.ImportJobDetail{}, err
	}
	if len(rows) == 0 {
		return detail, nil
	}

	ids := make([]int64, 0, len(rows))
	for _, row := range rows {
		if row.AnimeID != 0 {
			ids = append(ids, row.AnimeID)
		}
	}
	summaries := map[int64]apigen.AnimeSummary{}
	if len(ids) > 0 {
		anime, err := h.q.ListAnimeByIDs(r.Context(), ids)
		if err != nil {
			return apigen.ImportJobDetail{}, err
		}
		for _, a := range anime {
			summaries[a.ID] = toSummary(a)
		}
	}

	detail.Rows = make([]apigen.ImportRow, len(rows))
	for i, row := range rows {
		out := apigen.ImportRow{
			RowIndex:   i,
			Title:      row.Title,
			Status:     apigen.ListStatus(row.Status),
			Score:      toIntFrom16(row.Score),
			Progress:   int(row.Progress),
			StartedOn:  toAPIDate(row.StartedOn),
			FinishedOn: toAPIDate(row.FinishedOn),
			Match:      apigen.ImportMatch(row.Match),
			OnList:     row.OnList,
		}
		if s, ok := summaries[row.AnimeID]; ok && row.AnimeID != 0 {
			out.Anime = &s
		}
		detail.Rows[i] = out
	}
	return detail, nil
}

func toAPIDate(s *string) *types.Date {
	t := imports.ParseEntryDate(s)
	if t == nil {
		return nil
	}
	return &types.Date{Time: *t}
}
