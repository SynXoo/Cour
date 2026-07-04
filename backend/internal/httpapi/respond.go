package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
)

// Stable machine-readable error codes. Clients branch on these, never on
// message text.
const (
	CodeBadRequest   = "bad_request"
	CodeValidation   = "validation_failed"
	CodeUnauthorized = "unauthorized"
	CodeForbidden    = "forbidden"
	CodeNotFound     = "not_found"
	CodeConflict     = "conflict"
	CodeRateLimited  = "rate_limited"
	CodeInternal     = "internal_error"
	CodeUnavailable  = "service_unavailable"
)

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Details any    `json:"details,omitempty"`
}

type errorEnvelope struct {
	Error apiError `json:"error"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if v == nil {
		return
	}
	if err := json.NewEncoder(w).Encode(v); err != nil {
		// Headers are already gone; nothing useful left to do but record it.
		slog.Default().Error("encode response", "err", err)
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorEnvelope{Error: apiError{Code: code, Message: message}})
}

func writeErrorDetails(w http.ResponseWriter, status int, code, message string, details any) {
	writeJSON(w, status, errorEnvelope{Error: apiError{Code: code, Message: message, Details: details}})
}

// writeValidation reports per-field validation failures as
// details: {"field": "problem"}.
func writeValidation(w http.ResponseWriter, fields map[string]string) {
	writeErrorDetails(w, http.StatusUnprocessableEntity, CodeValidation, "validation failed", fields)
}

func writeNotFound(w http.ResponseWriter) {
	writeError(w, http.StatusNotFound, CodeNotFound, "resource not found")
}

func writeInternal(w http.ResponseWriter, log *slog.Logger, err error) {
	log.Error("internal error", "err", err)
	writeError(w, http.StatusInternalServerError, CodeInternal, "something went wrong")
}

const maxBodyBytes = 1 << 20 // 1 MiB

// decodeJSON reads and validates a JSON request body into T. On failure it
// writes the error response itself and returns ok=false so handlers can
// simply return.
func decodeJSON[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var dst T
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&dst); err != nil {
		var maxErr *http.MaxBytesError
		switch {
		case errors.As(err, &maxErr):
			writeError(w, http.StatusRequestEntityTooLarge, CodeBadRequest,
				fmt.Sprintf("request body exceeds %d bytes", maxErr.Limit))
		case errors.Is(err, io.EOF):
			writeError(w, http.StatusBadRequest, CodeBadRequest, "request body is required")
		default:
			writeError(w, http.StatusBadRequest, CodeBadRequest, "malformed JSON: "+err.Error())
		}
		return dst, false
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, CodeBadRequest, "request body must contain a single JSON object")
		return dst, false
	}
	return dst, true
}
