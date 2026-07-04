package httpapi

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) apiError {
	t.Helper()
	var env errorEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env))
	return env.Error
}

func TestWriteJSONSetsContentType(t *testing.T) {
	rec := httptest.NewRecorder()
	writeJSON(rec, http.StatusOK, map[string]string{"hello": "world"})

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "application/json; charset=utf-8", rec.Header().Get("Content-Type"))
	assert.JSONEq(t, `{"hello":"world"}`, rec.Body.String())
}

func TestWriteErrorEnvelopeShape(t *testing.T) {
	rec := httptest.NewRecorder()
	writeError(rec, http.StatusNotFound, CodeNotFound, "no such anime")

	assert.Equal(t, http.StatusNotFound, rec.Code)
	e := decodeEnvelope(t, rec)
	assert.Equal(t, CodeNotFound, e.Code)
	assert.Equal(t, "no such anime", e.Message)
	assert.Nil(t, e.Details)
}

func TestWriteValidationReportsFields(t *testing.T) {
	rec := httptest.NewRecorder()
	writeValidation(rec, map[string]string{"score": "must be between 1 and 10"})

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	e := decodeEnvelope(t, rec)
	assert.Equal(t, CodeValidation, e.Code)
	details, ok := e.Details.(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "must be between 1 and 10", details["score"])
}

func TestWriteInternalLogsAndHidesDetail(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))
	rec := httptest.NewRecorder()

	writeInternal(rec, log, assert.AnError)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	e := decodeEnvelope(t, rec)
	assert.Equal(t, CodeInternal, e.Code)
	// The response must not leak the underlying error, but the log must have it.
	assert.NotContains(t, rec.Body.String(), assert.AnError.Error())
	assert.Contains(t, buf.String(), assert.AnError.Error())
}

func TestDecodeJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}

	newReq := func(body string) (*httptest.ResponseRecorder, *http.Request) {
		return httptest.NewRecorder(), httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	}

	t.Run("valid body", func(t *testing.T) {
		rec, req := newReq(`{"name":"frieren"}`)
		got, ok := decodeJSON[payload](rec, req)
		require.True(t, ok)
		assert.Equal(t, "frieren", got.Name)
	})

	t.Run("malformed JSON", func(t *testing.T) {
		rec, req := newReq(`{"name":`)
		_, ok := decodeJSON[payload](rec, req)
		require.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Equal(t, CodeBadRequest, decodeEnvelope(t, rec).Code)
	})

	t.Run("empty body", func(t *testing.T) {
		rec, req := newReq("")
		_, ok := decodeJSON[payload](rec, req)
		require.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, decodeEnvelope(t, rec).Message, "required")
	})

	t.Run("trailing garbage rejected", func(t *testing.T) {
		rec, req := newReq(`{"name":"a"}{"name":"b"}`)
		_, ok := decodeJSON[payload](rec, req)
		require.False(t, ok)
		assert.Equal(t, http.StatusBadRequest, rec.Code)
	})

	t.Run("oversized body rejected", func(t *testing.T) {
		rec, req := newReq(`{"name":"` + strings.Repeat("x", maxBodyBytes+1) + `"}`)
		_, ok := decodeJSON[payload](rec, req)
		require.False(t, ok)
		assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	})
}
