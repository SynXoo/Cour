package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"cour/internal/httpapi/apigen"
	"cour/internal/moderation"
	"cour/internal/store/sqlcgen"
)

type moderationHandlers struct {
	svc *moderation.Service
	log *slog.Logger
}

// mustMod gates moderator-only endpoints.
func mustMod(w http.ResponseWriter, r *http.Request) (Identity, bool) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return Identity{}, false
	}
	if !id.IsMod() {
		writeError(w, http.StatusForbidden, CodeForbidden, "moderator access required")
		return Identity{}, false
	}
	return id, true
}

var validSubjects = map[apigen.ReportSubject]sqlcgen.ReportSubject{
	apigen.ReportSubjectReview:  sqlcgen.ReportSubjectReview,
	apigen.ReportSubjectComment: sqlcgen.ReportSubjectComment,
	apigen.ReportSubjectUser:    sqlcgen.ReportSubjectUser,
}

func (h moderationHandlers) FileReport(w http.ResponseWriter, r *http.Request) {
	id, ok := mustIdentity(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.FileReportRequest](w, r)
	if !ok {
		return
	}
	subject, valid := validSubjects[req.SubjectType]
	if !valid {
		writeValidation(w, map[string]string{"subject_type": "must be review, comment, or user"})
		return
	}

	err := h.svc.Report(r.Context(), id.UserID, subject, req.SubjectId, req.Reason)
	if err != nil {
		switch {
		case errors.Is(err, moderation.ErrSubjectNotFound):
			writeNotFound(w)
		case errors.Is(err, moderation.ErrBadReason):
			writeValidation(w, map[string]string{"reason": "must be 3-500 characters"})
		default:
			writeInternal(w, h.log, err)
		}
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (h moderationHandlers) ListOpenReports(w http.ResponseWriter, r *http.Request, params apigen.ListOpenReportsParams) {
	_, ok := mustMod(w, r)
	if !ok {
		return
	}
	var cursor int64
	if params.Cursor != nil {
		cursor = *params.Cursor
	}
	limit := 25
	if params.Limit != nil && *params.Limit > 0 && *params.Limit <= 100 {
		limit = *params.Limit
	}

	rows, next, err := h.svc.OpenReports(r.Context(), cursor, limit)
	if err != nil {
		writeInternal(w, h.log, err)
		return
	}
	data := make([]apigen.Report, len(rows))
	for i, row := range rows {
		data[i] = apigen.Report{
			Id:          row.Report.ID,
			SubjectType: apigen.ReportSubject(row.Report.SubjectType),
			SubjectId:   row.Report.SubjectID,
			Reason:      row.Report.Reason,
			Reporter:    row.ReporterUsername,
			CreatedAt:   row.Report.CreatedAt,
		}
	}
	var nextCursor *int64
	if next > 0 {
		nextCursor = &next
	}
	writeJSON(w, http.StatusOK, apigen.ReportList{Data: data, NextCursor: nextCursor})
}

func (h moderationHandlers) ResolveReport(w http.ResponseWriter, r *http.Request, reportID int64) {
	id, ok := mustMod(w, r)
	if !ok {
		return
	}
	req, ok := decodeJSON[apigen.ResolveReportRequest](w, r)
	if !ok {
		return
	}
	err := h.svc.Resolve(r.Context(), reportID, id.UserID, req.Action == apigen.Dismissed)
	if err != nil {
		if errors.Is(err, moderation.ErrSubjectNotFound) {
			writeNotFound(w)
			return
		}
		writeInternal(w, h.log, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
